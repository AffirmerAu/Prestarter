// Seeds two test clients (orgs) with contacts, access keys, and an entitlement to the
// stage-one test video — used by the acceptance tests in worker/tests/acceptance/.
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / STAGE1_VIDEO_UID from worker/.dev.vars.
// Usage: node seed-test-clients.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const devVarsPath = path.join(here, "..", "..", "worker", ".dev.vars");
const devVars = Object.fromEntries(
  fs
    .readFileSync(devVarsPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim()];
    }),
);

const SUPABASE_URL = devVars.SUPABASE_URL;
const SERVICE_KEY = devVars.SUPABASE_SERVICE_ROLE_KEY;
const STREAM_UID = devVars.STAGE1_VIDEO_UID;

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

async function upsertVideo() {
  const existing = await rest(`videos?stream_uid=eq.${STREAM_UID}&select=id`);
  if (existing.length) return existing[0].id;
  const [video] = await rest("videos", {
    method: "POST",
    body: JSON.stringify({
      display_code: "TEST-001",
      title: "Stage one test video",
      duration_seconds: 30,
      category: "test",
      stream_uid: STREAM_UID,
      status: "released",
      released_at: new Date().toISOString(),
    }),
  });
  return video.id;
}

async function upsertClient(name, markAs) {
  const existing = await rest(`clients?name=eq.${encodeURIComponent(name)}&select=id`);
  if (existing.length) return existing[0].id;
  const today = new Date();
  const termEnd = new Date(today);
  termEnd.setFullYear(termEnd.getFullYear() + 1);
  const [client] = await rest("clients", {
    method: "POST",
    body: JSON.stringify({
      name,
      mark_as: markAs,
      status: "active",
      plan_tier: "standard",
      term_start: today.toISOString().slice(0, 10),
      term_end: termEnd.toISOString().slice(0, 10),
      billing_state: "paid",
      paid_to: termEnd.toISOString().slice(0, 10),
      daily_cap_advisory: 50,
    }),
  });
  return client.id;
}

async function upsertUser(email, password) {
  try {
    const user = await authAdmin("users", {
      method: "POST",
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    return user.id ?? user.user?.id;
  } catch (e) {
    // already exists — look it up
    const list = await authAdmin(`users?email=${encodeURIComponent(email)}`);
    const found = (list.users ?? []).find((u) => u.email === email);
    if (!found) throw e;
    return found.id;
  }
}

async function upsertContact(clientId, userId, email, name) {
  const existing = await rest(`client_contacts?email=eq.${encodeURIComponent(email)}&select=id`);
  if (existing.length) return existing[0].id;
  const [contact] = await rest("client_contacts", {
    method: "POST",
    body: JSON.stringify({ client_id: clientId, user_id: userId, email, name, role: "safety_manager" }),
  });
  return contact.id;
}

async function upsertAccessKey(clientId, key) {
  const existing = await rest(`access_keys?key=eq.${key}&select=id`);
  if (existing.length) return existing[0].id;
  const [row] = await rest("access_keys", {
    method: "POST",
    body: JSON.stringify({ client_id: clientId, key }),
  });
  return row.id;
}

async function upsertEntitlement(clientId, videoId) {
  const existing = await rest(
    `entitlements?client_id=eq.${clientId}&video_id=eq.${videoId}&select=id`,
  );
  if (existing.length) return existing[0].id;
  const [row] = await rest("entitlements", {
    method: "POST",
    body: JSON.stringify({ client_id: clientId, video_id: videoId }),
  });
  return row.id;
}

const videoId = await upsertVideo();

const orgs = [
  { name: "Acme Pty Ltd", markAs: "Acme Pty Ltd", email: "orga-test@example.com", password: "Test-Passw0rd-A!", key: "test-key-org-a" },
  { name: "Beta Pty Ltd", markAs: "Beta Pty Ltd", email: "orgb-test@example.com", password: "Test-Passw0rd-B!", key: "test-key-org-b" },
];

const results = {};
for (const org of orgs) {
  const clientId = await upsertClient(org.name, org.markAs);
  const userId = await upsertUser(org.email, org.password);
  await upsertContact(clientId, userId, org.email, "Test Contact");
  await upsertAccessKey(clientId, org.key);
  await upsertEntitlement(clientId, videoId);
  results[org.name] = { clientId, userId, email: org.email, password: org.password, key: org.key };
}

console.log(JSON.stringify({ videoId, ...results }, null, 2));
