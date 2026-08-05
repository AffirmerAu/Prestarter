import type { Env } from "./env";
import { requireClientContact } from "./client-auth";
import { handleQrExport, handlePosterExport } from "./admin-export";

// Client portal (spec section 11) — QR/poster rendering needs the Worker (resvg-wasm, the qr
// encoder), everything else the portal needs (status, videos, entitlements, access keys) is
// read directly by the frontend via Supabase + RLS, which is the actual enforcement layer for
// "clients only ever see their own data" (spec section 5 rule). These two routes exist only
// because rendering needs server-side code, not because RLS can't be trusted for reads.
//
// clientId always comes from the caller's OWN authenticated session (requireClientContact),
// never from the URL — a client must never be able to request another client's poster.
export async function handlePortal(request: Request, url: URL, env: Env): Promise<Response> {
  const auth = await requireClientContact(request, env);
  if (!auth.ok) return auth.response;

  const qr = url.pathname.match(/^\/portal\/videos\/([^/]+)\/qr\.(svg|png)$/);
  if (qr?.[1] && qr[2]) return handleQrExport(request, url, env, auth.clientId, qr[1], qr[2] as "svg" | "png");

  const poster = url.pathname.match(/^\/portal\/poster\.(svg|png)$/);
  if (poster?.[1]) return handlePosterExport(request, env, auth.clientId, poster[1] as "svg" | "png");

  return new Response("Not found", { status: 404 });
}
