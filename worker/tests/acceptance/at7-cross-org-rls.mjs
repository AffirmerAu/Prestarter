// AT7 (spec section 18): a client signed in to organisation A cannot read any data
// belonging to organisation B, tested at the API level, not only through the interface.
//
// Uses the two seeded test orgs (supabase/seed/test-orgs.json — run seed-test-clients.mjs
// first) and signs in as each via Supabase Auth's password grant to get a real user JWT,
// then queries PostgREST directly — this is the "API level", independent of any portal UI.
//
// Usage: node at7-cross-org-rls.mjs
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
const orgs = JSON.parse(
  fs.readFileSync(path.join(here, "..", "..", "..", "supabase", "seed", "test-orgs.json"), "utf8"),
);

const SUPABASE_URL = devVars.SUPABASE_URL;
const ANON_KEY = devVars.SUPABASE_ANON_KEY;

let fail = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`PASS  ${label}`);
  } else {
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

async function pgrst(token, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const a = orgs["Acme Pty Ltd"];
const b = orgs["Beta Pty Ltd"];

const tokenA = await signIn(a.email, a.password);
const tokenB = await signIn(b.email, b.password);

// 1) The safe status view returns only your own org, never the other.
const statusAsA = await pgrst(tokenA, "client_safe_status?select=id,name");
check(
  "org A sees only its own row via client_safe_status",
  statusAsA.body.length === 1 && statusAsA.body[0].id === a.clientId,
  JSON.stringify(statusAsA.body),
);

// 2) Explicitly querying for the OTHER org's client_id returns nothing (RLS row filter,
//    not just "the UI didn't show a link to it").
const bTryingA = await pgrst(tokenB, `client_safe_status?id=eq.${a.clientId}`);
check("org B querying org A's client_id by id gets zero rows", bTryingA.body.length === 0, JSON.stringify(bTryingA.body));

// 3) Direct access to the base `clients` table is revoked entirely (not just row-filtered) —
//    daily_cap_advisory must never be reachable, even via the id filtered to your own row.
const baseTableAsA = await pgrst(tokenA, `clients?id=eq.${a.clientId}`);
check(
  "base clients table is unreachable directly (grant revoked)",
  baseTableAsA.status === 401 || baseTableAsA.status === 403 || (Array.isArray(baseTableAsA.body) && baseTableAsA.body.length === 0),
  `status=${baseTableAsA.status} body=${JSON.stringify(baseTableAsA.body)}`,
);

// 4) access_keys: org B cannot read org A's key by explicitly filtering for it.
const bTryingAKey = await pgrst(tokenB, `access_keys?client_id=eq.${a.clientId}`);
check("org B cannot read org A's access_keys", bTryingAKey.body.length === 0, JSON.stringify(bTryingAKey.body));

// 5) entitlements: org A cannot read org B's entitlements by explicitly filtering for it.
const aTryingBEnt = await pgrst(tokenA, `entitlements?client_id=eq.${b.clientId}`);
check("org A cannot read org B's entitlements", aTryingBEnt.body.length === 0, JSON.stringify(aTryingBEnt.body));

// 6) client_contacts: org A cannot read org B's contacts.
const aTryingBContacts = await pgrst(tokenA, `client_contacts?client_id=eq.${b.clientId}`);
check("org A cannot read org B's client_contacts", aTryingBContacts.body.length === 0, JSON.stringify(aTryingBContacts.body));

// 7) play_events / usage_daily: no client should ever read these, own org or not.
const aTryingOwnPlayEvents = await pgrst(tokenA, `play_events?client_id=eq.${a.clientId}`);
check(
  "org A cannot read play_events even for its own client_id (admin-only table)",
  aTryingOwnPlayEvents.status === 401 || aTryingOwnPlayEvents.status === 403 || (Array.isArray(aTryingOwnPlayEvents.body) && aTryingOwnPlayEvents.body.length === 0),
  `status=${aTryingOwnPlayEvents.status} body=${JSON.stringify(aTryingOwnPlayEvents.body)}`,
);

// 8) AT9 groundwork: daily_cap_advisory is not reachable even via select=* on the safe view.
const fullStatusAsA = await pgrst(tokenA, "client_safe_status?select=*");
check(
  "daily_cap_advisory is absent from client_safe_status even with select=*",
  fullStatusAsA.body.length === 1 && !("daily_cap_advisory" in fullStatusAsA.body[0]),
  JSON.stringify(fullStatusAsA.body),
);

process.exit(fail);
