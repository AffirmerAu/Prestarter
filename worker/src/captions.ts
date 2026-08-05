import type { Env } from "./env";
import { pgSelect, pgInsert, pgPatch, pgDelete } from "./supabase";

export interface CaptionLanguage {
  language_tag: string;
  label_native: string;
  is_default: boolean;
}

// Spec section 6 step 6 / section 8: the token response carries "the available caption
// languages" — reviewed only. This runs on the service-role key (bypasses RLS), so it has
// to apply the same reviewed_at filter that 0006_hide_unreviewed_captions.sql enforces for
// RLS-scoped reads, or an unreviewed (possibly mistranslated) caption could reach a client
// through this path instead.
export async function getReviewedCaptionLanguages(env: Env, videoId: string): Promise<CaptionLanguage[]> {
  return pgSelect<CaptionLanguage>(
    env,
    `video_languages?video_id=eq.${videoId}&kind=eq.caption&reviewed_at=not.is.null` +
      `&select=language_tag,label_native,is_default&order=is_default.desc,label_native.asc`,
  );
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function uploadCaptionToStream(env: Env, streamUid: string, languageTag: string, vtt: Blob): Promise<void> {
  const form = new FormData();
  form.set("file", vtt, `${languageTag}.vtt`);
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream/${streamUid}/captions/${languageTag}`,
    { method: "PUT", headers: { Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}` }, body: form },
  );
  if (!res.ok) throw new Error(`Stream caption upload failed: ${res.status} ${await res.text()}`);
}

// Upload a prepared WebVTT file for one language (spec section 8). Always lands with
// reviewed_at = null — a mistranslated safety instruction is a liability, not a typo, so
// nothing here marks itself reviewed. Human review is a separate, explicit action.
export async function handleCaptionUpload(request: Request, env: Env, videoId: string): Promise<Response> {
  const form = await request.formData();
  const file = form.get("file");
  const languageTag = form.get("language_tag");
  const labelNative = form.get("label_native");
  const isDefault = form.get("is_default") === "true";

  if (typeof file === "string" || file === null || typeof languageTag !== "string" || typeof labelNative !== "string") {
    return json({ message: "file, language_tag and label_native are required" }, 400);
  }

  const videos = await pgSelect<{ id: string; stream_uid: string }>(env, `videos?id=eq.${videoId}&select=id,stream_uid`);
  const video = videos[0];
  if (!video) return json({ message: "Video not found" }, 404);

  await uploadCaptionToStream(env, video.stream_uid, languageTag, file);

  if (isDefault) {
    await pgPatch(env, `video_languages?video_id=eq.${videoId}&kind=eq.caption`, { is_default: false });
  }

  const existing = await pgSelect<{ id: string }>(
    env,
    `video_languages?video_id=eq.${videoId}&language_tag=eq.${encodeURIComponent(languageTag)}&kind=eq.caption&select=id`,
  );
  if (existing[0]) {
    await pgPatch(env, `video_languages?id=eq.${existing[0].id}`, {
      label_native: labelNative,
      is_default: isDefault,
      source: "uploaded",
      reviewed_at: null,
    });
    return json({ id: existing[0].id, reviewed: false });
  }

  const row = await pgInsert<{ id: string }>(env, "video_languages", {
    video_id: videoId,
    language_tag: languageTag,
    kind: "caption",
    label_native: labelNative,
    is_default: isDefault,
    source: "uploaded",
    reviewed_at: null,
  });
  return json({ id: row.id, reviewed: false });
}

interface StreamCaptionEntry {
  language: string;
  status: string;
}

async function listStreamCaptions(env: Env, streamUid: string): Promise<StreamCaptionEntry[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream/${streamUid}/captions`,
    { headers: { Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}` } },
  );
  if (!res.ok) throw new Error(`Stream captions list failed: ${res.status} ${await res.text()}`);
  const body = await res.json<{ result: StreamCaptionEntry[] }>();
  return body.result ?? [];
}

// Captions can land on Cloudflare Stream without ever going through our own upload endpoint
// — e.g. uploaded directly via Stream's own dashboard. Those have no video_languages row at
// all, so they're invisible to the client-facing menu (which reads from that table, not
// Stream directly — see getReviewedCaptionLanguages). This lists which of Stream's caption
// tracks for a video are "syncable": present on Stream, not yet registered with us.
export async function getUnsyncedStreamCaptions(
  env: Env,
  videoId: string,
  streamUid: string,
): Promise<{ language_tag: string; status: string }[]> {
  const [streamCaptions, existing] = await Promise.all([
    listStreamCaptions(env, streamUid),
    pgSelect<{ language_tag: string }>(env, `video_languages?video_id=eq.${videoId}&kind=eq.caption&select=language_tag`),
  ]);
  const known = new Set(existing.map((e) => e.language_tag));
  return streamCaptions
    .filter((c) => !known.has(c.language))
    .map((c) => ({ language_tag: c.language, status: c.status }));
}

interface RegisterStreamCaptionBody {
  language_tag?: unknown;
  label_native?: unknown;
  is_default?: unknown;
}

