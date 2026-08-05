import type { Env } from "./env";
import { pgSelect, pgInsert, pgPatch } from "./supabase";

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
