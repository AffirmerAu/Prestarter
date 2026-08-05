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

// Priority order when more than one condition applies at once (e.g. paused AND overdue) —
// most restrictive wins, since that's the one the client actually needs to act on.
function statusBanner(client: ClientStatus): string {
  if (client.status === "paused") return "Your licence is currently paused. Please contact Affirmer.";
  if (client.billing_state === "overdue") return "Access is paused pending payment. Please contact Affirmer.";
  if (client.billing_state === "due") return "A payment is outstanding on your licence. Access continues for now.";
  const daysToRenewal = (new Date(client.term_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysToRenewal <= RENEWAL_WINDOW_DAYS) {
    return "Your licence is approaching its renewal date. Affirmer will be in touch.";
  }
  return "Your licence is active.";
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

  if (!loaded) return <p className="p-8 text-sm text-gray-500">Loading…</p>;

  // A signed-in user with no matching client_contacts row (wrong email, or one never
  // provisioned for them) — client_safe_status legitimately returns zero rows via RLS.
  // Show that plainly instead of hanging on "Loading…" forever with no way out.
  if (!client) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="text-sm text-gray-700">
          No client account is set up for <span className="font-medium">{session?.user.email}</span>.
          Contact Affirmer to be added, or sign in with the correct email.
        </p>
        <button
          onClick={signOut}
          className="mt-4 rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
          <span className="text-sm font-semibold text-gray-900">{client.name}</span>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span>{session?.user.email}</span>
            <button onClick={signOut} className="text-gray-400 hover:text-gray-700">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 text-sm font-medium text-gray-900">
          {statusBanner(client)}
        </div>

        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">Your videos</h1>
          {videos.length > 0 && (
            <button
              onClick={() => openAsset("/portal/poster.png")}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
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
          {videos.length === 0 && <p className="text-sm text-gray-500">No videos licensed yet.</p>}
        </div>

        <footer className="mt-10 border-t border-gray-200 pt-4 text-xs text-gray-500">
          Your organisation's name and the playback time appear discreetly on every play.
        </footer>
      </main>
    </div>
  );
}
