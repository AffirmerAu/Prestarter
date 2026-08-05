# Prestarter — admin console

Stage three (spec §9): Dashboard, Clients (contacts/billing/keys/entitlements/QR/poster), Video
library (review player + captions). React + TypeScript + Vite + Tailwind, calling the Worker's
`/internal/*` API (see `../worker/README.md`).

## Setup

```
npm install
```

`.env` (gitignored, worktree-included) needs:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Same project as `../worker/.dev.vars` — the anon key is meant to be public client-side, RLS is
what actually protects data (see `supabase/migrations/0002_rls.sql`).

## Run

```
npm run dev
```

Auth is real Supabase magic-link, gated by the `admins` table (a row must exist for the
signed-in user — see `supabase/seed/seed-admins.mjs`). Local dev proxies `/internal/*` and `/w/*`
to a `wrangler dev` running on `127.0.0.1:8787` (`vite.config.ts`) — start that first.

Supabase's magic-link redirect is pinned to whatever `Site URL`/redirect allow-list the project
has configured (defaults to `localhost:3000` if nothing's been set) — run this on port 3000
locally, or update the project's auth redirect settings if you need a different port.

## Deploying

```
npm run build
wrangler pages deploy dist --project-name=prestarter-admin --branch=main
```

Production build needs `.env.production` (gitignored, worktree-included):

```
VITE_WORKER_ORIGIN=https://prestarter.au
```

**Real bug caught deploying this, not before:** `src/lib/api.ts` had `BASE = ""` (relative
paths) with a comment claiming "same-origin in production" — that assumption was never actually
true once admin and Worker ended up on separate subdomains (`admin.prestarter.au` vs
`prestarter.au`). The deployed site's `/internal/dashboard` fetch returned **200 with Cloudflare
Pages' own SPA-fallback `index.html`** instead of the Worker's response — wrong content behind a
success status code, exactly the kind of failure that looks fine at a glance. `VITE_WORKER_ORIGIN`
fixes the URL; the Worker also needed real CORS handling (`worker/src/cors.ts`) since this became
a genuine cross-origin request, never exercised locally where the Vite proxy made it same-origin.
Confirmed the actual fix via `performance.getEntriesByType('resource')` in a real browser
session, not just a 200 status.

## Known gaps

- The review player's iframe and the QR/poster export buttons need `assetUrl`'s fetch-with-auth
  pattern (see `src/lib/api.ts`) rather than plain links, since `/internal/*` requires a bearer
  token a plain `<a href>` can't carry. `window.open()` for exports must happen *before* the
  `await` in the click handler — doing it after breaks the browser's user-gesture chain and gets
  silently popup-blocked (hit this empirically; fixed in `ClientDetail.tsx`).
- "Busiest links today" (dashboard, spec section 9) isn't implemented — `play_events` tracks
  `client_id`, not which specific access key/link was used, so per-link breakdown isn't modelled.
- No caption menu in the real player itself yet (authoring — upload/review — is done).
