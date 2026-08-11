import type { Env } from "./env";
import { pgSelect, pgInsert, pgPatch } from "./supabase";

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
