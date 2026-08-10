// Admin console "add/remove video from client" flow (entitlements). There was no way to do
// this through the admin console at all until now — entitlements were only ever displayed,
// never created or revoked anywhere. Not a numbered spec section 18 acceptance test (new
// scope beyond the original spec), written before/alongside the implementation per this
// project's working agreement.
//
// Creates its own throwaway client and video (via direct DB/Stream-API inserts, same pattern
// as other suites) so it never touches the shared stage-1 fixtures other suites depend on.
//
// Usage: start `wrangler dev`, then node at-manage-entitlements.mjs
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

// Throwaway client — doesn't need a real Stream video since entitlements only reference
// videos.id, and this test never mints a playback token.
const [video] = (
  await rest("videos?select=id&limit=1")
).body ?? [];
if (!video) throw new Error("Expected at least one video to exist already — check seed state.");

const client = (
  await rest("clients", {
    method: "POST",
    body: JSON.stringify({
      name: `AT Entitlements Pty Ltd ${Date.now()}`,
      mark_as: "AT Entitlements",
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
  // --- Add a video ---
  const addRes = await fetch(`${WORKER_URL}/internal/clients/${client.id}/entitlements`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ video_id: video.id }),
  });
  const addBody = await addRes.json();
  check("add entitlement succeeds", addRes.status === 200, JSON.stringify(addBody));

  const entRow = (await rest(`entitlements?id=eq.${addBody.id}&select=*`)).body?.[0];
  check("entitlement row is open-ended (effective_to null)", entRow?.effective_to === null, JSON.stringify(entRow));
  check("entitlement row has today's effective_from", entRow?.effective_from === new Date().toISOString().slice(0, 10), JSON.stringify(entRow));

  const clientDetail = await fetch(`${WORKER_URL}/internal/clients/${client.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  }).then((r) => r.json());
  check("video shows up in client detail's entitlements", clientDetail.entitlements.some((e) => e.video_id === video.id), JSON.stringify(clientDetail.entitlements));

  // --- Missing video_id rejected ---
  const badRes = await fetch(`${WORKER_URL}/internal/clients/${client.id}/entitlements`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  check("missing video_id is rejected", badRes.status === 400, `status ${badRes.status}`);

  // --- Nonexistent video rejected ---
  const fakeRes = await fetch(`${WORKER_URL}/internal/clients/${client.id}/entitlements`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ video_id: "00000000-0000-0000-0000-000000000000" }),
  });
  check("nonexistent video_id is rejected", fakeRes.status === 404, `status ${fakeRes.status}`);

  // --- Remove (revoke) it ---
  const revokeRes = await fetch(`${WORKER_URL}/internal/entitlements/${addBody.id}/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const revokeBody = await revokeRes.json();
  check("revoke succeeds", revokeRes.status === 200, JSON.stringify(revokeBody));

  const today = new Date().toISOString().slice(0, 10);
  const revokedRow = (await rest(`entitlements?id=eq.${addBody.id}&select=*`)).body?.[0];
  check("row still exists (soft-revoke, not deleted)", !!revokedRow, JSON.stringify(revokedRow));
  check("effective_to is set to today", revokedRow?.effective_to === today, JSON.stringify(revokedRow));

  const auditRows = (
    await rest(
      `audit_log?subject_type=eq.clients&subject_id=eq.${client.id}&select=action,actor&order=occurred_at.asc`,
    )
  ).body ?? [];
  check("audit_log records the add", auditRows.some((r) => r.action === "add_entitlement" && r.actor === adminTest.testAdmin.email), JSON.stringify(auditRows));
  check("audit_log records the revoke", auditRows.some((r) => r.action === "revoke_entitlement" && r.actor === adminTest.testAdmin.email), JSON.stringify(auditRows));

  // --- Re-adding the same video reactivates the SAME row rather than erroring on the
  // unique(client_id, video_id) constraint ---
  const readdRes = await fetch(`${WORKER_URL}/internal/clients/${client.id}/entitlements`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ video_id: video.id }),
  });
  const readdBody = await readdRes.json();
  check("re-adding the same video succeeds", readdRes.status === 200, JSON.stringify(readdBody));
  check("reactivates the same row rather than creating a new one", readdBody.id === addBody.id, JSON.stringify({ readdBody, addBody }));

  const reactivatedRow = (await rest(`entitlements?id=eq.${addBody.id}&select=*`)).body?.[0];
  check("reactivated row is open-ended again", reactivatedRow?.effective_to === null, JSON.stringify(reactivatedRow));
} finally {
  await rest(`clients?id=eq.${client.id}`, { method: "DELETE" }); // cascades entitlements
}

process.exit(fail);
