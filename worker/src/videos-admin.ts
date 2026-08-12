import type { Env } from "./env";
import { pgSelect, pgInsert, pgPatch, pgDelete } from "./supabase";
import { deleteThumbnail } from "./thumbnails";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

interface StreamVideo {
  uid: string;
  meta?: { name?: string };
  duration: number; // seconds, or -1 while still processing
  readyToStream: boolean;
  requireSignedURLs: boolean;
  created: string;
}

async function listStreamVideos(env: Env): Promise<StreamVideo[]> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream`, {
    headers: { Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Stream video list failed: ${res.status} ${await res.text()}`);
  const body = await res.json<{ result: StreamVideo[] }>();
  return body.result ?? [];
}

async function getStreamVideo(env: Env, uid: string): Promise<StreamVideo | null> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream/${uid}`, {
    headers: { Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Stream video lookup failed: ${res.status} ${await res.text()}`);
  const body = await res.json<{ result: StreamVideo }>();
  return body.result;
}

// Videos can land on Cloudflare Stream without ever going through this console — uploaded
// directly via Stream's own dashboard, same situation captions can end up in (see
// getUnsyncedStreamCaptions in captions.ts). Lists which Stream videos have no matching
// videos.stream_uid row yet, for the admin console's "register" panel.
export async function listUnregisteredStreamVideos(
  env: Env,
): Promise<{ uid: string; name: string; duration_seconds: number; ready: boolean; created: string }[]> {
  const [streamVideos, existing] = await Promise.all([
    listStreamVideos(env),
    pgSelect<{ stream_uid: string }>(env, "videos?select=stream_uid"),
  ]);
  const known = new Set(existing.map((v) => v.stream_uid));
  return streamVideos
    .filter((v) => !known.has(v.uid))
    .map((v) => ({
      uid: v.uid,
      name: v.meta?.name ?? v.uid,
      duration_seconds: v.duration >= 0 ? Math.round(v.duration) : 0,
      ready: v.readyToStream,
      created: v.created,
    }));
}

interface RegisterVideoBody {
  stream_uid?: unknown;
  title?: unknown;
  display_code?: unknown;
  category?: unknown;
}

