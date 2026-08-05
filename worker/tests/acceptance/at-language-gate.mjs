// Language gate (spec: pre-play language selection screen). The gate needs the language
// list before any tap happens, but must NOT fire a play event just from being shown — that's
// the whole reason /api/languages exists as a separate, read-only endpoint from /api/token.
// This checks that server-side contract; the gate's own DOM/interaction behaviour (grid
// rendering, focus trap, localStorage persistence, ?lang= bypass) is browser behaviour,
// checked manually / via the Browser tool, not scriptable here.
//
// Usage: start `wrangler dev`, then node at-language-gate.mjs
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

async function uploadAndReview(adminToken, videoId, languageTag, labelNative, isDefault) {
  const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nGate test caption.\n";
  const form = new FormData();
  form.set("file", new Blob([vtt], { type: "text/vtt" }), `${languageTag}.vtt`);
  form.set("language_tag", languageTag);
  form.set("label_native", labelNative);
  form.set("is_default", String(isDefault));
  const uploadRes = await fetch(`${WORKER_URL}/internal/videos/${videoId}/captions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: form,
  });
  const uploadBody = await uploadRes.json();
  if (uploadRes.status !== 200) throw new Error(`caption upload failed: ${JSON.stringify(uploadBody)}`);
  const reviewRes = await fetch(`${WORKER_URL}/internal/video-languages/${uploadBody.id}/mark-reviewed`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (reviewRes.status !== 200) throw new Error(`mark-reviewed failed: ${reviewRes.status}`);
  return uploadBody.id;
}

async function cleanupCaption(id, videoUid, languageTag) {
  await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/${videoUid}/captions/${languageTag}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${STREAM_TOKEN}` },
  });
  await rest(`video_languages?id=eq.${id}`, { method: "DELETE" });
}

const adminToken = await signInAsAdmin();
const videoId = orgs.videoId;
const a = orgs["Acme Pty Ltd"];

const koId = await uploadAndReview(adminToken, videoId, "ko", "한국어", true);
const viId = await uploadAndReview(adminToken, videoId, "vi", "Tiếng Việt", false);

try {
  // --- Basic contract: same shape as /api/token's languages array ---
  const res = await fetch(`${WORKER_URL}/api/languages?videoId=${videoId}&k=${a.key}`);
  const body = await res.json();
  check("request succeeds", res.status === 200, JSON.stringify(body));
  const tags = (body.languages || []).map((l) => l.languageTag);
  check("Korean caption is present", tags.includes("ko"), JSON.stringify(tags));
  check("Vietnamese caption is present", tags.includes("vi"), JSON.stringify(tags));
  const ko = (body.languages || []).find((l) => l.languageTag === "ko");
  check("Korean entry is flagged default", ko?.isDefault === true, JSON.stringify(ko));

  // --- The whole point: this must NOT count as a play ---
  const before = await rest(
    `play_events?client_id=eq.${a.clientId}&video_id=eq.${videoId}&select=id&order=occurred_at.desc&limit=1`,
  );
  const beforeLatestId = before.body?.[0]?.id ?? null;

  await fetch(`${WORKER_URL}/api/languages?videoId=${videoId}&k=${a.key}`);
  await fetch(`${WORKER_URL}/api/languages?videoId=${videoId}&k=${a.key}`);
  await fetch(`${WORKER_URL}/api/languages?videoId=${videoId}&k=${a.key}`);

  const after = await rest(
    `play_events?client_id=eq.${a.clientId}&video_id=eq.${videoId}&select=id&order=occurred_at.desc&limit=1`,
  );
  const afterLatestId = after.body?.[0]?.id ?? null;
  check(
    "three /api/languages hits recorded zero play_events (unlike /api/token)",
    afterLatestId === beforeLatestId,
    `before=${beforeLatestId} after=${afterLatestId}`,
  );

  // --- A bad key gets nothing back, same as /api/token ---
  const badRes = await fetch(`${WORKER_URL}/api/languages?videoId=${videoId}&k=not-a-real-key`);
  check("invalid key is denied", badRes.status === 403, `status ${badRes.status}`);

  // --- Missing params denied, not a crash ---
  const missingRes = await fetch(`${WORKER_URL}/api/languages?videoId=${videoId}`);
  check("missing access key is denied", missingRes.status === 403, `status ${missingRes.status}`);
} finally {
  await cleanupCaption(koId, devVars.STAGE1_VIDEO_UID, "ko");
  await cleanupCaption(viId, devVars.STAGE1_VIDEO_UID, "vi");
}

process.exit(fail);
