import type { Env } from "./env";
import { pgSelect } from "./supabase";
import { handleQrExport, handlePosterExport } from "./admin-export";
import { getUnsyncedStreamCaptions, handleDownloadCaptionVtt } from "./captions";
import { listUnregisteredStreamVideos } from "./videos-admin";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function handleAdminReads(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.pathname === "/internal/clients") return listClients(env);

  const clientDetail = url.pathname.match(/^\/internal\/clients\/([^/]+)$/);
  if (clientDetail?.[1]) return clientDetailHandler(env, clientDetail[1]);

  if (url.pathname === "/internal/videos") return listVideos(env);

  const videoDetail = url.pathname.match(/^\/internal\/videos\/([^/]+)$/);
  if (videoDetail?.[1]) return videoDetailHandler(env, videoDetail[1]);

  const captionVtt = url.pathname.match(/^\/internal\/video-languages\/([^/]+)\/vtt$/);
  if (captionVtt?.[1]) return handleDownloadCaptionVtt(env, captionVtt[1]);

  if (url.pathname === "/internal/alerts") return listAlerts(env);
  if (url.pathname === "/internal/dashboard") return dashboard(env);

  const qr = url.pathname.match(/^\/internal\/clients\/([^/]+)\/videos\/([^/]+)\/qr\.(svg|png)$/);
  if (qr?.[1] && qr[2] && qr[3]) return handleQrExport(request, url, env, qr[1], qr[2], qr[3] as "svg" | "png");

  const poster = url.pathname.match(/^\/internal\/clients\/([^/]+)\/poster\.(svg|png)$/);
  if (poster?.[1] && poster[2]) return handlePosterExport(request, env, poster[1], poster[2] as "svg" | "png");

  return new Response("Not found", { status: 404 });
}

interface ClientRow {
  id: string;
  name: string;
  status: string;
  term_end: string;
  billing_state: string;
  daily_cap_advisory: number;
}

async function listClients(env: Env): Promise<Response> {
  const clients = await pgSelect<ClientRow>(env, "clients?select=id,name,status,term_end,billing_state,daily_cap_advisory&order=name.asc");
  const today = todayISO();

  const rows = await Promise.all(
    clients.map(async (c) => {
      const usage = await pgSelect<{ plays: number }>(
        env,
        `usage_daily?client_id=eq.${c.id}&day=eq.${today}&select=plays`,
      );
      const playsToday = usage.reduce((sum, u) => sum + u.plays, 0);
      const alerts = await pgSelect<{ id: string }>(
        env,
        `alerts?client_id=eq.${c.id}&acknowledged_at=is.null&select=id`,
      );
      return { ...c, plays_today: playsToday, open_alert_count: alerts.length };
    }),
  );

  return json(rows);
}

async function clientDetailHandler(env: Env, clientId: string): Promise<Response> {
  const clients = await pgSelect<Record<string, unknown>>(env, `clients?id=eq.${clientId}&select=*`);
  const client = clients[0];
  if (!client) return json({ message: "Not found" }, 404);

  const [contacts, keys, entitlements, billingEvents] = await Promise.all([
    pgSelect(env, `client_contacts?client_id=eq.${clientId}&select=id,email,name,role,invited_at,last_seen_at`),
    pgSelect(env, `access_keys?client_id=eq.${clientId}&select=id,key,issued_at,revoked_at&order=issued_at.desc`),
    pgSelect(
      env,
      `entitlements?client_id=eq.${clientId}&select=id,video_id,effective_from,effective_to,videos(id,title,display_code)`,
    ),
    pgSelect(env, `billing_events?client_id=eq.${clientId}&select=*&order=occurred_at.desc&limit=20`),
  ]);

  return json({ client, contacts, keys, entitlements, billingEvents });
}

async function listVideos(env: Env): Promise<Response> {
  const [videos, unregisteredStreamVideos] = await Promise.all([
    pgSelect(env, "videos?select=id,display_code,title,duration_seconds,category,status,stream_uid&order=title.asc"),
    // Videos that exist on Cloudflare Stream but have no videos row yet — same "uploaded
    // outside this console" situation captions can end up in. Defensive catch: a Stream API
    // hiccup here shouldn't take down the whole video library list.
    listUnregisteredStreamVideos(env).catch(() => []),
  ]);
  return json({ videos, unregisteredStreamVideos });
}

async function videoDetailHandler(env: Env, videoId: string): Promise<Response> {
  const videos = await pgSelect<{ id: string; stream_uid: string; [key: string]: unknown }>(
    env,
    `videos?id=eq.${videoId}&select=*`,
  );
  const video = videos[0];
  if (!video) return json({ message: "Not found" }, 404);

  const [languages, entitledClients, unsyncedStreamCaptions] = await Promise.all([
    pgSelect(env, `video_languages?video_id=eq.${videoId}&select=*`),
    pgSelect(env, `entitlements?video_id=eq.${videoId}&select=client_id,clients(id,name)`),
    // Captions that exist on Cloudflare Stream (e.g. uploaded via Stream's own dashboard)
    // but have no video_languages row yet — offered in the admin UI to register (still
    // requiring an explicit mark-reviewed step before reaching a client, spec section 8).
    getUnsyncedStreamCaptions(env, videoId, video.stream_uid).catch(() => []),
  ]);

  return json({ video, languages, entitledClients, unsyncedStreamCaptions });
}

async function listAlerts(env: Env): Promise<Response> {
  const alerts = await pgSelect(
    env,
    "alerts?acknowledged_at=is.null&select=*,clients(id,name)&order=severity.desc,raised_at.desc",
  );
  return json(alerts);
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function dashboard(env: Env): Promise<Response> {
  const today = todayISO();
  const sevenDaysAgo = daysAgoISO(6);
  const [clients, videos, openAlerts, overdueClients, todayUsage, weekUsage] = await Promise.all([
    pgSelect<{ id: string; status: string }>(env, "clients?select=id,status"),
    pgSelect<{ id: string; status: string }>(env, "videos?select=id,status"),
    pgSelect<{ id: string; severity: string }>(env, "alerts?acknowledged_at=is.null&select=id,severity"),
    pgSelect<{ id: string; name: string; paid_to: string }>(env, "clients?billing_state=eq.overdue&select=id,name,paid_to"),
    pgSelect<{ plays: number }>(env, `usage_daily?day=eq.${today}&select=plays`),
    pgSelect<{ day: string; plays: number }>(env, `usage_daily?day=gte.${sevenDaysAgo}&select=day,plays`),
  ]);

  const playsByDay: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) playsByDay[daysAgoISO(i)] = 0;
  for (const row of weekUsage) playsByDay[row.day] = (playsByDay[row.day] ?? 0) + row.plays;

  return json({
    playsToday: todayUsage.reduce((sum, u) => sum + u.plays, 0),
    activeClients: clients.filter((c) => c.status === "active").length,
    videosReleased: videos.filter((v) => v.status === "released").length,
    openAlerts: openAlerts.length,
    accountsOverdue: overdueClients,
    // "Busiest links today" (spec section 9) isn't included — play_events tracks client_id,
    // not which specific access key/link was used, so per-link breakdown isn't modelled yet.
    playsByDay: Object.entries(playsByDay).map(([day, plays]) => ({ day, plays })),
  });
}
