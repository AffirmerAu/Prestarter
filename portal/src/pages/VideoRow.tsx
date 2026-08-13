import { useRef, useState } from "react";
import { openAsset, WORKER_ORIGIN } from "../lib/api";
import { VideoThumbnail } from "../components/VideoThumbnail";

interface Video {
  id: string;
  title: string;
  duration_seconds: number;
  display_code: string;
}
interface VideoLanguage {
  video_id: string;
  language_tag: string;
  label_native: string;
  is_default: boolean;
}

type Format = "watch" | "embed" | "manifest";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function buildLink(videoId: string, accessKey: string, format: Format, lang: string): string {
  // These links get copied out to the client's own systems (embeds, intranet pages, printed
  // posters via QR) — they must point at the Worker's real origin (prestarter.au), never the
  // portal's own origin (app.prestarter.au), which doesn't serve /w or /m at all. Falls back
  // to window.location.origin only in local dev, where the Vite proxy makes that work.
  const origin = WORKER_ORIGIN || window.location.origin;
  const params = new URLSearchParams({ k: accessKey });
  if (lang) params.set("lang", lang);
  if (format === "manifest") return `${origin}/m/${videoId}?${params.toString()}`;
  const watchUrl = `${origin}/w/${videoId}?${params.toString()}`;
  if (format === "watch") return watchUrl;
  return `<iframe src="${watchUrl}" width="960" height="540" allow="fullscreen" style="border:0"></iframe>`;
}

export function VideoRow({
  video,
  languages,
  accessKey,
}: {
  video: Video;
  languages: VideoLanguage[];
  accessKey: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [format, setFormat] = useState<Format>("watch");
  const [lang, setLang] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const linkRef = useRef<HTMLElement | null>(null);

  const link = accessKey ? buildLink(video.id, accessKey, format, lang) : "";
  // Same watch-page URL already used for the copyable "Watch page" link below — playing it
  // inline here doesn't hand the client anything they couldn't already get from that panel,
  // it's just rendered instead of copied. Still a link to the player domain carrying the
  // access key, never a raw Cloudflare Stream URL (CLAUDE.md security invariants).
  const playUrl = accessKey ? buildLink(video.id, accessKey, "watch", "") : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write can be denied by browser/permissions-policy even on a real click
      // (confirmed in testing) — fall back to selecting the text so the user can still
      // copy it manually with Ctrl/Cmd-C, rather than silently doing nothing.
      setCopyFailed(true);
      if (linkRef.current) {
        const range = document.createRange();
        range.selectNodeContents(linkRef.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-center gap-4">
        <VideoThumbnail
          videoId={video.id}
          displayCode={video.display_code}
          className="aspect-video w-32 shrink-0 rounded-[12px]"
        />
        <div className="flex-1">
          <div className="font-medium text-ink">{video.title}</div>
          <div className="text-sm text-muted">
            {formatDuration(video.duration_seconds)}
            {languages.length > 0 && ` · ${languages.map((l) => l.label_native).join(", ")}`}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPlaying((p) => !p)}
            disabled={!accessKey}
            className="rounded-input bg-primary px-3 py-1.5 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover active:bg-primary-press disabled:opacity-50"
          >
            {playing ? "Hide player" : "Play"}
          </button>
          <button
            onClick={() => accessKey && openAsset(`/portal/videos/${video.id}/qr.png`)}
            className="rounded-input border border-line-strong px-3 py-1.5 text-sm text-body hover:bg-surface-sunken"
          >
            Download QR
          </button>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="rounded-input border border-line-strong px-3 py-1.5 text-sm text-body hover:bg-surface-sunken"
          >
            {expanded ? "Hide link" : "Get link"}
          </button>
        </div>
      </div>

      {playing && playUrl && (
        <div className="mt-4 aspect-video w-full overflow-hidden rounded-[12px] border border-line bg-surface-inverse">
          <iframe
            src={playUrl}
            className="h-full w-full border-0"
            allow="fullscreen"
            title={video.title}
          />
        </div>
      )}

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-input border border-line-strong text-sm">
              {(["watch", "embed", "manifest"] as Format[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`px-3 py-1.5 first:rounded-l-input last:rounded-r-input ${
                    format === f ? "bg-primary text-white" : "text-body hover:bg-surface-sunken"
                  }`}
                >
                  {f === "watch" ? "Watch page" : f === "embed" ? "Iframe embed" : "HLS manifest"}
                </button>
              ))}
            </div>
            {languages.length > 0 && (
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="rounded-input border border-line-strong px-2 py-1.5 text-sm text-body focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/24"
              >
                <option value="">No language preselected</option>
                {languages.map((l) => (
                  <option key={l.language_tag} value={l.language_tag}>
                    {l.label_native}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex gap-2">
            <code
              ref={linkRef}
              className="flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-surface-muted px-2 py-1.5 text-code font-mono text-body"
            >
              {link}
            </code>
            <button
              onClick={copyLink}
              className="shrink-0 rounded-input bg-primary px-3 py-1.5 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover active:bg-primary-press"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {copyFailed && (
            <p className="text-xs text-[#93370D]">
              Couldn't copy automatically — the link above is selected, use Ctrl/Cmd-C to copy it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
