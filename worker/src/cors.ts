// The admin console and client portal are separate origins from the Worker in production
// (admin.prestarter.au / app.prestarter.au vs prestarter.au — spec section 19 resolved to
// separate subdomains), so their fetch() calls to /internal and /portal are genuinely
// cross-origin and need real CORS handling, including preflight OPTIONS requests (triggered
// by the Authorization header and JSON/multipart content types these routes use). Never
// exercised locally, since the Vite dev proxy makes those same-origin there.
const ALLOWED_ORIGINS = [
  "https://admin.prestarter.au",
  "https://app.prestarter.au",
  "http://localhost:3000",
  "http://localhost:3001",
];

// *.pages.dev preview/project URLs change per deployment — allow the two known project
// domains and their preview-hash subdomains too, so testing a fresh deploy doesn't need a
// CORS-config change every time.
const PAGES_DEV_PATTERN = /^https:\/\/([a-z0-9-]+\.)?(prestarter-admin|prestarter-portal)\.pages\.dev$/;

function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin) || PAGES_DEV_PATTERN.test(origin);
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

export function handlePreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function withCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value as string);
  }
  return new Response(response.body, { status: response.status, headers });
}
