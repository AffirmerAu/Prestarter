// AT15 (spec section 18): the client portal contains no play count, cap, percentage,
// entitlement count or remaining allowance, verified by inspecting the rendered page and the
// network responses.
//
// Checks every network response the portal actually makes (direct Supabase REST queries via
// RLS, plus the Worker's /portal/* export routes) for forbidden terms. Rendered-page text is
// checked separately with the Browser tool during manual verification (see session notes) —
// this script covers the network-response half precisely, and the component source for the
// rendered-page half (the portal only ever displays fields it explicitly destructures, so if
// a forbidden field isn't in these responses, it can't appear on the page either).
//
// Usage: node at15-portal-no-usage-figures.mjs
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

// Forbidden as *keys* in the JSON (not substrings of the whole body — "duration_seconds" or
// "display_code" would false-positive on a substring match against e.g. "count").
const FORBIDDEN_KEYS = [
  "daily_cap_advisory",
  "plays",
  "play_count",
  "distinct_addresses",
  "countries",
  "entitlement_count",
  "remaining",
  "allowance",
  "percentage",
  "cap",
];

function findForbiddenKeys(value, pathSoFar = "") {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findForbiddenKeys(v, `${pathSoFar}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.includes(k)) hits.push(`${pathSoFar}.${k}`);
      hits.push(...findForbiddenKeys(v, `${pathSoFar}.${k}`));
    }
  }
  return hits;
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

const a = orgs["Acme Pty Ltd"];
const clientToken = await signIn(a.email, a.password);

const restCalls = [
  "client_safe_status?select=*",
  "entitlements?select=video_id,videos(id,title,duration_seconds,display_code)",
  "video_languages?select=*&kind=eq.caption",
  "access_keys?select=key",
];

for (const call of restCalls) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${call}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${clientToken}` },
  });
  const body = await res.json();
  const hits = findForbiddenKeys(body);
  check(`no forbidden keys in GET ${call.split("?")[0]}`, hits.length === 0, JSON.stringify(hits));
}

// The Worker's /portal/* routes only ever return binary image data (SVG/PNG), never JSON with
// figures — confirm the content-type, since that's the actual guarantee here.
const qrRes = await fetch(`${WORKER_URL}/portal/videos/${orgs.videoId}/qr.svg`, {
  headers: { Authorization: `Bearer ${clientToken}` },
});
check(
  "portal QR export returns an image, not a JSON body that could carry figures",
  (qrRes.headers.get("content-type") ?? "").startsWith("image/"),
  qrRes.headers.get("content-type"),
);

process.exit(fail);
