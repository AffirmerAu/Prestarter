// Admin console "edit a client contact's email" flow — user-reported requirement. Not a
// numbered spec section 18 acceptance test (new scope beyond the original spec), written
// before/alongside the implementation per this project's working agreement.
//
// Creates its own throwaway client + contact so it never touches the shared stage-1 fixtures
// other suites depend on.
//
// Usage: start `wrangler dev`, then node at-edit-contact-email.mjs
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

async function otpErrorCode(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, create_user: false }),
  });
  const body = await res.json().catch(() => null);
  return body?.error_code ?? null;
}

const adminToken = await signInAsAdmin();
const originalEmail = `at-edit-email-orig-${Date.now()}@example.com`;
const newEmail = `at-edit-email-new-${Date.now()}@example.com`;

const createRes = await fetch(`${WORKER_URL}/internal/clients`, {
  method: "POST",
  headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: `AT Edit Email Pty Ltd ${Date.now()}`,
    mark_as: "AT Edit Email",
    plan_tier: "standard",
    term_start: "2026-01-01",
    term_end: "2027-01-01",
    daily_cap_advisory: 25,
    contact_name: "Original Contact",
    contact_email: originalEmail,
  }),
});
const createBody = await createRes.json();
check("setup: client with a contact created", createRes.status === 200, JSON.stringify(createBody));
const clientId = createBody.id;

try {
  const contacts = (await rest(`client_contacts?client_id=eq.${clientId}&select=*`)).body ?? [];
  const contact = contacts[0];
  check("setup: contact row exists", !!contact, JSON.stringify(contacts));

  // --- Missing email rejected ---
  const badRes = await fetch(`${WORKER_URL}/internal/client-contacts/${contact.id}/update-email`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  check("missing email is rejected", badRes.status === 400, `status ${badRes.status}`);

  // --- Update succeeds ---
  const updateRes = await fetch(`${WORKER_URL}/internal/client-contacts/${contact.id}/update-email`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: newEmail }),
  });
  const updateBody = await updateRes.json();
  check("update-email succeeds", updateRes.status === 200 && updateBody.email === newEmail, JSON.stringify(updateBody));

  const updatedRow = (await rest(`client_contacts?id=eq.${contact.id}&select=email`)).body?.[0];
  check("client_contacts.email is updated", updatedRow?.email === newEmail, JSON.stringify(updatedRow));

  const authUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${contact.user_id}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const authUser = await authUserRes.json();
  check("the underlying Supabase Auth user's email is updated too, not just the DB row", authUser.email === newEmail, JSON.stringify(authUser));

  // --- The old email can no longer sign in; the new one is now a recognised account ---
  // (checking the gate's error_code rather than a raw status — see at-client-login-gate.mjs
  // for why: a separate, pre-existing Supabase email-delivery outage makes even a
  // successful, gate-approved request currently return 500, not 200.)
  check("old email is now unrecognised (otp_disabled)", (await otpErrorCode(originalEmail)) === "otp_disabled");
  check("new email is recognised, not rejected by the registration gate", (await otpErrorCode(newEmail)) !== "otp_disabled");

  const auditRows = (
    await rest(`audit_log?subject_type=eq.clients&subject_id=eq.${clientId}&action=eq.update_contact_email&select=*`)
  ).body ?? [];
  check("audit_log records the email change", auditRows.length === 1, JSON.stringify(auditRows));

  // --- Setting it to an email already in use by another contact is rejected ---
  const secondContactEmail = `at-edit-email-second-${Date.now()}@example.com`;
  await rest("client_contacts", {
    method: "POST",
    body: JSON.stringify({ client_id: clientId, email: secondContactEmail, name: "Second Contact" }),
  });
  const conflictRes = await fetch(`${WORKER_URL}/internal/client-contacts/${contact.id}/update-email`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: secondContactEmail }),
  });
  check("setting email to one already in use by another contact is rejected", conflictRes.status === 409, `status ${conflictRes.status}`);
} finally {
  await rest(`clients?id=eq.${clientId}`, { method: "DELETE" }); // cascades client_contacts
}

process.exit(fail);
