import type { Env } from "./env";

// Thin PostgREST client using the service role key — this is server-side only and bypasses
// RLS by design (RLS in 0002_rls.sql governs client-facing access, not this). Never send
// SUPABASE_SERVICE_ROLE_KEY to a client.

function headers(env: Env, extra?: Record<string, string>) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function pgSelect<T>(env: Env, query: string): Promise<T[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${query}`, { headers: headers(env) });
  if (!res.ok) throw new Error(`select ${query} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function pgInsert<T>(env: Env, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: headers(env, { Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`insert ${table} failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as T[];
  const inserted = rows[0];
  if (!inserted) throw new Error(`insert ${table} returned no row`);
  return inserted;
}

export async function pgPatch(env: Env, query: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${query}`, {
    method: "PATCH",
    headers: headers(env),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`patch ${query} failed: ${res.status} ${await res.text()}`);
}

// Upsert-by-conflict-target, used for the usage_daily counter (primary key client_id,
// video_id, day). Uses PostgREST's on_conflict + merge-duplicates.
export async function pgUpsert(
  env: Env,
  table: string,
  row: Record<string, unknown>,
  onConflict: string,
): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: headers(env, { Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`upsert ${table} failed: ${res.status} ${await res.text()}`);
}
