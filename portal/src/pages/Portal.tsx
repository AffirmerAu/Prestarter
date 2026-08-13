import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { openAsset } from "../lib/api";
import { VideoRow } from "./VideoRow";

interface ClientStatus {
  id: string;
  name: string;
  mark_as: string;
  status: string;
  term_end: string;
  billing_state: string;
}

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

const RENEWAL_WINDOW_DAYS = 60;

type Tone = "success" | "warning" | "error";

const BANNER_TONE_CLASSES: Record<Tone, string> = {
  success: "bg-primary-tint border-primary-tint-border text-primary-press",
  warning: "bg-[#FFFAEB] border-[#FEDF89] text-[#93370D]",
  error: "bg-[#FEF3F2] border-[#FECDCA] text-[#B42318]",
};

// Priority order when more than one condition applies at once (e.g. paused AND overdue) —
// most restrictive wins, since that's the one the client actually needs to act on.
function statusBanner(client: ClientStatus): { tone: Tone; word: string; detail: string } {
  if (client.status === "paused") return { tone: "error", word: "Paused.", detail: "Please contact Affirmer." };
  if (client.billing_state === "overdue") {
    return { tone: "error", word: "Access paused.", detail: "Payment is required — contact Affirmer." };
  }
  if (client.billing_state === "due") {
    return { tone: "warning", word: "Payment due.", detail: "Access continues for now." };
  }
  const daysToRenewal = (new Date(client.term_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysToRenewal <= RENEWAL_WINDOW_DAYS) {
    return { tone: "warning", word: "Renewal approaching.", detail: "Affirmer will be in touch." };
  }
  return { tone: "success", word: "Active.", detail: "Your licence is in good standing." };
}

export function Portal() {
  const { session, signOut } = useAuth();
  const [client, setClient] = useState<ClientStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [videos, setVideos] = useState<Video[]>([]);
  const [languages, setLanguages] = useState<VideoLanguage[]>([]);
  const [accessKey, setAccessKey] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: statusRows } = await supabase.from("client_safe_status").select("*");
      setClient(statusRows?.[0] ?? null);

      const { data: entitlementRows } = await supabase
        .from("entitlements")
        .select("video_id, videos(id, title, duration_seconds, display_code)");
      setVideos((entitlementRows ?? []).map((e) => e.videos).filter(Boolean) as unknown as Video[]);

      const { data: languageRows } = await supabase
        .from("video_languages")
        .select("video_id, language_tag, label_native, is_default")
        .eq("kind", "caption");
      setLanguages(languageRows ?? []);

      const { data: keyRows } = await supabase
        .from("access_keys")
        .select("key")
        .order("issued_at", { ascending: false })
        .limit(1);
      setAccessKey(keyRows?.[0]?.key ?? null);
      setLoaded(true);
    }
    load();
  }, []);

  if (!loaded) return <p className="p-8 text-sm text-muted">Loading…</p>;

  // A signed-in user with no matching client_contacts row (wrong email, or one never
  // provisioned for them) — client_safe_status legitimately returns zero rows via RLS.
  // Show that plainly instead of hanging on "Loading…" forever with no way out.
  if (!client) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="text-sm text-body">
          No client account is set up for <span className="font-medium text-ink">{session?.user.email}</span>.
          Contact Affirmer to be added, or sign in with the correct email.
        </p>
        <button
          onClick={signOut}
          className="mt-4 rounded-input border border-line-strong px-3 py-1.5 text-sm text-body hover:bg-surface-sunken"
        >
          Sign out
        </button>
      </div>
    );
  }

  const banner = statusBanner(client);

  return (
    <div className="min-h-screen bg-surface-sunken">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <img src="/brand/logo-horizontal.png" alt="Prestarter" className="h-10 w-auto shrink-0 sm:h-[60px]" />
            <span className="text-sm text-muted">by Affirmer</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium text-ink">{client.name}</span>
            <span className="min-w-0 truncate text-muted">{session?.user.email}</span>
            <button onClick={signOut} className="shrink-0 text-subtle hover:text-body">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className={`mb-6 rounded-[12px] border p-5 text-sm ${BANNER_TONE_CLASSES[banner.tone]}`}>
          <span className="font-bold">{banner.word}</span> <span className="font-normal">{banner.detail}</span>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-h1 font-bold text-ink">Your videos</h1>
          {videos.length > 0 && (
            <button
              onClick={() => openAsset("/portal/poster.png")}
              className="rounded-input border border-line-strong px-3 py-1.5 text-sm text-body hover:bg-surface-sunken"
            >
              Export poster
            </button>
          )}
        </div>
        <div className="space-y-3">
          {videos.map((v) => (
            <VideoRow
              key={v.id}
              video={v}
              languages={languages.filter((l) => l.video_id === v.id)}
              accessKey={accessKey}
            />
          ))}
          {videos.length === 0 && <p className="text-sm text-muted">No videos licensed yet.</p>}
        </div>

        <footer className="mt-10 border-t border-line pt-4 text-xs text-muted">
          <p className="mb-1">Your organisation's name and the playback time appear discreetly on every play.</p>
          <p>Prestarter, by Affirmer.</p>
        </footer>
      </main>
    </div>
  );
}
