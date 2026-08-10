// Admin console "create client" flow + onboarding email (Resend). Not a numbered spec
// section 18 acceptance test (this is new scope beyond the original spec), but written
// before/alongside the implementation per this project's working agreement.
//
// Usage: start `wrangler dev`, then node at-create-client.mjs
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
// Resend rejects example.com-style addresses outright (422, "please use our testing email
// address") — delivered@resend.dev is their real documented sandbox address for exactly
// this. Fixed, not per-run-unique, so the finally block below must actually run to avoid a
// client_contacts.email uniqueness collision on the next run.
const testEmail = "delivered@resend.dev";

// --- Missing required fields is rejected, not a crash ---
const badRes = await fetch(`${WORKER_URL}/internal/clients`, {
  method: "POST",
  headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Missing Fields Pty Ltd" }),
});
check("missing required fields is rejected", badRes.status === 400, `status ${badRes.status}`);

// --- Full creation, with a first contact ---
const createRes = await fetch(`${WORKER_URL}/internal/clients`, {
  method: "POST",
  headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "AT Create Client Pty Ltd",
    mark_as: "AT Create Client Pty Ltd",
    plan_tier: "standard",
    term_start: "2026-01-01",
    term_end: "2027-01-01",
    daily_cap_advisory: 25,
    contact_name: "Test Contact",
    contact_email: testEmail,
  }),
});
const createBody = await createRes.json();
check("create client succeeds", createRes.status === 200, JSON.stringify(createBody));
check("response includes a generated access key", /^[0-9a-f]{48}$/.test(createBody.access_key ?? ""), createBody.access_key);
check("onboarding email was attempted and reported success", createBody.onboarding_email_sent === true, JSON.stringify(createBody));

const clientId = createBody.id;

try {
  const clientRow = (await rest(`clients?id=eq.${clientId}&select=*`)).body?.[0];
  check("client row has the right billing state", clientRow?.billing_state === "paid", JSON.stringify(clientRow));
  check("client row's paid_to matches term_end (whole first term prepaid)", clientRow?.paid_to === "2027-01-01", JSON.stringify(clientRow));

  const keyRow = (await rest(`access_keys?client_id=eq.${clientId}&select=key,revoked_at`)).body?.[0];
  check("an access key row exists and is not revoked", !!keyRow && keyRow.revoked_at === null, JSON.stringify(keyRow));
  check("returned access key matches the DB row", keyRow?.key === createBody.access_key, JSON.stringify(keyRow));

  const contactRow = (await rest(`client_contacts?client_id=eq.${clientId}&select=email,name,user_id`)).body?.[0];
  check("client_contacts row exists with the right email", contactRow?.email === testEmail, JSON.stringify(contactRow));
  check("client_contacts row is linked to a Supabase Auth user", !!contactRow?.user_id, JSON.stringify(contactRow));

  const auditRow = (
    await rest(
      `audit_log?subject_type=eq.clients&subject_id=eq.${clientId}&action=eq.create_client&select=actor&order=occurred_at.desc&limit=1`,
    )
  ).body?.[0];
  check("audit_log records who created it", auditRow?.actor === adminTest.testAdmin.email, JSON.stringify(auditRow));

  // --- Creating a client with NO contact still works, and skips the email cleanly ---
  const noContactRes = await fetch(`${WORKER_URL}/internal/clients`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "AT No Contact Pty Ltd",
      mark_as: "AT No Contact Pty Ltd",
      plan_tier: "standard",
      term_start: "2026-01-01",
      term_end: "2027-01-01",
      daily_cap_advisory: 25,
    }),
  });
  const noContactBody = await noContactRes.json();
  check("create client without a contact still succeeds", noContactRes.status === 200, JSON.stringify(noContactBody));
  check("no onboarding email is reported when there's no contact", noContactBody.onboarding_email_sent === null, JSON.stringify(noContactBody));

  await rest(`clients?id=eq.${noContactBody.id}`, { method: "DELETE" });
} finally {
  await rest(`clients?id=eq.${clientId}`, { method: "DELETE" }); // cascades to access_keys, client_contacts
}

process.exit(fail);
