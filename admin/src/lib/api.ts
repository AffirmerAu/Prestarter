import { supabase } from "./supabase";

// Admin console and Worker are on separate origins in production (admin.prestarter.au vs
// prestarter.au — spec section 19's "one host or two" resolved to separate subdomains), so
// this can't be a relative path there. Confirmed empirically: a relative fetch to
// /internal/dashboard from the deployed Pages site returned 200 with Pages' own SPA-fallback
// index.html, not the Worker's response — silently "worked" (200) while being completely
// wrong. VITE_WORKER_ORIGIN carries the absolute URL in production; local dev leaves it unset
// and relies on the Vite proxy (vite.config.ts) instead.
export const BASE = import.meta.env.VITE_WORKER_ORIGIN ?? "";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: await authHeaders(), body: form });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

export function assetUrl(path: string): Promise<string> {
  return authHeaders().then(async (headers) => {
    const res = await fetch(`${BASE}${path}`, { headers });
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  });
}
