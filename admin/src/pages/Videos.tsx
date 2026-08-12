import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../lib/api";
import { VideoThumbnail } from "../components/VideoThumbnail";

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
  const [busy, setBusy] = useState<string | null>(null);
  const [deletingVideo, setDeletingVideo] = useState<VideoRow | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  async function load() {
    const d = await apiGet<VideosResponse>("/internal/videos");
    setData(d);
  }

  async function removeVideo(e: React.MouseEvent, video: VideoRow) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Remove "${video.title}" from the library? Clients currently entitled to it lose access immediately.`)) return;
    setBusy(video.id);
    await apiPost(`/internal/videos/${video.id}/archive`, {});
    await load();
    setBusy(null);
  }

  async function restoreVideoTile(e: React.MouseEvent, video: VideoRow) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(video.id);
    await apiPost(`/internal/videos/${video.id}/restore`, {});
    await load();
    setBusy(null);
  }

  function openDeleteConfirm(e: React.MouseEvent, video: VideoRow) {
    e.preventDefault();
    e.stopPropagation();
    setDeletingVideo(video);
    setDeleteConfirmText("");
  }

  async function confirmDelete() {
    if (!deletingVideo || deleteConfirmText !== deletingVideo.display_code) return;
    setBusy(deletingVideo.id);
    const result = await apiPost<{ stream_deleted: boolean }>(`/internal/videos/${deletingVideo.id}/delete`, {});
    if (!result.stream_deleted) {
      window.alert(
        "The video was deleted here, but Cloudflare Stream refused to delete the underlying file (a known permission gap on the current API token). It's still sitting on Stream and will keep being billed until someone deletes it there manually or the token's permissions are fixed.",
      );
    }
    setDeletingVideo(null);
    setDeleteConfirmText("");
    await load();
    setBusy(null);
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
          {data.videos.map((v) => {
            const archived = v.status === "archived";
            return (
              <Link
                key={v.id}
                to={`/videos/${v.id}`}
                className={`rounded-card border border-line bg-surface p-4 transition-colors hover:border-line-strong ${archived ? "opacity-50" : ""}`}
              >
                <VideoThumbnail
                  videoId={v.id}
                  displayCode={v.display_code}
                  className="mb-2 aspect-video w-full rounded-[12px]"
                />
                <div className="text-sm font-medium text-ink">{v.title}</div>
                <div className="mb-2 text-xs text-muted">
                  {v.category} · {formatDuration(v.duration_seconds)} · {v.status}
                </div>
                {archived ? (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={(e) => restoreVideoTile(e, v)}
                      disabled={busy === v.id}
                      className="text-xs font-medium text-primary-press hover:underline disabled:opacity-50"
                    >
                      {busy === v.id ? "Restoring…" : "Restore"}
                    </button>
                    <button
                      onClick={(e) => openDeleteConfirm(e, v)}
                      disabled={busy === v.id}
                      className="text-xs font-medium text-[#B42318] hover:underline disabled:opacity-50"
                    >
                      Delete forever
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => removeVideo(e, v)}
                    disabled={busy === v.id}
                    className="text-xs font-medium text-[#B42318] hover:underline disabled:opacity-50"
                  >
                    {busy === v.id ? "Removing…" : "Remove"}
                  </button>
                )}
              </Link>
            );
          })}
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

      {deletingVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 shadow-md">
            <h2 className="mb-2 text-h3 font-semibold text-ink">Delete "{deletingVideo.title}" forever?</h2>
            <p className="mb-4 text-sm text-body">
              This permanently deletes the video, its captions, entitlement history, and all play/usage records —
              and removes the underlying file from Cloudflare Stream. This cannot be undone.
            </p>
            <label className="mb-1 block text-label uppercase text-muted">
              Type <span className="font-mono text-ink">{deletingVideo.display_code}</span> to confirm
            </label>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              autoFocus
              className={`mb-4 w-full ${inputClass}`}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeletingVideo(null)}
                disabled={busy === deletingVideo.id}
                className="rounded-input border border-line-strong px-3 py-1.5 text-sm text-body hover:bg-surface-sunken disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteConfirmText !== deletingVideo.display_code || busy === deletingVideo.id}
                className="rounded-input border border-[#FECDCA] bg-[#B42318] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#912018] disabled:opacity-50"
              >
                {busy === deletingVideo.id ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
