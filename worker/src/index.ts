import type { Env } from "./env";
import { renderPlayerPage } from "./player";
import { mintPlaybackToken } from "./stream";
import { checkEntitlement, recordPlay } from "./entitlement";
import { handleInternalAdmin } from "./admin";
import { handlePortal } from "./portal";
import { runBillingTransitions } from "./billing-cron";
import { handlePreflight, withCors } from "./cors";

const DENIAL_MESSAGE =
  "This licence is not currently active, please contact your safety team.";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const playerMatch = url.pathname.match(/^\/w\/([^/]+)$/);
    if (playerMatch?.[1]) {
      const videoId = decodeURIComponent(playerMatch[1]);
      const accessKey = url.searchParams.get("k") ?? "";
      const lang = url.searchParams.get("lang");
      return new Response(renderPlayerPage(videoId, accessKey, lang, env), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/api/token") {
      return handleTokenRequest(request, url, env, ctx);
    }

    const manifestMatch = url.pathname.match(/^\/m\/([^/]+)$/);
    if (manifestMatch?.[1]) {
      return handleManifestLink(request, url, env, ctx, manifestMatch[1]);
    }

    if (url.pathname.startsWith("/internal/")) {
      const preflight = handlePreflight(request);
      if (preflight) return preflight;
      return withCors(request, await handleInternalAdmin(request, url, env));
    }

    if (url.pathname.startsWith("/portal/")) {
      const preflight = handlePreflight(request);
      if (preflight) return preflight;
      return withCors(request, await handlePortal(request, url, env));
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runBillingTransitions(env));
  },
};

async function handleTokenRequest(request: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const videoId = url.searchParams.get("videoId");
  const accessKey = url.searchParams.get("k");
  if (!videoId || !accessKey) return deny();

  try {
    const result = await checkEntitlement(env, videoId, accessKey);
    if (!result.ok) return deny();

    const source = (url.searchParams.get("src") as "embed" | "watch" | "poster" | "preview" | null) ?? "watch";
    const languageTag = url.searchParams.get("lang");
    // Respond with the token immediately; play recording (spec section 6 step 4) happens
    // in the background so it never adds to the <200ms token-issue budget (spec section 15).
    ctx.waitUntil(recordPlay(env, request, result.clientId, videoId, { source, languageTag }));

    const minted = await mintPlaybackToken(env, result.streamUid);
    return new Response(
      JSON.stringify({
        token: minted.token,
        issuedAtMs: minted.issuedAtMs,
        expiresAtMs: minted.expiresAtMs,
        markAs: result.markAs,
      }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    // On any validation or upstream failure, deny playback. Never fall back
    // to an unsigned URL (security invariants in CLAUDE.md / spec section 6).
    console.error(err);
    return deny();
  }
}

// The client portal's "HLS manifest" link format (spec section 11) needs to stay a static,
// copyable URL a client can paste into their own player/system — but a signed Stream manifest
// URL carries a token that expires in 120 seconds. So this is a stable proxy: validate the
// access key fresh, mint a brand new token, and 307-redirect to the real (short-lived) signed
// manifest URL every time it's hit. The static link never goes stale; what's behind it does.
async function handleManifestLink(
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
  videoId: string,
): Promise<Response> {
  const accessKey = url.searchParams.get("k");
  if (!accessKey) return deny();

  try {
    const result = await checkEntitlement(env, videoId, accessKey);
    if (!result.ok) return deny();

    const languageTag = url.searchParams.get("lang");
    ctx.waitUntil(recordPlay(env, request, result.clientId, videoId, { source: "embed", languageTag }));

    const minted = await mintPlaybackToken(env, result.streamUid);
    const manifestUrl = `https://customer-${env.STREAM_CUSTOMER_CODE}.cloudflarestream.com/${minted.token}/manifest/video.m3u8`;
    return Response.redirect(manifestUrl, 307);
  } catch (err) {
    console.error(err);
    return deny();
  }
}

export function deny(): Response {
  return new Response(JSON.stringify({ message: DENIAL_MESSAGE }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}