// Registers a video that already exists on Stream — creates the videos row our whole
// entitlement/playback/caption system actually operates on. requireSignedURLs is a
// non-negotiable security invariant (CLAUDE.md / spec section 6: "clients never receive a
// Cloudflare Stream URL" depends on every video being signed-URL-only) — since this video was
// uploaded outside our own upload flow, that setting was never guaranteed, so it's checked
// here rather than assumed.
export async function handleRegisterVideo(env: Env, actorEmail: string, body: RegisterVideoBody): Promise<Response> {
  const streamUid = body.stream_uid;
  const title = body.title;
  const displayCode = body.display_code;
  const category = body.category;

  if (
    typeof streamUid !== "string" ||
    !streamUid.trim() ||
    typeof title !== "string" ||
    !title.trim() ||
    typeof displayCode !== "string" ||
    !displayCode.trim() ||
    typeof category !== "string" ||
    !category.trim()
  ) {
    return json({ message: "stream_uid, title, display_code and category are required" }, 400);
  }

  const streamVideo = await getStreamVideo(env, streamUid);
  if (!streamVideo) return json({ message: "No video with this ID exists on Cloudflare Stream" }, 404);
  if (!streamVideo.requireSignedURLs) {
    return json(
      {
        message:
          "This video does not have \"Require signed URLs\" enabled on Cloudflare Stream. Turn that on for the video first — registering it here without that would let anyone play it from a raw Stream URL, bypassing licensing entirely.",
      },
      400,
    );
  }

  const existing = await pgSelect<{ id: string }>(env, `videos?stream_uid=eq.${encodeURIComponent(streamUid)}&select=id`);
  if (existing[0]) return json({ message: "Already registered" }, 409);

  const row = await pgInsert<{ id: string }>(env, "videos", {
    display_code: displayCode,
    title,
    duration_seconds: streamVideo.duration >= 0 ? Math.round(streamVideo.duration) : 0,
    category,
    stream_uid: streamUid,
    status: "draft",
  });

  await pgInsert(env, "audit_log", {
    actor: actorEmail,
    action: "register_video",
    subject_type: "videos",
    subject_id: row.id,
    detail: { stream_uid: streamUid, title, display_code: displayCode },
  });

  return json({ id: row.id });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Removing a video from the library (user-reported need: "the ability to remove videos from
// the library") archives it rather than deleting the row — entitlements, play_events,
// usage_daily and audit_log all foreign-key to videos.id, and hard-deleting would silently
// destroy real usage/audit history along with it. Also revokes every currently-active
// entitlement for the video (same "yesterday" trick as revokeEntitlement in admin.ts) so
// existing clients lose access immediately rather than the archive being purely cosmetic —
// checkEntitlement() and addEntitlement() additionally refuse an archived video as
// belt-and-suspenders, matching this codebase's existing db-layer-not-just-UI convention.
export async function archiveVideo(env: Env, actor: string, videoId: string): Promise<Response> {
  const videos = await pgSelect<{ id: string; status: string }>(env, `videos?id=eq.${videoId}&select=id,status`);
  const video = videos[0];
  if (!video) return json({ message: "Video not found" }, 404);
  if (video.status === "archived") return json({ id: video.id, status: "archived" });

  const yesterday = addDaysISO(todayISO(), -1);
  const activeEntitlements = await pgSelect<{ id: string }>(
    env,
    `entitlements?video_id=eq.${videoId}&effective_to=is.null&select=id`,
  );
  await Promise.all(activeEntitlements.map((e) => pgPatch(env, `entitlements?id=eq.${e.id}`, { effective_to: yesterday })));
  // Entitlements with a still-future effective_to (rare — only via a manually-set date) need
  // the same cutoff; the is.null query above can't also express ">= today", so a second pass.
  const openEndedFuture = await pgSelect<{ id: string; effective_to: string | null }>(
    env,
    `entitlements?video_id=eq.${videoId}&effective_to=gte.${todayISO()}&select=id,effective_to`,
  );
  await Promise.all(openEndedFuture.map((e) => pgPatch(env, `entitlements?id=eq.${e.id}`, { effective_to: yesterday })));

  await pgPatch(env, `videos?id=eq.${videoId}`, { status: "archived" });
  await pgInsert(env, "audit_log", {
    actor,
    action: "archive_video",
    subject_type: "videos",
    subject_id: videoId,
    detail: { revoked_entitlements: activeEntitlements.length + openEndedFuture.length },
  });

  return json({ id: videoId, status: "archived" });
}

// Restoring always lands back on 'draft' (same status a freshly-registered video gets) —
// there's no history of what status a video held before archiving, and nothing in this app
// currently drives videos into 'released' anyway. Does NOT restore any revoked entitlements;
// an admin re-adds the video per client explicitly, same as reactivating any other
// entitlement (mirrors ClientDetail's add/remove flow rather than silently re-granting
// access to clients who may no longer be meant to have it).
export async function restoreVideo(env: Env, actor: string, videoId: string): Promise<Response> {
  const videos = await pgSelect<{ id: string; status: string }>(env, `videos?id=eq.${videoId}&select=id,status`);
  const video = videos[0];
  if (!video) return json({ message: "Video not found" }, 404);
  if (video.status !== "archived") return json({ id: video.id, status: video.status });

  await pgPatch(env, `videos?id=eq.${videoId}`, { status: "draft" });
  await pgInsert(env, "audit_log", {
    actor,
    action: "restore_video",
    subject_type: "videos",
    subject_id: videoId,
    detail: {},
  });

  return json({ id: videoId, status: "draft" });
}

// Fully deletes an archived video — irreversible, per user request ("the ability to fully
// delete courses after they are removed from the video library"). Only allowed once a video
// is already archived (archiveVideo already revoked every active entitlement for it, so
// nothing here needs to touch client access again).
//
// video_languages, entitlements, play_events and usage_daily all have `on delete cascade` to
// videos.id (0001_initial_schema.sql) — deleting the row wipes all of that with it, including
// real play/usage history, by explicit user decision (confirmed: "wipe everything" over
// "block if there's usage history"). alerts.video_id and videos.replaces_video_id have no
// cascade, so those are nulled out first rather than left to throw a foreign key error —
// alerts keep their own record, just detached from a video that no longer exists.
//
// Also attempts to delete the underlying Cloudflare Stream asset — best-effort, by explicit
// user decision. The CF_STREAM_API_TOKEN configured for this project can register/list/manage
// captions on Stream but returns 405 "Method not allowed for this authentication scheme" on
// video DELETE specifically (confirmed empirically against a real request, not specific to
// any one video) — a token permission gap, not something this code can fix. Rather than block
// "fully delete" entirely until that's resolved in the Cloudflare dashboard, our own records
// are deleted regardless of whether Stream cleanup succeeds; the outcome is recorded in
// audit_log so an admin can see which videos still have an orphaned (and still
// storage-billed) file on Stream and needs a manual follow-up.
export async function deleteVideo(env: Env, actor: string, videoId: string): Promise<Response> {
  const videos = await pgSelect<{ id: string; title: string; display_code: string; stream_uid: string; status: string }>(
    env,
    `videos?id=eq.${videoId}&select=id,title,display_code,stream_uid,status`,
  );
  const video = videos[0];
  if (!video) return json({ message: "Video not found" }, 404);
  if (video.status !== "archived") {
    return json({ message: "Remove this video from the library first — only an already-removed video can be fully deleted" }, 400);
  }

  const streamDeleteRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream/${video.stream_uid}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}` },
  }).catch(() => null);
  const streamDeleted = streamDeleteRes !== null && (streamDeleteRes.ok || streamDeleteRes.status === 404);

  await pgPatch(env, `alerts?video_id=eq.${videoId}`, { video_id: null });
  await pgPatch(env, `videos?replaces_video_id=eq.${videoId}`, { replaces_video_id: null });
  await deleteThumbnail(env, videoId);

  await pgDelete(env, `videos?id=eq.${videoId}`);

  await pgInsert(env, "audit_log", {
    actor,
    action: "delete_video",
    subject_type: "videos",
    subject_id: videoId,
    // The video row (and everything cascaded with it) is gone now — using the fields
    // captured before the delete, since nothing is left to look it up by afterward.
    // stream_deleted: false means the Stream asset is orphaned and needs manual cleanup.
    detail: { title: video.title, display_code: video.display_code, stream_uid: video.stream_uid, stream_deleted: streamDeleted },
  });

  return json({ id: videoId, deleted: true, stream_deleted: streamDeleted });
}
