# Prestarter — client portal

Stage four (spec §11): status banner, video list, link panel (watch/embed/HLS-manifest
formats), poster export, footer note. React + TypeScript + Vite + Tailwind.

## Setup

```
npm install
```

`.env` (gitignored, worktree-included) needs `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` —
same project as `../worker/.dev.vars` and `../admin/.env`.

## Run

```
npm run dev
```

Auth is real Supabase magic-link, gated by `client_contacts` (a row must exist for the
signed-in user, linking to a `client_id` — see `supabase/seed/seed-test-clients.mjs`).

Almost everything the portal reads (status, videos, entitlements, access keys) goes **directly
to Supabase via `@supabase/supabase-js`**, not through the Worker — Row Level Security is the
actual enforcement layer (see `supabase/migrations/0002_rls.sql`, `0006_hide_unreviewed_captions.sql`),
not something the frontend has to get right. The Worker is only involved for:

- QR/poster PNG rendering (`/portal/...` — needs `resvg-wasm`, can't happen in the browser).
- The "HLS manifest" link format (`/m/:videoId` — a stable redirect that mints a fresh
  120s-lived Stream token on every hit, so the copied link never goes stale even though the
  token behind it does).

Local dev proxies `/portal`, `/m`, and `/w` to `wrangler dev` on `127.0.0.1:8787` — start that
first. Same port-3000 magic-link redirect caveat as `../admin/README.md` (this app runs on
3001; the redirect_to is pinned to whatever the Supabase project's Site URL is regardless of
what port asked for it, so testing without a real inbox means manually building the
`#access_token=...` fragment against this app's own URL rather than following the redirect).

## Deploying

```
npm run build
wrangler pages deploy dist --project-name=prestarter-portal --branch=main
```

Production build needs `.env.production` (gitignored, worktree-included):
`VITE_WORKER_ORIGIN=https://prestarter.au`.

## Real bugs found while building this (not after)

- `player.ts` and the Worker's manifest-URL construction were both missing the `customer-`
  prefix Cloudflare Stream requires (`customer-<code>.cloudflarestream.com`, not just
  `<code>.cloudflarestream.com`) — returned 200 from the token endpoint (minting works fine)
  while the manifest itself 404'd. Undetected all session because AT1/AT2 always built URLs
  directly with the correct prefix, never through this code path. Fixed in both places; added
  a stage-two test that mints via the real endpoint and fetches the resulting manifest, so this
  class of bug can't hide again.
- The link-panel's watch/embed/manifest URLs (`VideoRow.tsx`) were built from
  `window.location.origin` — fine locally (proxied to the same place), wrong in production
  (would generate links pointing at `app.prestarter.au/w/...`, which doesn't exist there,
  instead of `prestarter.au/w/...`). Same root cause and same fix (`VITE_WORKER_ORIGIN`) as the
  admin console's `/internal` bug — see `../admin/README.md`. Caught before telling anyone this
  was done, not after.
- Clipboard write is denied in some environments even on a real user click (confirmed, not
  hypothetical) — `copyLink` now falls back to selecting the link text so the user can still
  copy it manually, instead of silently doing nothing.
- `window.open()` after an `await` gets popup-blocked (same fix as the admin console) —
  `openAsset` in `src/lib/api.ts` opens the tab synchronously first.

## Known gap

Renewal-approaching threshold (60 days) is spec's own recommended default for the still-open
section 3.1B question — adopted directly since spec already recommends it, not invented here.
