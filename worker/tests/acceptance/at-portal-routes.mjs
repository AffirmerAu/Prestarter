// Client-portal-only Worker routes (spec section 11): QR/poster export scoped to the caller's
// own client (never another's — clientId always comes from the session, never the URL), and
// the "HLS manifest" link format's stable redirect.
//
// Usage: start `wrangler dev`, then node at-portal-routes.mjs
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

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(body)}`);
  return body.access_token;
}

const a = orgs["Acme Pty Ltd"];
const tokenA = await signIn(a.email, a.password);

// --- Portal QR/poster export work for the caller's own client ---
const qrRes = await fetch(`${WORKER_URL}/portal/videos/${orgs.videoId}/qr.png`, {
  headers: { Authorization: `Bearer ${tokenA}` },
});
check("portal QR export succeeds for the caller's own video", qrRes.status === 200, `status ${qrRes.status}`);

const posterRes = await fetch(`${WORKER_URL}/portal/poster.png`, { headers: { Authorization: `Bearer ${tokenA}` } });
check("portal poster export succeeds", posterRes.status === 200, `status ${posterRes.status}`);

// --- No auth at all is refused ---
const noAuth = await fetch(`${WORKER_URL}/portal/poster.png`);
check("portal export refuses an unauthenticated request", noAuth.status === 401, `status ${noAuth.status}`);

// --- The manifest link redirects to a working manifest, built the same way player.ts does ---
const manifestRes = await fetch(`${WORKER_URL}/m/${orgs.videoId}?k=${a.key}`);
check("manifest link resolves to a working HLS manifest", manifestRes.status === 200, `status ${manifestRes.status}`);
const manifestText = await manifestRes.text();
check("manifest link response looks like a real HLS manifest", manifestText.startsWith("#EXTM3U"), manifestText.slice(0, 60));

// --- The manifest link honours entitlement checks, same as /api/token ---
const badKey = await fetch(`${WORKER_URL}/m/${orgs.videoId}?k=not-a-real-key`);
check("manifest link refuses an invalid key", badKey.status === 403, `status ${badKey.status}`);

process.exit(fail);
