import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet, apiPost, apiPostForm, downloadAsset, BASE } from "../lib/api";
import { VideoThumbnail } from "../components/VideoThumbnail";

interface VideoLanguage {
  id: string;
  language_tag: string;
  kind: "caption" | "audio";
  label_native: string;
  is_default: boolean;
  source: "uploaded" | "generated" | "stream_sync";
  reviewed_at: string | null;
}

interface UnsyncedStreamCaption {
  language_tag: string;
  status: string;
}

interface VideoDetailData {
  video: { id: string; title: string; display_code: string; stream_uid: string; status: string };
  languages: VideoLanguage[];
  entitledClients: { client_id: string; clients: { id: string; name: string } }[];
  unsyncedStreamCaptions: UnsyncedStreamCaption[];
}

async function fetchPreviewKey(clientId: string): Promise<string | null> {
  const detail = await apiGet<{ keys: { key: string; revoked_at: string | null }[] }>(`/internal/clients/${clientId}`);
  return detail.keys.find((k) => !k.revoked_at)?.key ?? null;
}

const cardClass = "rounded-card border border-line bg-surface p-5";
const cardHeaderClass = "mb-3 border-b border-line pb-3 text-h3 font-semibold text-ink";
const inputClass =
  "rounded-input border border-line-strong px-2.5 py-1.5 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/24";

