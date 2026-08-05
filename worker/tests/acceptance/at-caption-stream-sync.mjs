// Spec section 8: a caption can land on Cloudflare Stream without ever going through our own
// upload endpoint (e.g. uploaded directly via Stream's dashboard) — this checks the
// "register from Stream" admin flow that makes such a caption visible to us at all, while
// still enforcing the same reviewed_at gate as a normal upload (existing on Stream is not
// the same as human-reviewed for accuracy).
//
// Usage: start `wrangler dev`, then node at-caption-stream-sync.mjs
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

const adminToken = await signInAsAdmin();
const videoId = orgs.videoId;
const a = orgs["Acme Pty Ltd"];
const languageTag = "pt"; // unlikely to collide with anything else on this test-only video
const streamUid = devVars.STAGE1_VIDEO_UID;

// --- Simulate "uploaded directly via Stream's own dashboard" by hitting Stream's API
// directly, bypassing our /internal/videos/:id/captions endpoint entirely. ---
const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nSynced from Stream directly.\n";
const putForm = new FormData();
putForm.set("file", new Blob([vtt], { type: "text/vtt" }), `${languageTag}.vtt`);
const putRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/${streamUid}/captions/${languageTag}`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${STREAM_TOKEN}` },
  body: putForm,
});
check("setup: caption lands on Stream directly (simulating the dashboard)", putRes.ok, `status ${putRes.status}`);

let videoLanguageId;
try {
  // --- The video-detail endpoint should surface it as unsynced ---
  const detailRes = await fetch(`${WORKER_URL}/internal/videos/${videoId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const detail = await detailRes.json();
  const unsynced = (detail.unsyncedStreamCaptions || []).find((c) => c.language_tag === languageTag);
  check("video detail lists the Stream-only caption as unsynced", !!unsynced, JSON.stringify(detail.unsyncedStreamCaptions));

  // --- Registering it creates our own row, unreviewed ---
  const registerRes = await fetch(`${WORKER_URL}/internal/videos/${videoId}/captions/register-from-stream`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ language_tag: languageTag, label_native: "Português", is_default: false }),
  });
  const registerBody = await registerRes.json();
  check("register-from-stream succeeds", registerRes.status === 200, JSON.stringify(registerBody));
  check("registered row reports unreviewed", registerBody.reviewed === false, JSON.stringify(registerBody));
  videoLanguageId = registerBody.id;

  const dbRow = (await rest(`video_languages?id=eq.${videoLanguageId}&select=*`)).body?.[0];
  check("row records source=stream_sync", dbRow?.source === "stream_sync", JSON.stringify(dbRow));
  check("row has reviewed_at = null despite already existing on Stream", dbRow?.reviewed_at === null, JSON.stringify(dbRow));

  // --- Registering the same language again is rejected, not silently duplicated ---
  const dupeRes = await fetch(`${WORKER_URL}/internal/videos/${videoId}/captions/register-from-stream`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ language_tag: languageTag, label_native: "Português", is_default: false }),
  });
  check("registering the same language twice is rejected", dupeRes.status === 409, `status ${dupeRes.status}`);

  // --- Still excluded from the client-facing token response until reviewed ---
  const preReviewToken = await fetch(`${WORKER_URL}/api/token?videoId=${videoId}&k=${a.key}`).then((r) => r.json());
  const preTags = (preReviewToken.languages || []).map((l) => l.languageTag);
  check("unreviewed synced caption is NOT in the client-facing token response", !preTags.includes(languageTag), JSON.stringify(preTags));

  // --- Mark reviewed, then it appears ---
  const reviewRes = await fetch(`${WORKER_URL}/internal/video-languages/${videoLanguageId}/mark-reviewed`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  check("mark-reviewed succeeds", reviewRes.status === 200, `status ${reviewRes.status}`);

  const postReviewToken = await fetch(`${WORKER_URL}/api/token?videoId=${videoId}&k=${a.key}`).then((r) => r.json());
  const postTags = (postReviewToken.languages || []).map((l) => l.languageTag);
  check("reviewed synced caption now appears in the token response", postTags.includes(languageTag), JSON.stringify(postTags));
} finally {
  await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/${streamUid}/captions/${languageTag}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${STREAM_TOKEN}` },
  });
  if (videoLanguageId) await rest(`video_languages?id=eq.${videoLanguageId}`, { method: "DELETE" });
}

process.exit(fail);
