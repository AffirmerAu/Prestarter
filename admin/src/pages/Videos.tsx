import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../lib/api";

interface VideoRow {
  id: string;
  display_code: string;
  title: string;
  duration_seconds: number;
  category: string;
  status: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function Videos() {
  const [videos, setVideos] = useState<VideoRow[] | null>(null);

  useEffect(() => {
    apiGet<VideoRow[]>("/internal/videos").then(setVideos);
  }, []);

  if (!videos) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div>
      <h1 className="mb-4 text-h1 font-bold text-ink">Video library</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {videos.map((v) => (
          <Link
            key={v.id}
            to={`/videos/${v.id}`}
            className="rounded-card border border-line bg-surface p-4 transition-colors hover:border-line-strong"
          >
            <div className="mb-2 flex aspect-video items-center justify-center rounded-[12px] bg-surface-muted text-xs text-subtle">
              {v.display_code}
            </div>
            <div className="text-sm font-medium text-ink">{v.title}</div>
            <div className="text-xs text-muted">
              {v.category} · {formatDuration(v.duration_seconds)} · {v.status}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
