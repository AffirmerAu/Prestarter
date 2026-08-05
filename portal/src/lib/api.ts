import { supabase } from "./supabase";

// Portal and Worker are on separate origins in production (app.prestarter.au vs
// prestarter.au). See admin/src/lib/api.ts for the empirical bug this pattern is fixing —
// same class of issue applies here for /portal/* fetches.
export const WORKER_ORIGIN = import.meta.env.VITE_WORKER_ORIGIN ?? "";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

// window.open() must happen before the `await` below (synchronously, inside the click
// handler) — doing it after breaks the browser's user-gesture chain and gets silently
// popup-blocked. Confirmed empirically while building the admin console; same fix here.
export async function openAsset(path: string) {
  const tab = window.open("", "_blank");
  const headers = await authHeaders();
  const res = await fetch(`${WORKER_ORIGIN}${path}`, { headers });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (tab) tab.location.href = url;
}
