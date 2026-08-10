# Design brief: Prestarter poster export

Paste this to a design-focused Claude session, likely alongside the same reference images,
logo files, brand colours, and fonts already used for the rest of the product (see
`docs/design-brief-prompt.md` — the poster was out of scope for that pass and still looks
like the pre-brand version). This is a description of what needs styling, in what technical
form, and what must not change — not a request to write application code.

## What the poster is

A printable A3 sheet, one per client, generated on demand from the admin console (any
Affirmer staff member, for any client) and from the client portal (a client's own contact,
for their own organisation only). It has one QR tile per video the client is currently
licensed for. Someone prints it — often laminates it — and puts it up on-site: a site
fence, a noticeboard, a break room wall. A worker scans the QR code on their phone and lands
straight on that video in the player. Audience and viewing conditions are the same as the
player itself: outdoors, low-end Android phones, glare, sometimes a first language other
than English, from a few feet away rather than close up.

It is emailed/downloaded, not mailed — Affirmer never sees the physical print, so the file
itself has to be complete and correct: right QR codes, legible from typical hang height,
nothing that reads as broken if printed on an office laser printer instead of a proper print
shop.

## Current state (unstyled — predates the brand pass, still stock colours)

Generated entirely in code, no template or design tool involved:

- `worker/src/poster.ts` — builds the poster as a raw SVG string (hand-written XML
  concatenation, not a library, no CSS classes — see "Technical constraints" below).
- `worker/src/render-png.ts` — rasterises that SVG to PNG server-side via `resvg-wasm`, for
  people whose printer only wants a PNG.
- Both SVG and PNG are offered for download.

Right now it uses none of the brand system already applied elsewhere (see `admin/src/index.css`
for the full token set): dark header band `#111827` (should be `--color-surface-inverse`
`#101828`), orange accent rule `#f97316` (not a brand colour at all — brand primary is green
`#1f9d57`), body text in plain grays, "Inter" throughout instead of Poppins, and no logo
anywhere — just the word "Affirmer" in small gray type, top right.

## Fixed content — what must appear, per spec, not up for redesign-by-omission

- **Header band**: poster title ("Workplace Safety Training" currently — confirm wording),
  client name, a "scan to watch" instruction, and the Affirmer mark.
- **QR tile grid**: one tile per licensed video, each showing the QR code, the video's
  title, and its duration. Currently a fixed 3-column grid; more or fewer columns, or a
  different arrangement, is fine if it still reads clearly at A3.
- **Provenance line**: "Licensed to {client name} — not for distribution outside this
  organisation," near the bottom. Small is fine; it must not disappear.
- **No usage figures anywhere** — no play counts, no caps, no percentages, nothing derived
  from usage data. (Same rule as the client portal.)
- Output as both **SVG** (for print shops) and **PNG at 200dpi minimum** (for office
  printers) at **A3 portrait**.

## Hard constraint — QR codes themselves cannot be restyled

Per spec: pure black modules on pure white, four-module quiet zone, no tinting, no rounded
modules, no embedded logo in the code. This is a scan-reliability requirement for laminated
outdoor signage, not an aesthetic choice — a stylised QR code that fails to scan for even a
fraction of workers defeats the entire poster. The white QR tile itself (its background card,
border, corner radius, drop shadow, the space around it) is fully open to redesign; the
modules inside it are not.

## Technical constraints — must survive the redesign unchanged

- **No CSS files, no Tailwind, no external assets loaded at render time.** The SVG is
  generated as a plain string in a Cloudflare Worker (no DOM, no browser) — every colour,
  font-size, and coordinate has to be a literal value baked into the SVG markup itself
  (same approach `worker/src/player.ts` uses for its inline styles). Hand back literal hex
  values and pixel/mm sizes, not CSS custom properties or classNames.
- **Fonts must be embeddable as static font files.** PNG rendering goes through
  `resvg-wasm`, which has no access to system or web fonts — text silently disappears
  unless the exact font file is bundled and passed in as a buffer. Currently only
  Inter-Regular.ttf and Inter-Bold.ttf are bundled (`worker/assets/fonts/`). If the poster
  should use Poppins (matching the rest of the brand), say so explicitly — it'll need
  Poppins TTF/OTF weights added to that bundle (the rest of the app uses woff2, which
  doesn't help here). If a licensing or format reason makes Poppins impractical for this
  one surface, a fallback sans-serif is fine — just say which.
- **QR payload/logic is untouched by this pass.** Each tile encodes
  `https://prestarter.au/w/{video_id}?k={access_key}&src=poster` (plus `&lang=` for a
  language-specific tile) — this is generated by `worker/src/qr.ts`, already spec-verified
  against a second QR implementation, and out of scope here.
- **Must still work as a single fixed page size (A3 portrait, 297×420mm)**, not a
  responsive/reflowing layout — this is print output, not a web page.

## Optional — multilingual variant

Spec allows (not requires) printing one QR per language beneath a video's title when it has
captions in multiple languages, each labelled in its own script (`English`, `中文`, `한국어`),
so a worker scans directly for their language with no in-player menu. Worth a design opinion
on whether/how this nests inside a tile if the client wants it — otherwise treat it as future
scope and ignore.

## What to hand back

Something implementable without further guessing:

1. **Layout**: header band treatment (height, content placement, whether it should look like
   the admin console's own header or be its own thing), QR tile grid (columns, tile size,
   spacing, card/border/shadow treatment around each QR), footer/provenance placement.
2. **Colour palette** for this surface specifically, as hex values — reuse the existing brand
   palette (primary `#1f9d57`, ink `#101828`, etc. — full list in `admin/src/index.css`)
   rather than inventing new ones, unless there's a reason print needs different values than
   screen (e.g. contrast under lamination glare).
3. **Typography**: font file(s) to bundle, and a size scale in literal px (title, client
   name, instruction line, tile title, tile duration, provenance line) that stays legible at
   A3 hang-and-scan distance.
4. **Logo placement**: which lockup (horizontal, stacked, mark-only — see
   `admin/public/brand/`), where, and at what size, replacing the current plain-text
   "Affirmer."
5. Confirm the QR tile's non-module chrome (background, border, radius, shadow) explicitly,
   since that's the one part of the QR tile actually open for restyling.

Reference images, logo files, exact brand colours, and font files will be provided
separately in the conversation this brief is pasted into — the palette/type choices already
locked in for the rest of the product (`admin/src/index.css`, `docs/design-brief-prompt.md`)
should be treated as the default unless there's a print-specific reason to deviate.

## Delivery note for whoever implements this afterward

`worker/src/poster.ts` builds the SVG by string concatenation — swap literal colour/size
values there directly, same pattern as `worker/src/player.ts`. If the font changes from
Inter, add the new font file(s) to `worker/assets/fonts/` and wire them into the
`fontBuffers` array in `worker/src/render-png.ts`, or PNG export will silently render with
missing text (confirmed behaviour — this bit before, per that file's own comment).
