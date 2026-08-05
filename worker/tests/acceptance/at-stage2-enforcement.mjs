// AT3, AT4, AT5, AT6, AT8, AT9, AT10-13, AT17 (spec section 18) — written before the
// stage-two Worker implementation lands, per the working agreement. Expected to fail/error
// until worker/src/index.ts grows real entitlement + billing checks (task 16), play
// recording (task 17), the nightly cron transition (task 18), and the internal admin
// endpoints (task 19).
//
// Runs against a local `wrangler dev` (http://127.0.0.1:8787) plus direct Supabase access
// (service role) to set up/restore scenario state and to inspect admin-only tables that the
// Worker's own API deliberately never returns.
//
// Usage: start `npm run dev` in worker/, then in another shell:
//   node at-stage2-enforcement.mjs
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
const orgs = JSON.parse(
  fs.readFileSync(path.join(here, "..", "..", "..", "supabase", "seed", "test-orgs.json"), "utf8"),
);
const adminTest = JSON.parse(
  fs.readFileSync(path.join(here, "..", "..", "..", "supabase", "seed", "admin-test.json"), "utf8"),
);

const SUPABASE_URL = devVars.SUPABASE_URL;
const ANON_KEY = devVars.SUPABASE_ANON_KEY;
const SERVICE_KEY = devVars.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_URL = process.env.WORKER_URL || "http://127.0.0.1:8787";

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

const a = orgs["Acme Pty Ltd"];
const videoId = orgs.videoId;

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

