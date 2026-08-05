# Prestarter — Worker

Covers spec section 17 stages one through four's backend: token minting and player (stage one),
Supabase-backed entitlement/billing enforcement (stage two), the admin API (auth,
clients/videos/alerts reads, billing/key admin actions, captions, QR/poster export — stage
three), and the client-portal-only routes (stage four: portal-scoped QR/poster export, the
"HLS manifest" link redirect). Frontends live in `../admin/` and `../portal/`.

**Deployed:** `prestarter.au` (this Worker — player, API, admin/portal backend routes).
`admin.prestarter.au` and `app.prestarter.au` are separate Cloudflare Pages projects
(`prestarter-admin`, `prestarter-portal`) — see their own READMEs. Custom domain SSL on those
two takes a while to provision after first setup; the `*.pages.dev` project domains work
immediately in the meantime.

## Deploying

```
wrangler secret put CF_ACCOUNT_ID           # and CF_STREAM_API_TOKEN, SUPABASE_SERVICE_ROLE_KEY, ADDRESS_HASH_PEPPER
wrangler deploy
```

Needs `CLOUDFLARE_API_TOKEN` set (see `.cloudflare-deploy-token` at the repo root — gitignored,
filled in directly, not committed). The token needs **Account Resources** scoped to the actual
account (not left blank/default) and **Zone Resources** scoped to the `prestarter.au` zone —
both silently produce a generic "Authentication error" if misconfigured, with no hint about
which scope is the problem. `wrangler.toml`'s `routes` binds `prestarter.au/*` to this Worker;
that requires *some* DNS record to exist at the bare apex for Cloudflare to have anything to
intercept in the first place — a proxied placeholder `A` record (`192.0.2.1`, a reserved
non-routable address) is enough, since real traffic never actually reaches it.

## Setup

```
npm install
```

Required secrets (never committed — set with `wrangler secret put NAME`, or in `worker/.dev.vars`
for local dev, which is gitignored and worktree-included):

- `CF_ACCOUNT_ID`, `CF_STREAM_API_TOKEN` — Cloudflare Stream, token scoped to **Stream:Edit only**.
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS by design; server-side only, never sent to a client.
- `ADDRESS_HASH_PEPPER` — salts the IP-address hash in `play_events` (spec section 15).

Required non-secret config (`wrangler.toml` `[vars]` or `.dev.vars`):

- `STREAM_CUSTOMER_CODE` — the `customer-<code>` subdomain segment for Stream delivery.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — project URL and anon key (used to validate a caller's
  session against Supabase Auth, not to bypass RLS).

Database: see `supabase/migrations/` (schema + RLS + admins table) and `supabase/seed/` (test
orgs and a test admin — real admin sign-in is magic-link only, no password).

## Run

```
npm run dev              # wrangler dev
npm run dev -- --test-scheduled   # also enables /__scheduled for testing the nightly cron locally
npm run deploy
```

- Player: `/w/<videoId>?k=<accessKey>&lang=<bcp47>`. Token endpoint:
  `/api/token?videoId=<videoId>&k=<accessKey>&lang=&src=`.
- Admin API: `/internal/...`, bearer-token gated on a real Supabase session belonging to a row in
  the `admins` table (see `src/admin-auth.ts`). Reads: `/internal/clients`, `/internal/clients/:id`,
  `/internal/videos`, `/internal/videos/:id`, `/internal/alerts`, `/internal/dashboard`. Actions:
  `POST /internal/clients/:id/mark-paid`, `/pause`, `/restore`, `/internal/access-keys/:id/rotate`,
  `/internal/alerts/:id/acknowledge`. Captions: `POST /internal/videos/:videoId/captions`
  (multipart: `file`, `language_tag`, `label_native`, `is_default`), lands unreviewed by
  default; `POST /internal/video-languages/:id/mark-reviewed`. Export:
  `/internal/clients/:id/videos/:videoId/qr.{svg,png}`, `/internal/clients/:id/poster.{svg,png}`.