// Registers a caption that already exists on Stream — no re-upload of the VTT bytes, since
// Stream already has them. Still always lands reviewed_at = null (spec section 8): existing
// on Stream, uploaded outside our own review workflow entirely, is not the same as having
// been checked for accuracy by a human. The normal mark-reviewed action applies afterwards,
// same as any other caption.
export async function handleRegisterStreamCaption(
  env: Env,
  videoId: string,
  body: RegisterStreamCaptionBody,
): Promise<Response> {
  const languageTag = body.language_tag;
  const labelNative = body.label_native;
  const isDefault = body.is_default === true;
  if (typeof languageTag !== "string" || typeof labelNative !== "string") {
    return json({ message: "language_tag and label_native are required" }, 400);
  }

  const videos = await pgSelect<{ id: string; stream_uid: string }>(env, `videos?id=eq.${videoId}&select=id,stream_uid`);
  const video = videos[0];
  if (!video) return json({ message: "Video not found" }, 404);

  const streamCaptions = await listStreamCaptions(env, video.stream_uid);
  if (!streamCaptions.some((c) => c.language === languageTag)) {
    return json({ message: "No caption for this language exists on Cloudflare Stream" }, 404);
  }

  const existing = await pgSelect<{ id: string }>(
    env,
    `video_languages?video_id=eq.${videoId}&language_tag=eq.${encodeURIComponent(languageTag)}&kind=eq.caption&select=id`,
  );
  if (existing[0]) return json({ message: "Already registered" }, 409);

  if (isDefault) {
    await pgPatch(env, `video_languages?video_id=eq.${videoId}&kind=eq.caption`, { is_default: false });
  }

  const row = await pgInsert<{ id: string }>(env, "video_languages", {
    video_id: videoId,
    language_tag: languageTag,
    kind: "caption",
    label_native: labelNative,
    is_default: isDefault,
    source: "stream_sync",
    reviewed_at: null,
  });
  return json({ id: row.id, reviewed: false });
}

async function findVideoLanguage(
  env: Env,
  videoLanguageId: string,
): Promise<{ video_id: string; language_tag: string; stream_uid: string } | null> {
  const rows = await pgSelect<{ video_id: string; language_tag: string }>(
    env,
    `video_languages?id=eq.${videoLanguageId}&select=video_id,language_tag`,
  );
  const row = rows[0];
  if (!row) return null;
  const videos = await pgSelect<{ stream_uid: string }>(env, `videos?id=eq.${row.video_id}&select=stream_uid`);
  const streamUid = videos[0]?.stream_uid;
  if (!streamUid) return null;
  return { ...row, stream_uid: streamUid };
}

// Removes a caption entirely — the video_languages row (whether reviewed or not) and the
// underlying file on Cloudflare Stream, since our upload/register flows are what put it
// there in the first place. Logged to audit_log like every other admin mutation, so there's
// a record of who removed a reviewed caption and when.
export async function handleDeleteCaption(env: Env, videoLanguageId: string, actorEmail: string): Promise<Response> {
  const target = await findVideoLanguage(env, videoLanguageId);
  if (!target) return json({ message: "Not found" }, 404);

  const deleteRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream/${target.stream_uid}/captions/${target.language_tag}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}` } },
  );
  // A caption already missing on Stream (404) shouldn't block removing our own row for it —
  // any other failure should, so a transient Stream error doesn't leave an orphaned file
  // while our own record silently disappears.
  if (!deleteRes.ok && deleteRes.status !== 404) {
    return json({ message: `Could not remove caption from Cloudflare Stream (${deleteRes.status})` }, 502);
  }

  await pgDelete(env, `video_languages?id=eq.${videoLanguageId}`);
  await pgInsert(env, "audit_log", {
    actor: actorEmail,
    action: "remove_caption",
    subject_type: "video_languages",
    subject_id: videoLanguageId,
    detail: { language_tag: target.language_tag, video_id: target.video_id },
  });
  return json({ ok: true });
}

// Downloads the raw WebVTT file for a caption straight from Cloudflare Stream — proxied
// through the Worker (rather than the browser hitting Stream's API directly) so it goes
// through the same admin auth as everything else and never needs CF_STREAM_API_TOKEN
// client-side.
export async function handleDownloadCaptionVtt(env: Env, videoLanguageId: string): Promise<Response> {
  const target = await findVideoLanguage(env, videoLanguageId);
  if (!target) return json({ message: "Not found" }, 404);

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream/${target.stream_uid}/captions/${target.language_tag}/vtt`,
    { headers: { Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}` } },
  );
  if (!res.ok) return json({ message: `Could not fetch caption from Cloudflare Stream (${res.status})` }, 502);

  const vtt = await res.text();
  return new Response(vtt, {
    headers: {
      "content-type": "text/vtt; charset=utf-8",
      "content-disposition": `attachment; filename="${target.language_tag}.vtt"`,
    },
  });
}

export async function handleMarkCaptionReviewed(
  env: Env,
  videoLanguageId: string,
  reviewerEmail: string,
): Promise<Response> {
  const now = new Date().toISOString();
  await pgPatch(env, `video_languages?id=eq.${videoLanguageId}`, { reviewed_at: now });
  await pgInsert(env, "audit_log", {
    actor: reviewerEmail,
    action: "review_caption",
    subject_type: "video_languages",
    subject_id: videoLanguageId,
    detail: { reviewed_at: now },
  });
  return json({ reviewed_at: now });
}
