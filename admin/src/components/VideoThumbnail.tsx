import { useState } from "react";

// Deterministic public URL, no DB column involved — see worker/src/thumbnails.ts. Bumping
// `version` (passed by the caller after a fresh upload) forces the <img> to re-fetch instead
// of showing a stale cached copy at the same URL.
export function thumbnailUrl(videoId: string, version?: number): string {
  const base = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/video-thumbnails/${videoId}`;
  return version ? `${base}?v=${version}` : base;
}

export function VideoThumbnail({
  videoId,
  displayCode,
  version,
  className,
}: {
  videoId: string;
  displayCode: string;
  version?: number;
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
      src={thumbnailUrl(videoId, version)}
      alt=""
      onError={() => setFailed(true)}
      className={`bg-surface-muted object-cover ${className ?? ""}`}
    />
  );
}
