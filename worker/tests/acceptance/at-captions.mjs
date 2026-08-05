// Caption management (spec section 8) — no dedicated spec section 18 acceptance test number,
// but D23/section 8 both require: uploaded captions land unreviewed by default (a
// mistranslated safety instruction is a liability, not a typo), and become reviewed only via
// an explicit action that records who and when.
//
// Verifies against the real Cloudflare Stream account (captions actually land there, not just
// in our own DB) and the real admin auth flow.
//
// Usage: start `wrangler dev`, then node at-captions.mjs
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
const orgs = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "..", "supabase", "seed", "test-orgs.json"), "utf8"));
const adminTest = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "..", "supabase", "seed", "admin-test.json"), "utf8"));

const SUPABASE_URL = devVars.SUPABASE_URL;
const ANON_KEY = devVars.SUPABASE_ANON_KEY;
const SERVICE_KEY = devVars.SUPABASE_SERVICE_ROLE_KEY;
const ACCOUNT_ID = devVars.CF_ACCOUNT_ID;
const STREAM_TOKEN = devVars.CF_STREAM_API_TOKEN;
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

async function signInAsClient(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`client sign-in failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function clientCanSeeCaption(clientToken, videoId, languageTag) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/video_languages?video_id=eq.${videoId}&language_tag=eq.${languageTag}&select=id`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${clientToken}` } },
  );
  const body = await res.json();
  return Array.isArray(body) && body.length > 0;
}

const adminToken = await signInAsAdmin();
const clientToken = await signInAsClient(orgs["Acme Pty Ltd"].email, orgs["Acme Pty Ltd"].password);
const videoId = orgs.videoId;
// Cloudflare Stream's captions endpoint validates this as a real BCP-47 language code (a
// synthetic unique-per-run tag gets a 400) — "de" is unlikely to collide with anything real
// on this test-only video, and the test cleans it up from Stream at the end either way.
const languageTag = "de";

const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nTest caption line.\n";

// --- Upload lands unreviewed, and actually reaches Cloudflare Stream ---
const form = new FormData();
form.set("file", new Blob([vtt], { type: "text/vtt" }), `${languageTag}.vtt`);
form.set("language_tag", languageTag);
form.set("label_native", "Test Language");
form.set("is_default", "false");

const uploadRes = await fetch(`${WORKER_URL}/internal/videos/${videoId}/captions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${adminToken}` },
  body: form,
});
const uploadBody = await uploadRes.json();
check("caption upload succeeds", uploadRes.status === 200, JSON.stringify(uploadBody));
check("upload response reports unreviewed", uploadBody.reviewed === false, JSON.stringify(uploadBody));

const dbRow = (await rest(`video_languages?id=eq.${uploadBody.id}&select=*`)).body?.[0];
check("video_languages row has reviewed_at = null", dbRow && dbRow.reviewed_at === null, JSON.stringify(dbRow));
check("video_languages row records source=uploaded", dbRow?.source === "uploaded", JSON.stringify(dbRow));

const streamCaptions = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/${devVars.STAGE1_VIDEO_UID}/captions`,
  { headers: { Authorization: `Bearer ${STREAM_TOKEN}` } },
).then((r) => r.json());
const onStream = streamCaptions.result?.find((c) => c.language === languageTag);
check("caption actually landed on Cloudflare Stream, not just our DB", !!onStream && onStream.status === "ready", JSON.stringify(onStream));

// --- Spec section 8: unreviewed captions must not reach a client — enforced at the RLS
// layer (0006_hide_unreviewed_captions.sql), not just filtered in a UI a client could bypass
// by calling the API directly, which is exactly what this checks. ---
check(
  "entitled client CANNOT see the unreviewed caption via direct RLS-scoped query",
  !(await clientCanSeeCaption(clientToken, videoId, languageTag)),
);

// --- Mark reviewed sets reviewed_at and logs who/when to audit_log ---
const reviewRes = await fetch(`${WORKER_URL}/internal/video-languages/${uploadBody.id}/mark-reviewed`, {
  method: "POST",
  headers: { Authorization: `Bearer ${adminToken}` },
});
check("mark-reviewed succeeds", reviewRes.status === 200, `status ${reviewRes.status}`);

const reviewedRow = (await rest(`video_languages?id=eq.${uploadBody.id}&select=reviewed_at`)).body?.[0];
check("reviewed_at is now set", !!reviewedRow?.reviewed_at, JSON.stringify(reviewedRow));

const auditRow = (
  await rest(
    `audit_log?subject_type=eq.video_languages&subject_id=eq.${uploadBody.id}&action=eq.review_caption&select=actor&order=occurred_at.desc&limit=1`,
  )
).body?.[0];
check("audit_log records who reviewed it", auditRow?.actor === adminTest.testAdmin.email, JSON.stringify(auditRow));

check(
  "entitled client CAN see the caption once it's reviewed",
  await clientCanSeeCaption(clientToken, videoId, languageTag),
);

// --- Cleanup: remove the test caption from Stream and our DB ---
await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/${devVars.STAGE1_VIDEO_UID}/captions/${languageTag}`,
  { method: "DELETE", headers: { Authorization: `Bearer ${STREAM_TOKEN}` } },
);
await rest(`video_languages?id=eq.${uploadBody.id}`, { method: "DELETE" });

process.exit(fail);
