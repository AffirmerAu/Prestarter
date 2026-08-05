// New admin actions: download a caption's raw WebVTT file, and remove a caption (reviewed or
// not) entirely — both the video_languages row and the underlying file on Cloudflare Stream,
// with an audit_log record of who removed it.
//
// Usage: start `wrangler dev`, then node at-caption-remove-download.mjs
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
const languageTag = "it"; // unlikely to collide with anything else on this test-only video
const vttLine = "Caption for the remove/download test.";
const vtt = `WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n${vttLine}\n`;

const form = new FormData();
form.set("file", new Blob([vtt], { type: "text/vtt" }), `${languageTag}.vtt`);
form.set("language_tag", languageTag);
form.set("label_native", "Italiano");
form.set("is_default", "false");
const uploadRes = await fetch(`${WORKER_URL}/internal/videos/${videoId}/captions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${adminToken}` },
  body: form,
});
const uploadBody = await uploadRes.json();
check("setup: caption upload succeeds", uploadRes.status === 200, JSON.stringify(uploadBody));
const videoLanguageId = uploadBody.id;

// --- Download the raw .vtt back ---
const vttRes = await fetch(`${WORKER_URL}/internal/video-languages/${videoLanguageId}/vtt`, {
  headers: { Authorization: `Bearer ${adminToken}` },
});
const vttBody = await vttRes.text();
check("vtt download succeeds", vttRes.status === 200, `status ${vttRes.status}`);
check("vtt download has the right content type", (vttRes.headers.get("content-type") || "").includes("text/vtt"), vttRes.headers.get("content-type"));
check(
  "vtt download has a Content-Disposition attachment filename",
  (vttRes.headers.get("content-disposition") || "").includes(`${languageTag}.vtt`),
  vttRes.headers.get("content-disposition"),
);
check("downloaded content matches what was uploaded", vttBody.includes(vttLine), vttBody);

// --- Mark reviewed, to prove removal works on a REVIEWED caption too, not just unreviewed ---
const reviewRes = await fetch(`${WORKER_URL}/internal/video-languages/${videoLanguageId}/mark-reviewed`, {
  method: "POST",
  headers: { Authorization: `Bearer ${adminToken}` },
});
check("setup: mark-reviewed succeeds", reviewRes.status === 200, `status ${reviewRes.status}`);

// --- Remove it ---
const deleteRes = await fetch(`${WORKER_URL}/internal/video-languages/${videoLanguageId}/delete`, {
  method: "POST",
  headers: { Authorization: `Bearer ${adminToken}` },
});
check("removing a REVIEWED caption succeeds", deleteRes.status === 200, `status ${deleteRes.status}`);

const rowAfter = (await rest(`video_languages?id=eq.${videoLanguageId}&select=id`)).body ?? [];
check("video_languages row is gone", rowAfter.length === 0, JSON.stringify(rowAfter));

const streamCaptionsAfter = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/${devVars.STAGE1_VIDEO_UID}/captions`,
  { headers: { Authorization: `Bearer ${STREAM_TOKEN}` } },
).then((r) => r.json());
const stillOnStream = streamCaptionsAfter.result?.find((c) => c.language === languageTag);
check("caption is gone from Cloudflare Stream too", !stillOnStream, JSON.stringify(stillOnStream));

const auditRow = (
  await rest(
    `audit_log?subject_type=eq.video_languages&subject_id=eq.${videoLanguageId}&action=eq.remove_caption&select=actor&order=occurred_at.desc&limit=1`,
  )
).body?.[0];
check("audit_log records who removed it", auditRow?.actor === adminTest.testAdmin.email, JSON.stringify(auditRow));

process.exit(fail);
