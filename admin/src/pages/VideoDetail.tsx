import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet, apiPost, apiPostForm, BASE } from "../lib/api";

interface VideoLanguage {
  id: string;
  language_tag: string;
  kind: "caption" | "audio";
  label_native: string;
  is_default: boolean;
  source: "uploaded" | "generated";
  reviewed_at: string | null;
}

interface VideoDetailData {
  video: { id: string; title: string; display_code: string; stream_uid: string; status: string };
  languages: VideoLanguage[];
  entitledClients: { client_id: string; clients: { id: string; name: string } }[];
}

async function fetchPreviewKey(clientId: string): Promise<string | null> {
  const detail = await apiGet<{ keys: { key: string; revoked_at: string | null }[] }>(`/internal/clients/${clientId}`);
  return detail.keys.find((k) => !k.revoked_at)?.key ?? null;
}

export function VideoDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<VideoDetailData | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const langInput = useRef<HTMLInputElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

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

  async function markReviewed(languageId: string) {
    await apiPost(`/internal/video-languages/${languageId}/mark-reviewed`, {});
    await load();
  }

  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;
  const captions = data.languages.filter((l) => l.kind === "caption");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">{data.video.title}</h1>
        <p className="text-sm text-gray-500">
          {data.video.display_code} · {data.video.status}
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Review player</h2>
        {previewUrl ? (
          <iframe
            src={previewUrl}
            className="aspect-video w-full max-w-xl rounded border border-gray-200"
            title="Review player"
          />
        ) : (
          <p className="text-sm text-gray-500">
            No client is entitled to this video yet, so there's no access key to preview playback with — the
            watermark uses the entitled client's real key, matching exactly what that client sees.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Captions</h2>
        <ul className="mb-4 divide-y divide-gray-100 text-sm">
          {captions.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2">
              <div>
                <span className="font-medium text-gray-900">{c.label_native}</span>{" "}
                <span className="text-gray-500">({c.language_tag})</span>
                {c.is_default && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs">default</span>}
              </div>
              {c.reviewed_at ? (
                <span className="text-xs text-green-700">Reviewed {new Date(c.reviewed_at).toLocaleDateString("en-AU")}</span>
              ) : (
                <button onClick={() => markReviewed(c.id)} className="text-xs font-medium text-amber-700 hover:underline">
                  Unreviewed — mark reviewed
                </button>
              )}
            </li>
          ))}
          {captions.length === 0 && <li className="py-2 text-gray-500">No captions yet.</li>}
        </ul>

        <form onSubmit={uploadCaption} className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4">
          <div>
            <label className="block text-xs text-gray-500">Language tag (BCP-47)</label>
            <input ref={langInput} type="text" placeholder="es" required className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500">Native label</label>
            <input ref={labelInput} type="text" placeholder="Español" required className="w-32 rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500">WebVTT file</label>
            <input ref={fileInput} type="file" accept=".vtt" required className="text-sm" />
          </div>
          <button
            type="submit"
            disabled={uploading}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            Upload
          </button>
        </form>
        <p className="mt-2 text-xs text-gray-500">
          Uploaded captions land unreviewed — a mistranslated safety instruction is a liability, not a typo.
        </p>
      </section>
    </div>
  );
}
