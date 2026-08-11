// Admin console "password login only, no magic link" — user-reported requirement. Admin and
// client-portal sign-in share the same Supabase Auth backend, so removing the magic-link
// button from the admin UI alone wouldn't stop someone requesting a magic link for an
// admin's email through the PORTAL's own login form instead and using that session against
// the admin API — requireAdmin (admin-auth.ts) has to actually reject a non-password
// session, not just rely on the UI never offering one.
//
// Generates a real magic-link session via Supabase's admin generate_link + verify endpoints
// (no email actually sent — Supabase's magic-link email delivery has its own separate,
// pre-existing outage in this project, see at-client-login-gate.mjs) so this is a genuine
// end-to-end check against a real otp-derived session, not a hand-constructed token.
//
// Usage: start `wrangler dev`, then node at-admin-password-only.mjs
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

// --- Password login works and reaches an admin route (the real, only production admin) ---
const passRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: adminTest.testAdmin.email, password: adminTest.testAdmin.password }),
});
const passBody = await passRes.json();
check("password sign-in succeeds", passRes.status === 200, JSON.stringify(passBody));
const passwordToken = passBody.access_token;

const passwordApiRes = await fetch(`${WORKER_URL}/internal/dashboard`, { headers: { Authorization: `Bearer ${passwordToken}` } });
check("a password-derived admin session can call an admin route", passwordApiRes.status === 200, `status ${passwordApiRes.status}`);

// --- A magic-link (otp) session for the SAME admin account must be refused ---
const genRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email: adminTest.testAdmin.email }),
});
const genBody = await genRes.json();
const hashedToken = genBody.hashed_token ?? genBody.properties?.hashed_token;
check("setup: generated a magic-link token for the test admin", genRes.status === 200 && !!hashedToken, JSON.stringify(genBody));

const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
  method: "POST",
  headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", token_hash: hashedToken }),
});
const verifyBody = await verifyRes.json();
const otpToken = verifyBody.access_token;
check("setup: verifying it produces a real session", verifyRes.status === 200 && !!otpToken, JSON.stringify(verifyBody));

const otpPayload = JSON.parse(Buffer.from(otpToken.split(".")[1], "base64url").toString());
check("sanity: the session's amr really is otp-derived, not password", otpPayload.amr?.every((m) => m.method === "otp"), JSON.stringify(otpPayload.amr));

const otpApiRes = await fetch(`${WORKER_URL}/internal/dashboard`, { headers: { Authorization: `Bearer ${otpToken}` } });
const otpApiBody = await otpApiRes.json();
check("a magic-link-derived admin session is refused (must use a password)", otpApiRes.status === 403, JSON.stringify(otpApiBody));

process.exit(fail);
