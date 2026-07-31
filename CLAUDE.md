# CLAUDE.md — Prestarter

Project context for Claude Code. Read this before making changes.

## What this is

Prestarter is a subscription platform that licenses Affirmer's 3D animated safety training videos to enterprise
clients. Clients copy embed links or download QR codes and place them in their own systems. No LMS,
no quizzing, no per-worker accounts.

Hosted at `prestarter.au`. Full specification: `docs/spec.md`. Decision history: `docs/decisions.md`.

## Working agreement

- **The spec is binding.** Decisions in `docs/spec.md` section 3 are settled. If one looks wrong,
  say so in your response — do not implement a different one.
- **Items marked ⚠ NEEDS RESOLUTION are open.** Ask rather than choosing.
- Propose a plan before writing code for anything beyond a single file.
- Write the relevant acceptance test from spec section 18 before the implementation.
- Small commits, one logical change each.

## Two rules that must never be broken

1. **No monetary values anywhere.** No prices, amounts, rates, currency fields or totals. Billing is
   a paid / due / overdue state only. A monetary column or input is a defect.
2. **Clients never see usage figures.** No play counts, caps, percentages, entitlement counts or
   remaining allowance — not in the UI, not in an API response, not in page source. All usage data
   is administrator-only, enforced at the database layer, not just hidden in the interface.

## Stack

- React, TypeScript, Vite, Tailwind on Cloudflare Pages
- Supabase (PostgreSQL) in the Sydney region, Supabase Auth with email magic link
- Cloudflare Stream for video, signed URLs required on every video
- Cloudflare Worker for token minting and enforcement
- Resend for transactional email

## Security invariants

- Clients never receive a Cloudflare Stream URL. Only links to the player domain carrying their
  access key.
- Playback tokens live 120 seconds and are signed server-side only.
- Key rotation is the only revocation mechanism. If entitlements are cached in KV, the cache must be
  purged on key rotation, entitlement change and billing state change.
- Row-level security scopes all client queries to their own organisation, and excludes `play_events`
  and `usage_daily` entirely.
- MP4 download is disabled at the Cloudflare account and video level, and exposed nowhere.
- On any validation failure, deny playback. Never fall back to an unsigned URL.

## Fixed design elements

- Watermark: top left of the frame, client name and playback time, white with a dark outline at 30%
  opacity, rendered as a DOM element above the video. Never encoded into the file. Clock derives
  from token issue time, not the device clock. Not configurable.
- Captions sit at the bottom of the frame. The watermark must not overlap them.
- QR codes: pure black on pure white, four-module quiet zone. No tinting, rounding or logos.
- `videos.id` is opaque and permanent — printed QR codes encode it. `display_code` may change.

## Conventions

- Australian English in all user-facing copy: "licence" as a noun, "organisation", "customised".
- Dates displayed as `31 Jul 2026`.
- Monospace for machine-generated values: video IDs, access keys, URLs.
- No `localStorage` or `sessionStorage` in artifacts-derived code.

## Definition of done

The relevant acceptance tests in `docs/spec.md` section 18 pass, including the negative cases.
"It works in the UI" is not done — cross-organisation access must be tested at the API level.
