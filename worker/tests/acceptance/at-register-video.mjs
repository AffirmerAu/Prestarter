// Admin console "register video from Stream" flow — a video uploaded directly via
// Cloudflare Stream's own dashboard (rather than through this console, which has no video
// upload flow of its own) has no videos row until an admin explicitly registers it. Not a
// numbered spec section 18 acceptance test (new scope beyond the original spec), written
// before/alongside the implementation per this project's working agreement.
//
// Deliberately does NOT touch the shared stage-1 test video's own row — entitlements and
// nearly every other acceptance suite's fixtures foreign-key to it (test-orgs.json), so
// deleting/reinserting it to simulate "unregistered" would be genuinely risky. Instead this
// proves the three things safely testable without a disposable spare Stream video: field
// validation, a nonexistent stream_uid being rejected rather than silently creating a row,
// and re-registering an already-registered video being rejected (which, as a side effect,
// also proves the requireSignedURLs check passes for a real video — if it didn't, the
// handler would 400 on that before ever reaching the "already registered" check).
//
// Usage: start `wrangler dev`, then node at-register-video.mjs
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
const WORKER_URL = process.env.WORKER_URL || "http://127.0.0.1:8787";

let fail = 0;
function check(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`);
  else {
    console.log(`FAIL  ${label}${detail ? " — " + detail : ""}`);
    fail = 1;
  }
}

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
const streamUid = devVars.STAGE1_VIDEO_UID; // real, already-registered video — read-only use here

// --- GET /internal/videos returns the new shape ---
const listRes = await fetch(`${WORKER_URL}/internal/videos`, { headers: { Authorization: `Bearer ${adminToken}` } });
const listBody = await listRes.json();
check("videos list succeeds", listRes.status === 200, `status ${listRes.status}`);
check("response has a videos array", Array.isArray(listBody.videos), JSON.stringify(Object.keys(listBody)));
check("response has an unregisteredStreamVideos array", Array.isArray(listBody.unregisteredStreamVideos), JSON.stringify(Object.keys(listBody)));

// --- Missing required fields is rejected ---
const badRes = await fetch(`${WORKER_URL}/internal/videos`, {
  method: "POST",
  headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ stream_uid: streamUid }),
});
check("missing required fields is rejected", badRes.status === 400, `status ${badRes.status}`);

// --- A stream_uid with no matching Stream video is rejected, not silently created ---
const fakeRes = await fetch(`${WORKER_URL}/internal/videos`, {
  method: "POST",
  headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    stream_uid: "0000000000000000000000000000000000000000",
    title: "x",
    display_code: `at-register-video-fake-${Date.now()}`,
    category: "x",
  }),
});
check("a stream_uid with no matching Stream video is rejected", fakeRes.status === 404, `status ${fakeRes.status}`);

// --- Re-registering the already-registered stage-1 test video is rejected, not duplicated —
// and getting to this 409 (rather than a 400) confirms it passed the requireSignedURLs check
// along the way. ---
const dupeRes = await fetch(`${WORKER_URL}/internal/videos`, {
  method: "POST",
  headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    stream_uid: streamUid,
    title: "dup",
    display_code: `at-register-video-dupe-${Date.now()}`,
    category: "dup",
  }),
});
const dupeBody = await dupeRes.json();
check("re-registering an already-registered video is rejected", dupeRes.status === 409, JSON.stringify(dupeBody));

process.exit(fail);
