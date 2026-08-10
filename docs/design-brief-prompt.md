# Design brief: Prestarter visual identity

Paste this to a design-focused Claude session along with reference images, logo files, brand
colours, and fonts. It's a description of what needs styling, in what technical form, and
what must not change — not a request to write application code.

## What Prestarter is

Affirmer's subscription video-licensing platform for workplace safety training. Clients
scan a QR code (often on a poster, on-site, on a mobile phone, often outdoors, often not by a
first-language English speaker) and land on a video player. Separately, Affirmer's own staff
manage clients/videos/captions/billing through an admin console, and clients themselves check
their licence status and grab links/QR codes through a lightweight portal.

## The three surfaces (currently unstyled — Tailwind defaults, system fonts, no brand identity)

1. **Admin console** — `admin.prestarter.au`. React + TypeScript + Vite + Tailwind CSS v4
   (currently just `@import "tailwindcss";`, no theme customisation at all — every colour is
   a stock Tailwind gray/green/amber/red). Internal tool for Affirmer staff.
   Pages: `Login`, `Layout` (nav shell), `Dashboard`, `Clients` (list), `CreateClient`,
   `ClientDetail` (contacts, billing, access keys, entitlements), `Videos` (list),
   `VideoDetail` (review player, caption management).

2. **Client portal** — `app.prestarter.au`. React + TypeScript + Vite + Tailwind CSS v4,
   same unstyled state. What the licensed client's own staff see.
   Pages: `Login`, `Portal` (status banner + video list), `VideoRow` (per-video link/QR/embed
   panel with an inline player).

3. **Video player** — `prestarter.au/w/:videoId`. **Not** a React app — a single
   server-rendered HTML page (`worker/src/player.ts`) with hand-written inline CSS, no
   framework, no build step. This is what actually plays on a phone after a QR scan.
   Elements: video frame, top-left watermark (client name + timestamp), a centred play
   button, a full-frame pre-play "language gate" (header, language grid, skip footer), and a
   small "returning viewer" chip.

These should read as one product family, but the admin console can be more utilitarian/dense
(it's an internal tool) while the portal and player are what a client actually sees and should
carry the brand more visibly. Say if you'd rather they match exactly.

## Constraints — must survive the redesign unchanged

- **Watermark is fixed by spec, not up for restyling beyond colour/font substitution if the
  brand calls for it.** Top-left, ~16px inset, two lines (client name + playback clock),
  white text with a dark outline (no background strip), ~13px monospace, 30% opacity, never
  overlapping the caption region or controls. This exists for anti-piracy traceability — don't
  suggest removing or backgrounding it.
- **The player's pre-play gate has real accessibility work already done that a restyle must
  preserve**: every tap target ≥44px, 4.5:1 text contrast against the scrim, `role="dialog"` +
  focus trap + keyboard nav, `prefers-reduced-motion` respected. New colours/spacing are fine;
  shrinking tap targets or breaking contrast isn't.
- **No `backdrop-filter` or heavy blur/gradient effects on the player.** Its audience is
  disproportionately on low-end Android outdoors — this was a deliberate performance call, not
  an oversight.
- **The player never uses `position: fixed` and must stay within its own box** — it's
  sometimes embedded in a client's own page via `<iframe>`, so it can't assume it owns the
  viewport.
- Don't touch licensing, auth, entitlement, or billing logic — this is a visual pass only.
- Ideally no new runtime dependencies (icon libraries, CSS frameworks, animation libraries)
  without flagging first — Tailwind v4 utility classes plus plain CSS should cover most of
  this.

## What to hand back

Something implementable without further guessing, specifically:

1. **Colour palette**, as a table: role → hex (e.g. primary, primary-hover, on-primary-text,
   surface, surface-alt, border, text-primary, text-muted, success/warning/danger for the
   existing status badges — active/paused, paid/due/overdue).
2. **Typography**: font family (+ where to load it from — Google Fonts link, self-hosted
   file, or a system-font fallback stack if the brand font isn't licensed for web embedding),
   and a size/weight scale (headings, body, small/label text).
3. **Logo usage**: which mark/lockup goes where (admin nav header vs. portal header — the
   player itself has no header chrome to put a logo in, just the watermark).
4. **Spacing/radius/shadow conventions** if they differ from Tailwind's defaults (e.g. a
   specific border-radius for cards/buttons/inputs, a specific shadow style).
5. **Component treatment** for the pieces that repeat across the app: primary/secondary
   buttons (default/hover/disabled), the status/billing badges, table rows, form inputs,
   cards, and the player's gate cells (default / suggested-language / focus states).

Reference images, logo files, exact brand colours, and font names/files will be provided
separately in the conversation this brief is pasted into.

## Delivery note for whoever implements this afterward

Admin and portal: translate the palette into a Tailwind v4 `@theme` block in each app's
`index.css` (replacing the current bare `@import "tailwindcss";`), then swap component
classNames from stock grays to the new tokens.

Player: `worker/src/player.ts` has no build step or Tailwind access — colours need to land as
literal hex values (or CSS custom properties) in its inline `<style>` block directly.
