import type { Env } from "./env";

const TOKEN_TTL_SECONDS = 120;

export interface MintedToken {
  token: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

interface StreamTokenResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result?: { token: string };
}

export async function mintPlaybackToken(env: Env, videoUid: string): Promise<MintedToken> {
  const issuedAtMs = Date.now();
  const exp = Math.floor(issuedAtMs / 1000) + TOKEN_TTL_SECONDS;

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream/${videoUid}/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ exp }),
    },
  );

  const body = (await res.json()) as StreamTokenResponse;
  if (!res.ok || !body.success || !body.result) {
    throw new Error(
      `Stream token mint failed: ${res.status} ${JSON.stringify(body.errors ?? body)}`,
    );
  }

  return {
    token: body.result.token,
    issuedAtMs,
    expiresAtMs: exp * 1000,
  };
}