export function VideoDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<VideoDetailData | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const langInput = useRef<HTMLInputElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [syncLabels, setSyncLabels] = useState<Record<string, string>>({});
  const [registering, setRegistering] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const thumbnailInput = useRef<HTMLInputElement>(null);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [thumbnailVersion, setThumbnailVersion] = useState(0);
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);

  async function load() {
    const d = await apiGet<VideoDetailData>(`/internal/videos/${id}`);
    setData(d);
    const firstClient = d.entitledClients[0]?.client_id;
    if (firstClient) {
      const key = await fetchPreviewKey(firstClient);
      if (key) setPreviewUrl(`${BASE}/w/${id}?k=${key}&src=preview`);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function uploadCaption(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file || !langInput.current?.value || !labelInput.current?.value) return;
    setUploading(true);
    const form = new FormData();
    form.set("file", file);
    form.set("language_tag", langInput.current.value);
    form.set("label_native", labelInput.current.value);
    form.set("is_default", "false");
    await apiPostForm(`/internal/videos/${id}/captions`, form);
    if (fileInput.current) fileInput.current.value = "";
    if (langInput.current) langInput.current.value = "";
    if (labelInput.current) labelInput.current.value = "";
    await load();
    setUploading(false);
  }

  async function uploadThumbnail(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingThumbnail(true);
    setThumbnailError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      await apiPostForm(`/internal/videos/${id}/thumbnail`, form);
      setThumbnailVersion((v) => v + 1);
    } catch {
      setThumbnailError("Couldn't upload that image — it must be a JPEG, PNG or WebP under 5MB.");
    } finally {
      setUploadingThumbnail(false);
      if (thumbnailInput.current) thumbnailInput.current.value = "";
    }
  }

  async function markReviewed(languageId: string) {
    await apiPost(`/internal/video-languages/${languageId}/mark-reviewed`, {});
    await load();
  }

  async function registerFromStream(languageTag: string) {
    const labelNative = syncLabels[languageTag]?.trim();
    if (!labelNative) return;
    setRegistering(languageTag);
    try {
      await apiPost(`/internal/videos/${id}/captions/register-from-stream`, {
        language_tag: languageTag,
        label_native: labelNative,
        is_default: false,
      });
      await load();
    } finally {
      setRegistering(null);
    }
  }

  async function removeCaption(languageId: string, label: string) {
    if (!window.confirm(`Remove the "${label}" caption? This deletes it from Cloudflare Stream too.`)) return;
    setRemoving(languageId);
    try {
      await apiPost(`/internal/video-languages/${languageId}/delete`, {});
      await load();
    } finally {
      setRemoving(null);
    }
  }

  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const captions = data.languages.filter((l) => l.kind === "caption");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-h1 font-bold text-ink">{data.video.title}</h1>
        <p className="text-sm text-muted">
          {data.video.display_code} · {data.video.status}
        </p>
      </div>

      <section className={cardClass}>
        <h2 className={cardHeaderClass}>Thumbnail</h2>
        <div className="flex items-end gap-4">
          <VideoThumbnail
            videoId={data.video.id}
            displayCode={data.video.display_code}
            version={thumbnailVersion}
            className="aspect-video w-48 rounded-[12px] border border-line"
          />
          <div>
            <input
              ref={thumbnailInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={uploadThumbnail}
              disabled={uploadingThumbnail}
              className="text-sm text-body"
            />
            <p className="mt-1 text-xs text-muted">JPEG, PNG or WebP, up to 5MB. Replaces the current thumbnail.</p>
            {uploadingThumbnail && <p className="mt-1 text-xs text-muted">Uploading…</p>}
            {thumbnailError && <p className="mt-1 text-xs text-[#B42318]">{thumbnailError}</p>}
          </div>
        </div>
      </section>

      <section className={cardClass}>
        <h2 className={cardHeaderClass}>Review player</h2>
        {previewUrl ? (
          <iframe
            src={previewUrl}
            className="aspect-video w-full max-w-xl rounded-[12px] border border-line"
            title="Review player"
          />
        ) : (
          <p className="text-sm text-muted">
            No client is entitled to this video yet, so there's no access key to preview playback with — the
            watermark uses the entitled client's real key, matching exactly what that client sees.
          </p>
        )}
      </section>

      <section className={cardClass}>
        <h2 className={cardHeaderClass}>Captions</h2>
        <ul className="mb-4 divide-y divide-[#F2F4F7] text-sm">
          {captions.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2">
              <div>
                <span className="font-medium text-ink">{c.label_native}</span>{" "}
                <span className="text-muted">({c.language_tag})</span>
                {c.is_default && (
                  <span className="ml-2 rounded-full border border-line bg-surface-muted px-2 py-0.5 text-xs font-semibold text-[#475467]">
                    default
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {c.reviewed_at ? (
                  <span className="text-xs font-medium text-primary-press">
                    Reviewed {new Date(c.reviewed_at).toLocaleDateString("en-AU")}
                  </span>
                ) : (
                  <button onClick={() => markReviewed(c.id)} className="text-xs font-medium text-[#93370D] hover:underline">
                    Unreviewed — mark reviewed
                  </button>
                )}
                <button
                  onClick={() => downloadAsset(`/internal/video-languages/${c.id}/vtt`, `${c.language_tag}.vtt`)}
                  className="text-xs font-medium text-muted hover:underline"
                >
                  Download .vtt
                </button>
                <button
                  onClick={() => removeCaption(c.id, c.label_native)}
                  disabled={removing === c.id}
                  className="text-xs font-medium text-[#B42318] hover:underline disabled:opacity-50"
                >
                  {removing === c.id ? "Removing…" : "Remove"}
                </button>
              </div>
            </li>
          ))}
          {captions.length === 0 && <li className="py-2 text-muted">No captions yet.</li>}
        </ul>

        {data.unsyncedStreamCaptions.length > 0 && (
          <div className="mb-4 rounded-[12px] border border-[#FEDF89] bg-[#FFFAEB] p-3">
            <p className="mb-2 text-xs font-medium text-[#93370D]">
              Found on Cloudflare Stream but not registered here — uploaded outside this console (e.g. via the
              Stream dashboard directly), so nothing has reviewed them yet. Give each a native-script label to
              register it; it lands unreviewed like any other caption.
            </p>
            <ul className="space-y-2">
              {data.unsyncedStreamCaptions.map((c) => (
                <li key={c.language_tag} className="flex items-center gap-2">
                  <span className="w-14 text-sm font-medium text-ink">{c.language_tag}</span>
                  <input
                    type="text"
                    placeholder="Native label, e.g. Español"
                    value={syncLabels[c.language_tag] ?? ""}
                    onChange={(e) => setSyncLabels((s) => ({ ...s, [c.language_tag]: e.target.value }))}
                    className={`flex-1 ${inputClass}`}
                  />
                  <button
                    onClick={() => registerFromStream(c.language_tag)}
                    disabled={!syncLabels[c.language_tag]?.trim() || registering === c.language_tag}
                    className="rounded-input border border-line-strong bg-surface px-3 py-1.5 text-sm text-body hover:bg-surface-sunken disabled:opacity-50"
                  >
                    {registering === c.language_tag ? "Registering…" : "Register"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={uploadCaption} className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <div>
            <label className="block text-label uppercase text-muted">Language tag (BCP-47)</label>
            <input ref={langInput} type="text" placeholder="es" required className={`mt-1 w-24 ${inputClass}`} />
          </div>
          <div>
            <label className="block text-label uppercase text-muted">Native label</label>
            <input ref={labelInput} type="text" placeholder="Español" required className={`mt-1 w-32 ${inputClass}`} />
          </div>
          <div>
            <label className="block text-label uppercase text-muted">WebVTT file</label>
            <input ref={fileInput} type="file" accept=".vtt" required className="mt-1 text-sm text-body" />
          </div>
          <button
            type="submit"
            disabled={uploading}
            className="rounded-input bg-primary px-3 py-1.5 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover active:bg-primary-press disabled:opacity-50"
          >
            Upload
          </button>
        </form>
        <p className="mt-2 text-xs text-muted">
          Uploaded captions land unreviewed — a mistranslated safety instruction is a liability, not a typo.
        </p>
      </section>
    </div>
  );
}
