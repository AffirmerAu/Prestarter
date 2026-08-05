// Spec section 6 step 6 / section 8 point 4: the token response carries "the available
// caption languages", and the player exposes a caption menu built from them — reviewed
// languages only, unreviewed ones excluded even though they belong to an entitled video.
//
// This checks the /api/token data contract the player.ts caption menu is built from; the
// actual DOM-level menu interaction and locale-matching logic is browser behaviour, checked
// manually per the acceptance sweep, not scriptable here.
//
// Usage: start `wrangler dev`, then node at-caption-menu.mjs
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

async function uploadAndMaybeReview(adminToken, videoId, languageTag, labelNative, isDefault, review) {
  const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nTest caption line.\n";
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
  if (review) {
    const reviewRes = await fetch(`${WORKER_URL}/internal/video-languages/${uploadBody.id}/mark-reviewed`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (reviewRes.status !== 200) throw new Error(`mark-reviewed failed: ${reviewRes.status}`);
  }
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

// Two reviewed languages (one is_default) plus one deliberately left unreviewed, all on the
// same entitled video — proves the menu's data source is reviewed-only, not just "does this
// video have any captions at all".
const deId = await uploadAndMaybeReview(adminToken, videoId, "de", "Deutsch", true, true);
const frId = await uploadAndMaybeReview(adminToken, videoId, "fr", "Français", false, true);
const jaId = await uploadAndMaybeReview(adminToken, videoId, "ja", "日本語", false, false); // left unreviewed

try {
  const res = await fetch(`${WORKER_URL}/api/token?videoId=${videoId}&k=${a.key}`);
  const body = await res.json();

  check("token request succeeds", res.status === 200, JSON.stringify(body));
  check("response includes a languages array", Array.isArray(body.languages), JSON.stringify(body.languages));

  const tags = (body.languages || []).map((l) => l.languageTag);
  check("reviewed German caption is present", tags.includes("de"), JSON.stringify(tags));
  check("reviewed French caption is present", tags.includes("fr"), JSON.stringify(tags));
  check("unreviewed Japanese caption is NOT present", !tags.includes("ja"), JSON.stringify(tags));

  const de = (body.languages || []).find((l) => l.languageTag === "de");
  check("German entry carries the native label", de?.labelNative === "Deutsch", JSON.stringify(de));
  check("German entry is flagged as the default track", de?.isDefault === true, JSON.stringify(de));

  const fr = (body.languages || []).find((l) => l.languageTag === "fr");
  check("French entry is not flagged default", fr?.isDefault === false, JSON.stringify(fr));

  // ?lang= preselection (spec section 8 point 1) — same data contract, just requested with
  // the query param a real player link would carry.
  const langRes = await fetch(`${WORKER_URL}/api/token?videoId=${videoId}&k=${a.key}&lang=fr`);
  check("token request with ?lang= still succeeds", langRes.status === 200, `status ${langRes.status}`);
} finally {
  await cleanupCaption(deId, devVars.STAGE1_VIDEO_UID, "de");
  await cleanupCaption(frId, devVars.STAGE1_VIDEO_UID, "fr");
  await cleanupCaption(jaId, devVars.STAGE1_VIDEO_UID, "ja");
}

process.exit(fail);
