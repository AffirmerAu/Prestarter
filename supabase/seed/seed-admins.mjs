// Seeds the admins table: the single real admin account (password-only login, no magic
// link — see worker/src/admin-auth.ts's amr check) and a separate password-based test admin
// used only by the acceptance test scripts.
//
// The real admin's password is deliberately NOT hardcoded here — set REAL_ADMIN_PASSWORD in
// the environment before running this on a fresh Supabase project. Without it, this script
// leaves that account's password untouched (or, on a brand-new project with no such user
// yet, skips creating it and just prints a reminder).
// Usage: REAL_ADMIN_PASSWORD=... node seed-admins.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const devVars = Object.fromEntries(
  fs
    .readFileSync(path.join(here, "..", "..", "worker", ".dev.vars"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim()];
    }),
);

const SUPABASE_URL = devVars.SUPABASE_URL;
const SERVICE_KEY = devVars.SUPABASE_SERVICE_ROLE_KEY;

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
  }).then(async (r) => {
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${p} -> ${r.status} ${JSON.stringify(body)}`);
    return body;
  });

const authAdmin = (p, opts = {}) =>
  fetch(`${SUPABASE_URL}/auth/v1/admin/${p}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...opts.headers,
    },
  }).then(async (r) => {
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`auth/${p} -> ${r.status} ${JSON.stringify(body)}`);
    return body;
  });

async function upsertUser(email, password) {
  const body = password ? { email, password, email_confirm: true } : { email, email_confirm: true };
  try {
    const user = await authAdmin("users", { method: "POST", body: JSON.stringify(body) });
    return user.id ?? user.user?.id;
  } catch (e) {
    const list = await authAdmin(`users?email=${encodeURIComponent(email)}`);
    const found = (list.users ?? []).find((u) => u.email === email);
    if (!found) throw e;
    return found.id;
  }
}

async function upsertAdmin(userId, email, name) {
  const existing = await rest(`admins?email=eq.${encodeURIComponent(email)}&select=id`);
  if (existing.length) return existing[0].id;
  const [row] = await rest("admins", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, email, name }),
  });
  return row.id;
}

const realAdmin = { email: "admin@affirmer.com.au", name: "Affirmer Admin" };
let realAdminUserId = null;
if (process.env.REAL_ADMIN_PASSWORD) {
  realAdminUserId = await upsertUser(realAdmin.email, process.env.REAL_ADMIN_PASSWORD);
  await upsertAdmin(realAdminUserId, realAdmin.email, realAdmin.name);
} else {
  console.log(`REAL_ADMIN_PASSWORD not set — skipping ${realAdmin.email}. Re-run with it set to (re)provision that account.`);
}

const testAdmin = { email: "admin-test@example.com", password: "Test-Passw0rd-Admin!", name: "Test Admin" };
const testAdminUserId = await upsertUser(testAdmin.email, testAdmin.password);
await upsertAdmin(testAdminUserId, testAdmin.email, testAdmin.name);

console.log(JSON.stringify({ realAdmin: realAdminUserId ? { userId: realAdminUserId, email: realAdmin.email } : null, testAdmin }, null, 2));
