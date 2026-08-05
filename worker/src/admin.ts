import type { Env } from "./env";
import { pgSelect, pgInsert, pgPatch } from "./supabase";
import { requireAdmin } from "./admin-auth";
import { handleAdminReads } from "./admin-reads";
import { handleCaptionUpload, handleMarkCaptionReviewed } from "./captions";

function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO + "T00:00:00Z").getTime();
  const to = new Date(toISO + "T00:00:00Z").getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function handleInternalAdmin(request: Request, url: URL, env: Env): Promise<Response> {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;

  if (request.method === "GET") return handleAdminReads(request, url, env);
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const markPaid = url.pathname.match(/^\/internal\/clients\/([^/]+)\/mark-paid$/);
  if (markPaid?.[1]) return markClientPaid(env, markPaid[1], auth.email, await request.json());

  const pause = url.pathname.match(/^\/internal\/clients\/([^/]+)\/pause$/);
  if (pause?.[1]) return setClientPauseState(env, pause[1], true, auth.email);

  const restore = url.pathname.match(/^\/internal\/clients\/([^/]+)\/restore$/);
  if (restore?.[1]) return setClientPauseState(env, restore[1], false, auth.email);

  const rotate = url.pathname.match(/^\/internal\/access-keys\/([^/]+)\/rotate$/);
  if (rotate?.[1]) return rotateAccessKey(env, rotate[1], auth.email);

  const ack = url.pathname.match(/^\/internal\/alerts\/([^/]+)\/acknowledge$/);
  if (ack?.[1]) return acknowledgeAlert(env, ack[1], auth.email);

  const captionUpload = url.pathname.match(/^\/internal\/videos\/([^/]+)\/captions$/);
  if (captionUpload?.[1]) return handleCaptionUpload(request, env, captionUpload[1]);

  const captionReview = url.pathname.match(/^\/internal\/video-languages\/([^/]+)\/mark-reviewed$/);
  if (captionReview?.[1]) return handleMarkCaptionReviewed(env, captionReview[1], auth.email);

  return new Response("Not found", { status: 404 });
}

interface MarkPaidBody {
  reference?: string;
  note?: string;
}

// actor is always the authenticated admin's own email, resolved server-side from their
// Supabase session (admin-auth.ts) — never taken from the request body, so the audit log
// can't be spoofed by whoever's holding the bearer token.
async function markClientPaid(env: Env, clientId: string, actor: string, body: MarkPaidBody): Promise<Response> {
  const clients = await pgSelect<{ id: string; term_start: string; term_end: string; paid_to: string }>(
    env,
    `clients?id=eq.${clientId}&select=id,term_start,term_end,paid_to`,
  );
  const client = clients[0];
  if (!client) return new Response(JSON.stringify({ message: "Client not found" }), { status: 404 });

  const termLengthDays = daysBetween(client.term_start, client.term_end);
  const newPaidTo = addDaysISO(client.paid_to, termLengthDays);

  await pgPatch(env, `clients?id=eq.${clientId}`, { billing_state: "paid", paid_to: newPaidTo });
  await pgInsert(env, "billing_events", {
    client_id: clientId,
    action: "marked_paid",
    period_start: client.paid_to,
    period_end: newPaidTo,
    reference: body.reference ?? null,
    actor,
    note: body.note ?? null,
  });
  await pgInsert(env, "audit_log", {
    actor,
    action: "mark_paid",
    subject_type: "clients",
    subject_id: clientId,
    detail: { period_start: client.paid_to, period_end: newPaidTo },
  });

  return new Response(JSON.stringify({ paid_to: newPaidTo, billing_state: "paid" }), {
    headers: { "content-type": "application/json" },
  });
}

async function setClientPauseState(env: Env, clientId: string, paused: boolean, actor: string): Promise<Response> {
  await pgPatch(env, `clients?id=eq.${clientId}`, { status: paused ? "paused" : "active" });
  await pgInsert(env, "billing_events", {
    client_id: clientId,
    action: paused ? "paused" : "restored",
    actor,
  });
  await pgInsert(env, "audit_log", {
    actor,
    action: paused ? "pause_client" : "restore_client",
    subject_type: "clients",
    subject_id: clientId,
    detail: {},
  });
  return new Response(JSON.stringify({ status: paused ? "paused" : "active" }), {
    headers: { "content-type": "application/json" },
  });
}

function generateAccessKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function rotateAccessKey(env: Env, accessKeyId: string, actor: string): Promise<Response> {
  const keys = await pgSelect<{ id: string; client_id: string }>(
    env,
    `access_keys?id=eq.${accessKeyId}&select=id,client_id`,
  );
  const existing = keys[0];
  if (!existing) return new Response(JSON.stringify({ message: "Access key not found" }), { status: 404 });

  await pgPatch(env, `access_keys?id=eq.${accessKeyId}`, { revoked_at: new Date().toISOString() });
  const newKey = generateAccessKey();
  await pgInsert(env, "access_keys", { client_id: existing.client_id, key: newKey });
  await pgInsert(env, "audit_log", {
    actor,
    action: "rotate_key",
    subject_type: "clients",
    subject_id: existing.client_id,
    detail: { revoked_access_key_id: accessKeyId },
  });

  return new Response(JSON.stringify({ key: newKey }), { headers: { "content-type": "application/json" } });
}

async function acknowledgeAlert(env: Env, alertId: string, actor: string): Promise<Response> {
  await pgPatch(env, `alerts?id=eq.${alertId}`, { acknowledged_at: new Date().toISOString(), acknowledged_by: actor });
  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
}
