import type { Env } from "./env";
import { pgSelect } from "./supabase";

export type AdminAuthResult =
  | { ok: true; adminId: string; email: string }
  | { ok: false; response: Response };

function unauthorized(): Response {
  return new Response(JSON.stringify({ message: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
function forbidden(): Response {
  return new Response(JSON.stringify({ message: "Not an administrator" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

interface SupabaseUser {
  id: string;
  email: string;
}

// Validates the caller's Supabase session (real magic-link auth, spec section 14 — a
// separate administrator role from client contacts) by asking Supabase's own auth server
// whether the token is a live session, then checks the admins table for that user_id.
// No JWT secret handling on our side — Supabase is the source of truth for token validity.
export async function requireAdmin(request: Request, env: Env): Promise<AdminAuthResult> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false, response: unauthorized() };
  const token = auth.slice("Bearer ".length);

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { ok: false, response: unauthorized() };
  const user = (await userRes.json()) as SupabaseUser;

  const admins = await pgSelect<{ id: string; email: string }>(
    env,
    `admins?user_id=eq.${user.id}&select=id,email`,
  );
  const admin = admins[0];
  if (!admin) return { ok: false, response: forbidden() };

  return { ok: true, adminId: admin.id, email: admin.email };
}
