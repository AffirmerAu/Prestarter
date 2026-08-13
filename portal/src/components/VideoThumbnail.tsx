import { useState } from "react";

// Same deterministic public URL pattern as admin/src/components/VideoThumbnail.tsx — no
// videos.thumbnail_url column, no dedicated API call, just the video id against the
// video-thumbnails Supabase Storage bucket (worker/src/thumbnails.ts).
export function thumbnailUrl(videoId: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/video-thumbnails/${videoId}`;
}

export function VideoThumbnail({
  videoId,
  displayCode,
  className,
}: {
  videoId: string;
  displayCode: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-surface-muted text-xs text-subtle ${className ?? ""}`}>
        {displayCode}
      </div>
    );
  }

  return (
    <img
      src={thumbnailUrl(videoId)}
      alt=""
      onError={() => setFailed(true)}
      className={`bg-surface-muted object-cover ${className ?? ""}`}
    />
  );
}
