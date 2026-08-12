import type { Env } from "./env";
import { pgSelect } from "./supabase";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = "video-thumbnails";

// Stored at a fixed object key per video (no filename/extension in the path) — re-uploading
// replaces the same object via x-upsert rather than accumulating orphaned files, and the
// public URL never changes so nothing on the admin/portal side needs to track a stored URL.
// No videos.thumbnail_url column exists (or needed) — the URL is fully deterministic from the
// video id, constructed client-side the same way (see admin/src/pages/Videos.tsx).
export async function handleUploadThumbnail(request: Request, env: Env, videoId: string): Promise<Response> {
  const videos = await pgSelect<{ id: string }>(env, `videos?id=eq.${videoId}&select=id`);
  if (!videos[0]) return json({ message: "Video not found" }, 404);

  const form = await request.formData();
  const raw = form.get("file");
  if (typeof raw === "string" || raw === null) {
    return json({ message: "file is required" }, 400);
  }
  // Workers' FormData typings resolve form.get() to string | null here (no ambient File type
  // in scope), so TS narrows the non-string/non-null branch to `never` — same reason
  // captions.ts's equivalent upload handler never touches file.* directly. This does exist at
  // runtime (FormDataEntryValue really is File | string per the Workers runtime itself).
  const file = raw as unknown as { type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };
  if (!ALLOWED_TYPES.has(file.type)) {
    return json({ message: "Thumbnail must be a JPEG, PNG or WebP image" }, 400);
  }
  if (file.size > MAX_BYTES) {
    return json({ message: "Thumbnail must be 5MB or smaller" }, 400);
  }

  const uploadRes = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${videoId}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": file.type,
      "x-upsert": "true",
    },
    body: await file.arrayBuffer(),
  });
  if (!uploadRes.ok) {
    return json({ message: "Thumbnail upload failed — try again" }, 502);
  }

  return json({ ok: true, url: `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${videoId}` });
}

// Best-effort — deleteVideo (videos-admin.ts) is already committed to deleting the video
// itself by the time this runs; a missing or already-gone thumbnail shouldn't block that.
export async function deleteThumbnail(env: Env, videoId: string): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${videoId}`, {
    method: "DELETE",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  }).catch(() => {});
}
