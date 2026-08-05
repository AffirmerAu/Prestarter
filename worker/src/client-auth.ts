import type { Env } from "./env";
import { pgSelect } from "./supabase";

export type ClientAuthResult =
  | { ok: true; clientId: string; email: string }
  | { ok: false; response: Response };

function unauthorized(): Response {
  return new Response(JSON.stringify({ message: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
function forbidden(): Response {
  return new Response(JSON.stringify({ message: "Not linked to a client" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

interface SupabaseUser {
  id: string;
  email: string;
}

// Analogous to admin-auth.ts's requireAdmin, but resolves a client_contacts row instead of
// an admins row — scopes portal-only routes (QR/poster export, the HLS manifest link) to the
// caller's own client_id, never another client's.
export async function requireClientContact(request: Request, env: Env): Promise<ClientAuthResult> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false, response: unauthorized() };
  const token = auth.slice("Bearer ".length);

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { ok: false, response: unauthorized() };
  const user = (await userRes.json()) as SupabaseUser;

  const contacts = await pgSelect<{ client_id: string; email: string }>(
    env,
    `client_contacts?user_id=eq.${user.id}&select=client_id,email`,
  );
  const contact = contacts[0];
  if (!contact) return { ok: false, response: forbidden() };

  return { ok: true, clientId: contact.client_id, email: contact.email };
}
