import type { Env } from "./env";
import { pgSelect, pgInsert, pgPatch } from "./supabase";
import { requireAdmin } from "./admin-auth";
import { handleAdminReads } from "./admin-reads";
import { handleCreateClient, updateContactEmail } from "./clients-admin";
import { handleRegisterVideo, archiveVideo, restoreVideo, deleteVideo } from "./videos-admin";
import { handleUploadThumbnail } from "./thumbnails";
import {
  handleCaptionUpload,
  handleMarkCaptionReviewed,
  handleRegisterStreamCaption,
  handleDeleteCaption,
} from "./captions";

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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function handleInternalAdmin(request: Request, url: URL, env: Env): Promise<Response> {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;

  if (request.method === "GET") return handleAdminReads(request, url, env);
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (url.pathname === "/internal/clients") return handleCreateClient(env, auth.email, await request.json());

  if (url.pathname === "/internal/videos") return handleRegisterVideo(env, auth.email, await request.json());

  const archiveVid = url.pathname.match(/^\/internal\/videos\/([^/]+)\/archive$/);
  if (archiveVid?.[1]) return archiveVideo(env, auth.email, archiveVid[1]);

  const restoreVid = url.pathname.match(/^\/internal\/videos\/([^/]+)\/restore$/);
  if (restoreVid?.[1]) return restoreVideo(env, auth.email, restoreVid[1]);

  const deleteVid = url.pathname.match(/^\/internal\/videos\/([^/]+)\/delete$/);
  if (deleteVid?.[1]) return deleteVideo(env, auth.email, deleteVid[1]);

  const uploadThumbnail = url.pathname.match(/^\/internal\/videos\/([^/]+)\/thumbnail$/);
  if (uploadThumbnail?.[1]) return handleUploadThumbnail(request, env, uploadThumbnail[1]);

  const markPaid = url.pathname.match(/^\/internal\/clients\/([^/]+)\/mark-paid$/);
  if (markPaid?.[1]) return markClientPaid(env, markPaid[1], auth.email, await request.json());

  const pause = url.pathname.match(/^\/internal\/clients\/([^/]+)\/pause$/);
  if (pause?.[1]) return setClientPauseState(env, pause[1], true, auth.email);

  const restore = url.pathname.match(/^\/internal\/clients\/([^/]+)\/restore$/);
  if (restore?.[1]) return setClientPauseState(env, restore[1], false, auth.email);

  const rotate = url.pathname.match(/^\/internal\/access-keys\/([^/]+)\/rotate$/);
  if (rotate?.[1]) return rotateAccessKey(env, rotate[1], auth.email);

  const updateEmail = url.pathname.match(/^\/internal\/client-contacts\/([^/]+)\/update-email$/);
  if (updateEmail?.[1]) return updateContactEmail(env, auth.email, updateEmail[1], await request.json());

  const addEnt = url.pathname.match(/^\/internal\/clients\/([^/]+)\/entitlements$/);
  if (addEnt?.[1]) return addEntitlement(env, addEnt[1], auth.email, await request.json());

  const revokeEnt = url.pathname.match(/^\/internal\/entitlements\/([^/]+)\/revoke$/);
  if (revokeEnt?.[1]) return revokeEntitlement(env, revokeEnt[1], auth.email);

  const ack = url.pathname.match(/^\/internal\/alerts\/([^/]+)\/acknowledge$/);
  if (ack?.[1]) return acknowledgeAlert(env, ack[1], auth.email);

  const captionUpload = url.pathname.match(/^\/internal\/videos\/([^/]+)\/captions$/);
  if (captionUpload?.[1]) return handleCaptionUpload(request, env, captionUpload[1]);

  const captionReview = url.pathname.match(/^\/internal\/video-languages\/([^/]+)\/mark-reviewed$/);
  if (captionReview?.[1]) return handleMarkCaptionReviewed(env, captionReview[1], auth.email);

  const captionStreamSync = url.pathname.match(/^\/internal\/videos\/([^/]+)\/captions\/register-from-stream$/);
  if (captionStreamSync?.[1]) return handleRegisterStreamCaption(env, captionStreamSync[1], await request.json());

  const captionDelete = url.pathname.match(/^\/internal\/video-languages\/([^/]+)\/delete$/);
  if (captionDelete?.[1]) return handleDeleteCaption(env, captionDelete[1], auth.email);

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

interface AddEntitlementBody {
  video_id?: unknown;
  effective_from?: unknown;
  effective_to?: unknown;
}

// Grants a client access to a video (spec section 5). entitlements has a unique(client_id,
// video_id) constraint, so re-adding a video the client was previously entitled to (and
// later revoked from) hits the same row rather than a fresh one — reactivating it by
// updating the effective window is simpler than modelling a full history of separate
// entitlement windows per video, which nothing else in the spec calls for.
async function addEntitlement(env: Env, clientId: string, actor: string, body: AddEntitlementBody): Promise<Response> {
  const videoId = body.video_id;
  if (typeof videoId !== "string" || !videoId.trim()) {
    return new Response(JSON.stringify({ message: "video_id is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const effectiveFrom = typeof body.effective_from === "string" && body.effective_from ? body.effective_from : todayISO();
  const effectiveTo = typeof body.effective_to === "string" && body.effective_to ? body.effective_to : null;

  const videos = await pgSelect<{ id: string; status: string }>(env, `videos?id=eq.${videoId}&select=id,status`);
  if (!videos[0]) {
    return new Response(JSON.stringify({ message: "Video not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  if (videos[0].status === "archived") {
    return new Response(JSON.stringify({ message: "This video has been removed from the library and can't be added to a client" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const existing = await pgSelect<{ id: string }>(
    env,
    `entitlements?client_id=eq.${clientId}&video_id=eq.${videoId}&select=id`,
  );
  let entitlementId: string;
  if (existing[0]) {
    await pgPatch(env, `entitlements?id=eq.${existing[0].id}`, { effective_from: effectiveFrom, effective_to: effectiveTo });
    entitlementId = existing[0].id;
  } else {
    const row = await pgInsert<{ id: string }>(env, "entitlements", {
      client_id: clientId,
      video_id: videoId,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
    });
    entitlementId = row.id;
  }

  await pgInsert(env, "audit_log", {
    actor,
    action: "add_entitlement",
    subject_type: "clients",
    subject_id: clientId,
    detail: { video_id: videoId, effective_from: effectiveFrom, effective_to: effectiveTo },
  });

  return new Response(JSON.stringify({ id: entitlementId }), { headers: { "content-type": "application/json" } });
}

// Removing a video from a client sets effective_to rather than deleting the row — preserves
// the record of what the client WAS entitled to and for how long, which the
// effective_from/effective_to columns exist for in the first place. Re-adding the same video
// later reactivates this same row (see addEntitlement).
//
// effective_to = YESTERDAY, not today: entitlement.ts's checkEntitlement() treats
// effective_to as inclusive (`e.effective_to >= today` still grants access), the same
// convention term_end/paid_to use elsewhere in this system. Setting it to today would leave
// access — and the admin UI's own "is this active" check — unchanged until the following
// day, which isn't what "remove" means. (Caught this the hard way: the admin console showed
// no visible change after clicking Remove, because there genuinely wasn't one yet.)
async function revokeEntitlement(env: Env, entitlementId: string, actor: string): Promise<Response> {
  const rows = await pgSelect<{ id: string; client_id: string; video_id: string }>(
    env,
    `entitlements?id=eq.${entitlementId}&select=id,client_id,video_id`,
  );
  const entitlement = rows[0];
  if (!entitlement) {
    return new Response(JSON.stringify({ message: "Entitlement not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const effectiveTo = addDaysISO(todayISO(), -1);
  await pgPatch(env, `entitlements?id=eq.${entitlementId}`, { effective_to: effectiveTo });
  await pgInsert(env, "audit_log", {
    actor,
    action: "revoke_entitlement",
    subject_type: "clients",
    subject_id: entitlement.client_id,
    detail: { video_id: entitlement.video_id, effective_to: effectiveTo },
  });

  return new Response(JSON.stringify({ effective_to: effectiveTo }), { headers: { "content-type": "application/json" } });
}

async function acknowledgeAlert(env: Env, alertId: string, actor: string): Promise<Response> {
  await pgPatch(env, `alerts?id=eq.${alertId}`, { acknowledged_at: new Date().toISOString(), acknowledged_by: actor });
  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
}
