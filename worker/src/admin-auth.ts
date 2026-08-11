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

// Admin and client-portal sign-in share the same Supabase Auth backend, so removing the
// magic-link button from the admin UI alone doesn't stop someone requesting a magic link for
// an admin's email through the PORTAL's own login form instead (its shouldCreateUser:false
// gate only checks "does this user already exist", which an admin account does) and then
// using that session's token against the admin API. requireAdmin has to reject that session
// itself, not just trust that no UI happens to offer it — same "enforced at the database/API
// layer, not just hidden in the interface" principle CLAUDE.md states elsewhere. Supabase's
// access token JWT carries an `amr` (authentication methods reference) claim recording how
// the session was actually established; verified empirically against a real password-derived
// session (`[{method: "password", timestamp: ...}]`) before relying on it here. The token was
// already independently proven live and unmodified by the /auth/v1/user round-trip above —
// this just reads an additional claim off that same already-validated token, not a
// self-verified/self-signed one.
function usedPasswordAuth(token: string): boolean {
  try {
    const segment = token.split(".")[1];
    if (!segment) return false;
    const payload = JSON.parse(atob(segment.replace(/-/g, "+").replace(/_/g, "/")));
    const amr = payload.amr as { method?: string }[] | undefined;
    return !!amr && amr.length > 0 && amr.every((m) => m.method === "password");
  } catch {
    return false;
  }
}

function passwordRequired(): Response {
  return new Response(JSON.stringify({ message: "Admin sign-in requires a password, not a magic link" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

// Validates the caller's Supabase session (password auth, spec section 14 — a separate
// administrator role from client contacts) by asking Supabase's own auth server whether the
// token is a live session, then checks the admins table for that user_id. No JWT secret
// handling on our side — Supabase is the source of truth for token validity.
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

  if (!usedPasswordAuth(token)) return { ok: false, response: passwordRequired() };

  return { ok: true, adminId: admin.id, email: admin.email };
}
