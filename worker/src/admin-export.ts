import type { Env } from "./env";
import { pgSelect } from "./supabase";
import { qrToSvg } from "./qr";
import { buildPosterSvg, type PosterVideo } from "./poster";
import { svgToPng } from "./render-png";

function svgResponse(svg: string): Response {
  return new Response(svg, { headers: { "content-type": "image/svg+xml" } });
}
async function pngResponse(svg: string, widthPx: number): Promise<Response> {
  const png = await svgToPng(svg, widthPx);
  return new Response(png, { headers: { "content-type": "image/png" } });
}

function buildWatchUrl(baseUrl: string, videoId: string, accessKey: string, opts: { src: string; lang?: string }): string {
  const url = new URL(`/w/${videoId}`, baseUrl);
  url.searchParams.set("k", accessKey);
  url.searchParams.set("src", opts.src);
  if (opts.lang) url.searchParams.set("lang", opts.lang);
  return url.toString();
}

async function activeAccessKey(env: Env, clientId: string): Promise<string | null> {
  const keys = await pgSelect<{ key: string }>(
    env,
    `access_keys?client_id=eq.${clientId}&revoked_at=is.null&select=key&order=issued_at.desc&limit=1`,
  );
  return keys[0]?.key ?? null;
}

export async function handleQrExport(
  request: Request,
  url: URL,
  env: Env,
  clientId: string,
  videoId: string,
  format: "svg" | "png",
): Promise<Response> {
  const key = await activeAccessKey(env, clientId);
  if (!key) return new Response(JSON.stringify({ message: "No active access key" }), { status: 404 });

  const lang = url.searchParams.get("lang") ?? undefined;
  const watchUrl = buildWatchUrl(new URL(request.url).origin, videoId, key, { src: "poster", lang });
  const svg = qrToSvg(watchUrl);
  return format === "svg" ? svgResponse(svg) : pngResponse(svg, 1000);
}

export async function handlePosterExport(
  request: Request,
  env: Env,
  clientId: string,
  format: "svg" | "png",
): Promise<Response> {
  const [clients, key, entitlements] = await Promise.all([
    pgSelect<{ id: string; name: string }>(env, `clients?id=eq.${clientId}&select=id,name`),
    activeAccessKey(env, clientId),
    pgSelect<{ video_id: string; videos: { id: string; title: string; duration_seconds: number } }>(
      env,
      `entitlements?client_id=eq.${clientId}&select=video_id,videos(id,title,duration_seconds)`,
    ),
  ]);
  const client = clients[0];
  if (!client) return new Response(JSON.stringify({ message: "Client not found" }), { status: 404 });
  if (!key) return new Response(JSON.stringify({ message: "No active access key" }), { status: 404 });

  const baseUrl = new URL(request.url).origin;
  const videos: PosterVideo[] = entitlements
    .filter((e) => e.videos)
    .map((e) => ({
      title: e.videos.title,
      durationSeconds: e.videos.duration_seconds,
      url: buildWatchUrl(baseUrl, e.video_id, key, { src: "poster" }),
    }));

  const svg = buildPosterSvg(client.name, videos);
  return format === "svg" ? svgResponse(svg) : pngResponse(svg, 2339); // A3 width at 200dpi
}
