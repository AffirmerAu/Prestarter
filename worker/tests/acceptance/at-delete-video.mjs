// Admin console "fully delete a video after it's been removed" flow — user-reported
// requirement. Not a numbered spec section 18 acceptance test (new scope beyond the original
// spec), written before/alongside the implementation per this project's working agreement.
//
// Uses a throwaway video with a synthetic stream_uid — same reasoning as
// at-archive-video.mjs: this is a genuinely destructive, irreversible action, so it must
// never run against any shared fixture. The synthetic stream_uid also naturally exercises
// deleteVideo's "already gone from Stream" tolerance (a fake uid 404s against the real
// Stream API, which the handler is designed to treat as success, not failure).
//
// Usage: start `wrangler dev`, then node at-delete-video.mjs
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
      display_code: `AT-DELETE-${Date.now()}`,
      title: "AT Delete Test Video",
      duration_seconds: 60,
      category: "test",
      stream_uid: `at-delete-fake-${Date.now()}`,
      status: "draft",
    }),
  })
).body?.[0];
check("setup: throwaway video created", !!video, JSON.stringify(video));

const client = (
  await rest("clients", {
    method: "POST",
    body: JSON.stringify({
      name: `AT Delete Video Pty Ltd ${Date.now()}`,
      mark_as: "AT Delete Video",
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

try {
  // --- Deleting a video that's still draft (not removed from the library) is rejected ---
  const tooEarlyRes = await fetch(`${WORKER_URL}/internal/videos/${video.id}/delete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  check("deleting a non-archived video is rejected", tooEarlyRes.status === 400, `status ${tooEarlyRes.status}`);

  // --- Give it real related data to prove cascade behaviour ---
  const entRes = await fetch(`${WORKER_URL}/internal/clients/${client.id}/entitlements`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ video_id: video.id }),
  });
  const entBody = await entRes.json();
  check("setup: entitled the throwaway client to the video", entRes.status === 200, JSON.stringify(entBody));

  const langRow = (
    await rest("video_languages", {
      method: "POST",
      body: JSON.stringify({
        video_id: video.id,
        language_tag: "es",
        kind: "caption",
        label_native: "Español",
        source: "uploaded",
      }),
    })
  ).body?.[0];
  check("setup: a caption row exists for the video", !!langRow, JSON.stringify(langRow));

  const alertRow = (
    await rest("alerts", {
      method: "POST",
      body: JSON.stringify({
        client_id: client.id,
        video_id: video.id,
        type: "advisory_cap_exceeded",
        severity: "critical",
        evidence: {},
      }),
    })
  ).body?.[0];
  check("setup: an alert row references the video", !!alertRow, JSON.stringify(alertRow));

  // --- Archive it, then fully delete it ---
  await fetch(`${WORKER_URL}/internal/videos/${video.id}/archive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  const deleteRes = await fetch(`${WORKER_URL}/internal/videos/${video.id}/delete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const deleteBody = await deleteRes.json();
  check("delete succeeds once archived", deleteRes.status === 200 && deleteBody.deleted === true, JSON.stringify(deleteBody));
  // stream_deleted is expected false in this environment right now — the configured
  // CF_STREAM_API_TOKEN can't delete Stream videos (confirmed separately, a token permission
  // gap, not specific to this test). Our own deletion must still succeed regardless — that's
  // the whole point of the check above. This just confirms the response is honest about it.
  check("response reports whether the Stream asset was actually deleted", typeof deleteBody.stream_deleted === "boolean", JSON.stringify(deleteBody));

  const videoRow = (await rest(`videos?id=eq.${video.id}&select=id`)).body ?? [];
  check("video row is gone", videoRow.length === 0, JSON.stringify(videoRow));

  const entRow = (await rest(`entitlements?id=eq.${entBody.id}&select=id`)).body ?? [];
  check("entitlement row cascade-deleted", entRow.length === 0, JSON.stringify(entRow));

  const langRowAfter = (await rest(`video_languages?id=eq.${langRow.id}&select=id`)).body ?? [];
  check("caption row cascade-deleted", langRowAfter.length === 0, JSON.stringify(langRowAfter));

  const alertRowAfter = (await rest(`alerts?id=eq.${alertRow.id}&select=video_id`)).body ?? [];
  check(
    "alert row survives, but with video_id nulled out (not deleted, not left dangling)",
    alertRowAfter.length === 1 && alertRowAfter[0].video_id === null,
    JSON.stringify(alertRowAfter),
  );

  const auditRows = (
    await rest(`audit_log?subject_type=eq.videos&subject_id=eq.${video.id}&action=eq.delete_video&select=*`)
  ).body ?? [];
  check(
    "audit_log records the delete, with the video's identity preserved in detail",
    auditRows.length === 1 && auditRows[0].detail?.display_code === video.display_code,
    JSON.stringify(auditRows),
  );

  // --- Deleting an already-gone video is a clean 404, not a crash ---
  const againRes = await fetch(`${WORKER_URL}/internal/videos/${video.id}/delete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  check("deleting an already-deleted video 404s cleanly", againRes.status === 404, `status ${againRes.status}`);
} finally {
  await rest(`clients?id=eq.${client.id}`, { method: "DELETE" });
  // Video row is expected to already be gone by this point — best-effort cleanup only.
  await rest(`videos?id=eq.${video.id}`, { method: "DELETE" });
}

process.exit(fail);
