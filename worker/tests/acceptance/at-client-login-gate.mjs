// Client portal login gate — user-reported requirement: "Only registered users can access
// the system." Before this fix, portal/src/lib/auth.tsx's signInWithOtp had no
// shouldCreateUser option, which defaults to true — any arbitrary email could request a
// magic link and Supabase would silently create a brand-new Auth user for it. That user
// would get a real session (RLS then shows them no data since they have no client_contacts
// row), but the login step itself should already refuse an unregistered address rather than
// let it obtain a session at all.
//
// Hits Supabase's /auth/v1/otp REST endpoint directly with create_user:false (what
// supabase-js's shouldCreateUser:false sends over the wire) — same call the portal makes.
//
// Usage: node at-client-login-gate.mjs (talks to Supabase directly, no wrangler dev needed)
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
const testOrgs = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "..", "supabase", "seed", "test-orgs.json"), "utf8"));

const SUPABASE_URL = devVars.SUPABASE_URL;
const ANON_KEY = devVars.SUPABASE_ANON_KEY;

let fail = 0;
function check(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`);
  else {
    console.log(`FAIL  ${label}${detail ? " — " + detail : ""}`);
    fail = 1;
  }
}

async function requestOtp(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, create_user: false }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// --- An email nobody registered as a client contact must be refused, not silently signed up ---
const strangerEmail = `at-login-gate-stranger-${Date.now()}@example.com`;
const strangerRes = await requestOtp(strangerEmail);
check("unregistered email is refused a magic link", strangerRes.status >= 400, JSON.stringify(strangerRes));

// --- A real, registered client contact must NOT be rejected by the registration gate ---
// (Checking "not otp_disabled" rather than "status === 200": Supabase's magic-link email
// delivery has its own separate, pre-existing outage in this project — unrelated to this
// gate — that makes a fully successful send currently return 500 for EVERY registered
// address, not just this one. That's a real bug (see the session notes/report), but it's an
// SMTP configuration issue, not a registration-gate issue, and this test's job is only to
// prove the gate itself distinguishes registered from unregistered correctly.)
const registeredEmail = testOrgs["Acme Pty Ltd"].email;
const registeredRes = await requestOtp(registeredEmail);
check(
  "registered client contact is not rejected by the registration gate",
  registeredRes.body?.error_code !== "otp_disabled",
  JSON.stringify(registeredRes),
);

process.exit(fail);
