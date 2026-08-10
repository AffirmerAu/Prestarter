import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../lib/api";

interface VideoRow {
  id: string;
  display_code: string;
  title: string;
  duration_seconds: number;
  category: string;
  status: string;
}

interface UnregisteredStreamVideo {
  uid: string;
  name: string;
  duration_seconds: number;
  ready: boolean;
  created: string;
}

interface VideosResponse {
  videos: VideoRow[];
  unregisteredStreamVideos: UnregisteredStreamVideo[];
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface RegisterFields {
  title: string;
  display_code: string;
  category: string;
}

const inputClass =
  "rounded-input border border-line-strong px-2.5 py-1.5 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/24";

export function Videos() {
  const [data, setData] = useState<VideosResponse | null>(null);
  const [fields, setFields] = useState<Record<string, RegisterFields>>({});
  const [registering, setRegistering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const d = await apiGet<VideosResponse>("/internal/videos");
    setData(d);
  }

  useEffect(() => {
    load();
  }, []);

  function updateField(uid: string, key: keyof RegisterFields, value: string) {
    setFields((f) => {
      const current = f[uid] ?? { title: "", display_code: "", category: "" };
      return { ...f, [uid]: { ...current, [key]: value } };
    });
  }

  async function registerVideo(uid: string) {
    const f = fields[uid];
    if (!f?.title?.trim() || !f.display_code?.trim() || !f.category?.trim()) return;
    setRegistering(uid);
    setError(null);
    try {
      await apiPost("/internal/videos", {
        stream_uid: uid,
        title: f.title.trim(),
        display_code: f.display_code.trim(),
        category: f.category.trim(),
      });
      await load();
    } catch {
      setError(
        "Couldn't register that video — check it has \"Require signed URLs\" enabled on Cloudflare Stream, then try again.",
      );
    } finally {
      setRegistering(null);
    }
  }

  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-4 text-h1 font-bold text-ink">Video library</h1>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.videos.map((v) => (
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

      {data.unregisteredStreamVideos.length > 0 && (
        <section className="rounded-card border border-[#FEDF89] bg-[#FFFAEB] p-5">
          <h2 className="mb-1 text-h3 font-semibold text-ink">Found on Cloudflare Stream but not registered here</h2>
          <p className="mb-4 text-sm text-[#93370D]">
            Uploaded outside this console (e.g. via the Stream dashboard directly). Give each one a title, display
            code and category to add it to the library — it lands as a draft.
          </p>
          {error && <p className="mb-3 text-sm text-[#B42318]">{error}</p>}
          <ul className="space-y-3">
            {data.unregisteredStreamVideos.map((v) => {
              const f = fields[v.uid] ?? { title: "", display_code: "", category: "" };
              return (
                <li key={v.uid} className="rounded-[12px] border border-line bg-surface p-3">
                  <div className="mb-2 text-sm text-body">
                    <span className="font-medium text-ink">{v.name}</span>{" "}
                    <span className="text-muted">
                      · {v.ready ? formatDuration(v.duration_seconds) : "Still processing on Stream"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="block text-label uppercase text-muted">Title</label>
                      <input
                        type="text"
                        value={f.title}
                        onChange={(e) => updateField(v.uid, "title", e.target.value)}
                        className={`mt-1 w-48 ${inputClass}`}
                      />
                    </div>
                    <div>
                      <label className="block text-label uppercase text-muted">Display code</label>
                      <input
                        type="text"
                        placeholder="LOTO-01"
                        value={f.display_code}
                        onChange={(e) => updateField(v.uid, "display_code", e.target.value)}
                        className={`mt-1 w-28 ${inputClass}`}
                      />
                    </div>
                    <div>
                      <label className="block text-label uppercase text-muted">Category</label>
                      <input
                        type="text"
                        value={f.category}
                        onChange={(e) => updateField(v.uid, "category", e.target.value)}
                        className={`mt-1 w-36 ${inputClass}`}
                      />
                    </div>
                    <button
                      onClick={() => registerVideo(v.uid)}
                      disabled={!f.title.trim() || !f.display_code.trim() || !f.category.trim() || registering === v.uid}
                      className="rounded-input bg-primary px-3 py-1.5 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover active:bg-primary-press disabled:opacity-50"
                    >
                      {registering === v.uid ? "Adding…" : "Add to library"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
