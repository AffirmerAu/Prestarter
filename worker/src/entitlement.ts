import type { Env } from "./env";
import { pgSelect, pgInsert, pgUpsert } from "./supabase";

export type EntitlementResult =
  | { ok: true; clientId: string; markAs: string; streamUid: string }
  | { ok: false };

interface AccessKeyRow {
  client_id: string;
  revoked_at: string | null;
}
interface ClientRow {
  id: string;
  mark_as: string;
  status: string;
  term_start: string;
  term_end: string;
  billing_state: string;
  paid_to: string;
  grace_days: number;
  daily_cap_advisory: number;
}
interface VideoRow {
  id: string;
  stream_uid: string;
  status: string;
}
interface EntitlementRow {
  effective_from: string;
  effective_to: string | null;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function hashAddress(env: Env, ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(env.ADDRESS_HASH_PEPPER + ip);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Spec section 6 step 3: key exists & not revoked; client active; within term; not past
// paid_to + grace_days; entitlement exists for this client + video. Queried live on every
// request — no KV cache (see worker/README.md) — so revocation/pause/billing changes take
// effect on the very next request, not "eventually".
export async function checkEntitlement(
  env: Env,
  videoId: string,
  accessKey: string,
): Promise<EntitlementResult> {
  const keys = await pgSelect<AccessKeyRow>(
    env,
    `access_keys?key=eq.${encodeURIComponent(accessKey)}&revoked_at=is.null&select=client_id,revoked_at`,
  );
  const activeKey = keys[0];
  if (!activeKey) return { ok: false };
  const clientId = activeKey.client_id;

  const clients = await pgSelect<ClientRow>(env, `clients?id=eq.${clientId}&select=*`);
  const client = clients[0];
  if (!client) return { ok: false };

  const today = todayISO();
  if (client.status !== "active") return { ok: false };
  if (today < client.term_start || today > client.term_end) return { ok: false };
  // Belt and suspenders: honour an explicit admin overdue mark immediately, AND the
  // date-driven cutoff even if the nightly transition (task 18) hasn't run yet today.
  if (client.billing_state === "overdue") return { ok: false };
  if (today > addDays(client.paid_to, client.grace_days)) return { ok: false };

  const videos = await pgSelect<VideoRow>(env, `videos?id=eq.${videoId}&select=id,stream_uid,status`);
  const video = videos[0];
  if (!video) return { ok: false };
  // Belt and suspenders: archiving a video (videos-admin.ts's archiveVideo) already revokes
  // every active entitlement for it, but check status here too in case one is ever somehow
  // left open.
  if (video.status === "archived") return { ok: false };

  const entitlements = await pgSelect<EntitlementRow>(
    env,
    `entitlements?client_id=eq.${clientId}&video_id=eq.${videoId}&select=effective_from,effective_to`,
  );
  const entitlement = entitlements.find(
    (e) => e.effective_from <= today && (e.effective_to === null || e.effective_to >= today),
  );
  if (!entitlement) return { ok: false };

  return { ok: true, clientId, markAs: client.mark_as, streamUid: video.stream_uid };
}

export async function recordPlay(
  env: Env,
  request: Request,
  clientId: string,
  videoId: string,
  // 'preview' is the admin console's review player (spec section 9) — it goes through the
  // real entitlement/token flow so the watermark and captions match exactly what a client
  // would see, but must never count toward that client's usage or trip their advisory cap
  // just because Affirmer staff did QA.
  opts: { source: "embed" | "watch" | "poster" | "preview"; languageTag: string | null },
): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const addressHash = await hashAddress(env, ip);
  const country = (request as unknown as { cf?: { country?: string } }).cf?.country ?? null;
  const referrerHost = (() => {
    const ref = request.headers.get("referer");
    if (!ref) return null;
    try {
      return new URL(ref).host;
    } catch {
      return null;
    }
  })();

  await pgInsert(env, "play_events", {
    client_id: clientId,
    video_id: videoId,
    address_hash: addressHash,
    country,
    referrer_host: referrerHost,
    source: opts.source,
    language_tag: opts.languageTag,
    user_agent_class: classifyUserAgent(request.headers.get("user-agent")),
  });

  if (opts.source !== "preview") {
    await recomputeUsageDailyAndCheckCap(env, clientId, videoId);
  }
}

function classifyUserAgent(ua: string | null): string {
  if (!ua) return "unknown";
  if (/mobile/i.test(ua)) return "mobile";
  if (/tablet|ipad/i.test(ua)) return "tablet";
  return "desktop";
}

async function recomputeUsageDailyAndCheckCap(env: Env, clientId: string, videoId: string): Promise<void> {
  const today = todayISO();
  const startOfDay = `${today}T00:00:00Z`;
  const events = await pgSelect<{ address_hash: string; country: string | null }>(
    env,
    `play_events?client_id=eq.${clientId}&video_id=eq.${videoId}&occurred_at=gte.${startOfDay}&select=address_hash,country`,
  );
  const plays = events.length;
  const distinctAddresses = new Set(events.map((e) => e.address_hash)).size;
  const countries = new Set(events.map((e) => e.country).filter(Boolean)).size;

  await pgUpsert(
    env,
    "usage_daily",
    { client_id: clientId, video_id: videoId, day: today, plays, distinct_addresses: distinctAddresses, countries },
    "client_id,video_id,day",
  );

  const clients = await pgSelect<{ daily_cap_advisory: number }>(env, `clients?id=eq.${clientId}&select=daily_cap_advisory`);
  const cap = clients[0]?.daily_cap_advisory ?? Infinity;
  if (plays > cap) {
    const existing = await pgSelect(
      env,
      `alerts?client_id=eq.${clientId}&type=eq.advisory_cap_exceeded&raised_at=gte.${startOfDay}&select=id`,
    );
    if (existing.length === 0) {
      await pgInsert(env, "alerts", {
        client_id: clientId,
        video_id: videoId,
        type: "advisory_cap_exceeded",
        severity: "critical",
        evidence: { plays, daily_cap_advisory: cap, day: today },
      });
    }
  }
}