async function requestToken(videoId, key) {
  const res = await fetch(`${WORKER_URL}/api/token?videoId=${videoId}&k=${key}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function patchClient(clientId, patch) {
  return rest(`clients?id=eq.${clientId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// --- Baseline: this should succeed before we start breaking things on purpose. ---
const baseline = await requestToken(videoId, a.key);
check("baseline: valid key + entitled video succeeds", baseline.status === 200, JSON.stringify(baseline.body));

// This isn't just "did the endpoint return 200" — it builds the manifest URL the exact same
// way player.ts does (https://customer-<code>.cloudflarestream.com/<token>/manifest/video.m3u8)
// and actually fetches it. Caught a real bug this way: index.ts and player.ts were both
// missing the "customer-" prefix, returning 200 from /api/token (the token itself mints fine)
// while the manifest URL built from it 404'd — AT1/AT2 never caught this because they always
// constructed URLs directly with the correct prefix, never through this code path.
if (baseline.status === 200 && baseline.body?.token) {
  const manifestUrl = `https://customer-${devVars.STREAM_CUSTOMER_CODE}.cloudflarestream.com/${baseline.body.token}/manifest/video.m3u8`;
  const manifestRes = await fetch(manifestUrl);
  check(
    "baseline: the token's manifest URL, built the same way player.ts does, actually works",
    manifestRes.status === 200,
    `status ${manifestRes.status}`,
  );
}

// --- AT6: no entitlement for this video ---
const [otherVideo] = (await rest("videos?stream_uid=neq." + encodeURIComponent(devVars.STAGE1_VIDEO_UID) + "&limit=1")).body ?? [];
if (otherVideo) {
  const noEnt = await requestToken(otherVideo.id, a.key);
  check("AT6: no entitlement for video is refused", noEnt.status === 403, JSON.stringify(noEnt.body));
} else {
  console.log("SKIP  AT6: no second video in the catalogue to test non-entitlement against");
}

// --- AT5: play after term_end ---
{
  const { body: [before] } = await rest(`clients?id=eq.${a.clientId}&select=term_end`);
  await patchClient(a.clientId, { term_end: "2000-01-01" });
  const afterTermEnd = await requestToken(videoId, a.key);
  check("AT5: play after term_end is refused", afterTermEnd.status === 403, JSON.stringify(afterTermEnd.body));
  await patchClient(a.clientId, { term_end: before.term_end });
}

// --- AT4: paused client ---
{
  await patchClient(a.clientId, { status: "paused" });
  const paused = await requestToken(videoId, a.key);
  check("AT4: paused client is refused immediately", paused.status === 403, JSON.stringify(paused.body));
  await patchClient(a.clientId, { status: "active" });
}

// --- AT3: key rotation (revocation) stops playback ---
{
  await rest(`access_keys?client_id=eq.${a.clientId}&key=eq.${a.key}`, {
    method: "PATCH",
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  const revoked = await requestToken(videoId, a.key);
  check(
    "AT3: revoked key is refused (no KV cache means this is immediate, well under 60s)",
    revoked.status === 403,
    JSON.stringify(revoked.body),
  );
  await rest(`access_keys?client_id=eq.${a.clientId}&key=eq.${a.key}`, {
    method: "PATCH",
    body: JSON.stringify({ revoked_at: null }),
  });
}

// --- AT11/AT12/AT13: billing state transitions ---
{
  const { body: [before] } = await rest(`clients?id=eq.${a.clientId}&select=paid_to,billing_state,grace_days`);
  const today = new Date();
  const pastDue = new Date(today);
  pastDue.setDate(pastDue.getDate() - 5); // 5 days past paid_to — inside 30-day grace
  await patchClient(a.clientId, { paid_to: pastDue.toISOString().slice(0, 10), billing_state: "due" });
  const due = await requestToken(videoId, a.key);
  check("AT11: past paid_to but within grace ('due') still plays", due.status === 200, JSON.stringify(due.body));

  const pastGrace = new Date(today);
  pastGrace.setDate(pastGrace.getDate() - (before.grace_days + 5)); // past paid_to + grace_days
  await patchClient(a.clientId, { paid_to: pastGrace.toISOString().slice(0, 10), billing_state: "overdue" });
  const overdue = await requestToken(videoId, a.key);
  check("AT12: past paid_to + grace_days ('overdue') is blocked", overdue.status === 403, JSON.stringify(overdue.body));

  // AT13: marking paid restores playback immediately, no link reissue (same key throughout).
  const termEnd = new Date(today);
  termEnd.setFullYear(termEnd.getFullYear() + 1);
  await patchClient(a.clientId, {
    billing_state: "paid",
    paid_to: termEnd.toISOString().slice(0, 10),
  });
  const restored = await requestToken(videoId, a.key);
  check("AT13: marking paid restores playback with the same key", restored.status === 200, JSON.stringify(restored.body));

  await patchClient(a.clientId, { paid_to: before.paid_to, billing_state: before.billing_state });
}

// --- AT10: the mark-paid admin action advances paid_to, sets paid, and logs billing_events ---
{
  const { body: [before] } = await rest(`clients?id=eq.${a.clientId}&select=paid_to,term_start,term_end`);
  const beforeEvents = await rest(`billing_events?client_id=eq.${a.clientId}&action=eq.marked_paid&select=id`);

  const res = await fetch(`${WORKER_URL}/internal/clients/${a.clientId}/mark-paid`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ reference: "AT10-test-invoice" }),
  });
  const markPaidBody = await res.json().catch(() => null);
  check("AT10: mark-paid endpoint succeeds", res.status === 200, JSON.stringify(markPaidBody));

  const { body: [afterClient] } = await rest(`clients?id=eq.${a.clientId}&select=paid_to,billing_state`);
  check(
    "AT10: paid_to advanced and billing_state set to paid",
    afterClient?.billing_state === "paid" && new Date(afterClient.paid_to) > new Date(before.paid_to),
    JSON.stringify(afterClient),
  );

  const afterEvents = await rest(`billing_events?client_id=eq.${a.clientId}&action=eq.marked_paid&select=*&order=occurred_at.desc&limit=5`);
  const beforeIds = new Set((beforeEvents.body ?? []).map((r) => r.id));
  const newEvent = (afterEvents.body ?? []).find((r) => !beforeIds.has(r.id));
  check(
    "AT10: a billing_events row was written with actor and timestamp",
    !!newEvent && newEvent.actor === adminTest.testAdmin.email && !!newEvent.occurred_at,
    JSON.stringify(newEvent),
  );
}

// --- AT9: advisory cap value never appears in the token response ---
{
  const res = await requestToken(videoId, a.key);
  const text = JSON.stringify(res.body);
  check("AT9: daily_cap_advisory never appears in the token response", !text.includes("daily_cap_advisory") && !text.includes("cap"), text);
}

// --- AT17: every play writes a play_events row with a hashed address, no raw address ---
{
  const before = await rest(`play_events?client_id=eq.${a.clientId}&select=id&order=occurred_at.desc&limit=1`);
  await requestToken(videoId, a.key);
  await new Promise((r) => setTimeout(r, 500));
  const after = await rest(`play_events?client_id=eq.${a.clientId}&select=*&order=occurred_at.desc&limit=1`);
  const beforeIds = new Set((before.body ?? []).map((r) => r.id));
  const newRow = (after.body ?? []).find((r) => !beforeIds.has(r.id));
  check("AT17: a new play_events row was written", !!newRow, JSON.stringify(after.body));
  if (newRow) {
    check(
      "AT17: address_hash looks hashed, not a raw IP",
      typeof newRow.address_hash === "string" && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(newRow.address_hash),
      newRow.address_hash,
    );
  }
}

// --- AT8: exceeding the advisory cap raises an alert and does NOT stop playback ---
{
  await patchClient(a.clientId, { daily_cap_advisory: 0 }); // guarantees the next play exceeds it
  const stillPlays = await requestToken(videoId, a.key);
  check("AT8: playback still succeeds despite exceeding the cap", stillPlays.status === 200, JSON.stringify(stillPlays.body));
  await new Promise((r) => setTimeout(r, 500));
  const startOfToday = new Date().toISOString().slice(0, 10) + "T00:00:00Z";
  const todaysAlerts = await rest(
    `alerts?client_id=eq.${a.clientId}&type=eq.advisory_cap_exceeded&raised_at=gte.${startOfToday}&select=id`,
  );
  check(
    // Same-day repeats deliberately don't create a second alert (dedup in
    // recomputeUsageDailyAndCheckCap) — so "at least one today" is the right check,
    // not "count went up", which would fail on a second run within the same day.
    "AT8: an advisory_cap_exceeded alert exists for today",
    (todaysAlerts.body?.length ?? 0) > 0,
    JSON.stringify(todaysAlerts.body),
  );
  await patchClient(a.clientId, { daily_cap_advisory: 50 });
}

process.exit(fail);
