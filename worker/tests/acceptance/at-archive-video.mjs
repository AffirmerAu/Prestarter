// Admin console "remove a video from the library" flow — user-reported requirement. Not a
// numbered spec section 18 acceptance test (new scope beyond the original spec), written
// before/alongside the implementation per this project's working agreement.
//
// Uses a throwaway video with a synthetic stream_uid rather than a real Cloudflare Stream
// video, deliberately: archiving is a GLOBAL action on the video (unlike entitlement
// revoke, which is scoped to one client) — running this against the shared stage-1 video or
// any other real registered video would risk leaving it archived for every client if the
// test crashed mid-run, the same fixture-drift problem this project has already hit twice
// with the shared stage-1 client. checkEntitlement() reaches its archived-status check
// before it would ever need a working stream_uid, so /api/token enforcement is still
// genuinely exercised — see the two 403 checks below.
//
// Usage: start `wrangler dev`, then node at-archive-video.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const devVars = Object.fromEntries(
  fs
    .readFileSync(path.join(here, "..", "..", ".dev.vars"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim()];
    }),
);
const adminTest = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "..", "supabase", "seed", "admin-test.json"), "utf8"));

const SUPABASE_URL = devVars.SUPABASE_URL;
const ANON_KEY = devVars.SUPABASE_ANON_KEY;
const SERVICE_KEY = devVars.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_URL = process.env.WORKER_URL || "http://127.0.0.1:8787";

let fail = 0;
function check(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`);
  else {
    console.log(`FAIL  ${label}${detail ? " — " + detail : ""}`);
    fail = 1;
  }
}

const rest = (p, opts = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${p}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...opts.headers,
    },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

async function signInAsAdmin() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminTest.testAdmin.email, password: adminTest.testAdmin.password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`admin sign-in failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

const adminToken = await signInAsAdmin();

const video = (
  await rest("videos", {
    method: "POST",
    body: JSON.stringify({
      display_code: `AT-ARCHIVE-${Date.now()}`,
      title: "AT Archive Test Video",
      duration_seconds: 60,
      category: "test",
      stream_uid: `at-archive-fake-${Date.now()}`,
      status: "draft",
    }),
  })
).body?.[0];
check("setup: throwaway video created", !!video, JSON.stringify(video));

const client = (
  await rest("clients", {
    method: "POST",
    body: JSON.stringify({
      name: `AT Archive Pty Ltd ${Date.now()}`,
      mark_as: "AT Archive",
      plan_tier: "standard",
      term_start: "2026-01-01",
      term_end: "2027-01-01",
      billing_state: "paid",
      paid_to: "2027-01-01",
      daily_cap_advisory: 25,
    }),
  })
).body?.[0];
check("setup: throwaway client created", !!client, JSON.stringify(client));

const accessKey = `at-archive-video-${Date.now()}`;
await rest("access_keys", { method: "POST", body: JSON.stringify({ client_id: client.id, key: accessKey }) });

try {
  const addRes = await fetch(`${WORKER_URL}/internal/clients/${client.id}/entitlements`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ video_id: video.id }),
  });
  const addBody = await addRes.json();
  check("entitling the client to the video succeeds", addRes.status === 200, JSON.stringify(addBody));

  // --- Archive it ---
  const archiveRes = await fetch(`${WORKER_URL}/internal/videos/${video.id}/archive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const archiveBody = await archiveRes.json();
  check("archive succeeds", archiveRes.status === 200 && archiveBody.status === "archived", JSON.stringify(archiveBody));

  const archivedRow = (await rest(`videos?id=eq.${video.id}&select=status`)).body?.[0];
  check("video row status is archived", archivedRow?.status === "archived", JSON.stringify(archivedRow));

  const today = new Date().toISOString().slice(0, 10);
  const revokedEnt = (await rest(`entitlements?id=eq.${addBody.id}&select=*`)).body?.[0];
  check(
    "archiving auto-revoked the client's entitlement (effective_to is in the past)",
    revokedEnt?.effective_to && revokedEnt.effective_to < today,
    JSON.stringify(revokedEnt),
  );

  // --- Real enforcement: playback is refused for an archived video ---
  const tokenAfterArchive = await fetch(`${WORKER_URL}/api/token?videoId=${video.id}&k=${accessKey}`);
  check("playback is refused for an archived video (real /api/token check)", tokenAfterArchive.status === 403, `status ${tokenAfterArchive.status}`);

  // --- An archived video can't be added to a (different) client ---
  const otherClient = (
    await rest("clients", {
      method: "POST",
      body: JSON.stringify({
        name: `AT Archive Other Pty Ltd ${Date.now()}`,
        mark_as: "AT Archive Other",
        plan_tier: "standard",
        term_start: "2026-01-01",
        term_end: "2027-01-01",
        billing_state: "paid",
        paid_to: "2027-01-01",
        daily_cap_advisory: 25,
      }),
    })
  ).body?.[0];
  try {
    const blockedRes = await fetch(`${WORKER_URL}/internal/clients/${otherClient.id}/entitlements`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: video.id }),
    });
    check("adding an archived video to a client is rejected", blockedRes.status === 400, `status ${blockedRes.status}`);

    // --- Restore it ---
    const restoreRes = await fetch(`${WORKER_URL}/internal/videos/${video.id}/restore`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const restoreBody = await restoreRes.json();
    check("restore succeeds", restoreRes.status === 200 && restoreBody.status === "draft", JSON.stringify(restoreBody));

    const restoredRow = (await rest(`videos?id=eq.${video.id}&select=status`)).body?.[0];
    check("video row status is draft again after restore", restoredRow?.status === "draft", JSON.stringify(restoredRow));

    const readdRes = await fetch(`${WORKER_URL}/internal/clients/${otherClient.id}/entitlements`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: video.id }),
    });
    check("adding a restored video to a client succeeds", readdRes.status === 200, `status ${readdRes.status}`);

    const auditRows = (
      await rest(`audit_log?subject_type=eq.videos&subject_id=eq.${video.id}&select=action&order=occurred_at.asc`)
    ).body ?? [];
    check("audit_log records the archive", auditRows.some((r) => r.action === "archive_video"), JSON.stringify(auditRows));
    check("audit_log records the restore", auditRows.some((r) => r.action === "restore_video"), JSON.stringify(auditRows));
  } finally {
    await rest(`clients?id=eq.${otherClient.id}`, { method: "DELETE" });
  }
} finally {
  await rest(`clients?id=eq.${client.id}`, { method: "DELETE" });
  await rest(`videos?id=eq.${video.id}`, { method: "DELETE" });
}

process.exit(fail);