- Portal API: `/portal/...`, bearer-token gated on a real Supabase session belonging to a row in
  `client_contacts` (see `src/client-auth.ts`) — `clientId` always comes from that session, never
  a URL param, so a client can never reach another client's export. `/portal/videos/:videoId/qr.{svg,png}`,
  `/portal/poster.{svg,png}`. Everything else the portal needs is read directly from Supabase via
  RLS, not through this API — see `../portal/README.md`.
- Manifest link (public, key-gated like `/w/` and `/api/token`): `/m/:videoId?k=<accessKey>&lang=`
  — the client portal's "HLS manifest" link format. A static, copyable URL that 307-redirects to
  a freshly-minted signed Stream manifest URL on every hit, so the link stays valid past any
  single token's 120s expiry.

## What's deliberately not here yet

- A caption menu in the player itself (spec section 8) — authoring (upload/review) is done;
  `?lang=` preselection already works, but there's no in-player language switcher yet.
- KV caching for entitlement lookups — deliberately skipped for now (see spec section 6's own
  caveats about stale-cache revocation risk); revisit only if token-issue latency needs it.
- "Busiest links today" on the admin dashboard — `play_events` tracks `client_id`, not which
  specific access key/link was used.

## PNG rendering (QR codes, posters)

`@resvg/resvg-wasm` renders SVG to PNG inside the Worker — but it has **no system font access**
in that runtime. Every `<text>` element silently fails to render without an explicit font buffer
(confirmed empirically: backgrounds/QR modules rendered fine, all text was invisible until fonts
were wired up). `assets/fonts/` bundles Inter (SIL OFL, embeddable) for this reason — see
`src/render-png.ts`. If you add new text-bearing SVG output, it needs `font-family="Inter"` to
actually show up in the PNG.

## Tests

`tests/acceptance/` — acceptance tests from spec section 18, plus AT24 (new, not in the original
23) covering fullscreen watermark survival. Notable ones:

- `at1-raw-url-refused.sh`, `at2-expired-token-refused.sh` — need a live Cloudflare Stream account;
  they test Cloudflare's own edge enforcement, not code that can be meaningfully mocked.
- `at7-cross-org-rls.mjs` — cross-organisation RLS isolation, tested at the API level with two real
  seeded orgs and real Supabase Auth sessions.
- `at-stage2-enforcement.mjs` — AT3–13, AT17: entitlement/billing enforcement chain, run against a
  local `wrangler dev`.
- `at-billing-cron.sh` — the nightly transition sweep, via `/__scheduled`.
- `at18-19-qr-poster.mjs` — QR/poster export, decoded with `jsQR` (a genuinely independent
  implementation from the `qrcode` encoder — satisfies spec section 12's "verified against a
  second implementation" before the first real poster is printed). Doesn't replace an actual
  print-and-scan pass with a phone before anything goes on a wall.
- `at-captions.mjs` — upload/review flow, including that unreviewed captions are genuinely
  invisible to an entitled client via RLS (not just hidden in the portal UI), verified with a
  real client sign-in.
- `at-portal-routes.mjs` — portal-scoped QR/poster/manifest-link routes.
- `at15-portal-no-usage-figures.mjs` — every network response the portal actually makes,
  checked for forbidden keys (play counts, caps, percentages, allowances).
- The stage-two suite's baseline check doesn't just assert the token endpoint returns 200 — it
  builds the manifest URL the same way `player.ts` does and actually fetches it. This is what
  caught a real bug (both `player.ts` and the manifest-link route were missing Cloudflare's
  required `customer-` hostname prefix, so token minting returned 200 while the manifest itself
  404'd) that AT1/AT2 couldn't have caught, since those scripts always built URLs directly with
  the correct prefix rather than exercising this code path.

All of the `.mjs`/`.sh` scripts need `supabase/seed/seed-test-clients.mjs` and
`supabase/seed/seed-admins.mjs` run first, and (except the Stream-only AT1/AT2) a local
`wrangler dev` running.
