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

  if (!videos) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-gray-900">Video library</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {videos.map((v) => (
          <Link
            key={v.id}
            to={`/videos/${v.id}`}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-400"
          >
            <div className="mb-2 flex aspect-video items-center justify-center rounded bg-gray-100 text-xs text-gray-400">
              {v.display_code}
            </div>
            <div className="text-sm font-medium text-gray-900">{v.title}</div>
            <div className="text-xs text-gray-500">
              {v.category} · {formatDuration(v.duration_seconds)} · {v.status}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
