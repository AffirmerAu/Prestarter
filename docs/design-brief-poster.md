# Prestarter — A3 QR poster, visual spec

Visual pass on `worker/src/poster.ts` and `worker/src/render-png.ts`.
QR payload/logic (`worker/src/qr.ts`) is out of scope. No usage figures anywhere on the sheet.
Australian English in all copy.

Everything below is a literal value. There are no CSS custom properties, no classes and no
external assets — same string-concatenation approach as `worker/src/player.ts`.

---

## 0. Canvas and coordinate space

```
<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="420mm"
     viewBox="0 0 1122 1587">
```

A3 portrait. Every number in this spec is in that 1122 × 1587 space, where **1 unit =
0.2646 mm**. Fixed page — no reflow.

**PNG export:** 200 dpi minimum = **2339 × 3307 px** (scale 2.0846). Render at 300 dpi
(**3508 × 4961**) if the Worker CPU budget allows; print shops take the SVG.

---

## 1. Colour — literal hex

Reused from the product palette. Two print-specific deviations, both flagged.

| Where | Hex | Note |
|---|---|---|
| Page background | `#FFFFFF` | Not `#F9FAFB` — white saves toner and lifts QR contrast |
| Header band | `#FFFFFF` | Was `#111827`. Light band so the supplied Affirmer lockup drops in untouched |
| Accent rule under band | `#1F9D57` | **Replaces `#f97316`** — orange is not a brand colour |
| Header title | `#101828` | |
| Client name in header | `#475467` | Subordinate to the title, 7.5:1 |
| "Scan a code to watch" pill | fill `#1F9D57`, text `#FFFFFF` | 6.0:1 |
| Affirmer lockup | `#3385D9` | Supplied artwork, unmodified |
| Tile background | `#FFFFFF` | |
| Tile border | `#1F9D57` | 1.5 units. Green ties each tile to the brand and holds a visible edge on a white sheet |
| Tile title | `#101828` | |
| Tile duration | `#475467` | |
| Footer divider | `#E4E7EC` | |
| Provenance line | `#667085` | |
| `prestarter.au` | `#101828` | |
| QR modules | `#000000` on `#FFFFFF` | **Fixed by spec — do not tint** |

No shadows anywhere on the sheet. Borders carry the structure; drop shadows print muddy.

---

## 2. Typography

**Poppins.** Bundle as static TTF in `worker/assets/fonts/` and add to the `fontBuffers`
array in `render-png.ts` — otherwise PNG text renders empty, per that file's own comment.
The app's woff2 files are no use to resvg.

| File to add | Used by |
|---|---|
| `Poppins-Regular.ttf` | duration, language line, provenance |
| `Poppins-SemiBold.ttf` | client name, tile title, `prestarter.au`, pill |
| `Poppins-Bold.ttf` | poster title, wordmark |

Poppins is OFL-1.1, so bundling is fine. `font-family="Poppins"` must match the family name
inside the TTF exactly; resvg does no fuzzy matching and no fallback.

`Inter-Regular.ttf` / `Inter-Bold.ttf` can be dropped once nothing references them.

### Size scale (literal, in the 1122-wide space)

| Element | size / weight | line-height | Printed cap height |
|---|---|---|---|
| Wordmark "Prestarter" | 38 / 700, tracking -0.025em | 1 | 10.1 mm |
| "Affirmer" (endorsement) | 24 / 600 | 1 | 6.3 mm |
| Poster title | 56 / 700, tracking -0.03em | 1.1 | 14.8 mm |
| Client name (header) | 34 / 600, tracking -0.015em | 1.2 | 9.0 mm |
| "Scan a code to watch" | 25 / 600 | 1 | 6.6 mm |
| Tile title | 22 / 600 | 1.25 | 5.8 mm |
| Tile meta (duration + languages) | 17 / 400 | 1.4 | 4.5 mm |
| Provenance line | 17 / 400 | 1.4 | 4.5 mm |
| `prestarter.au` | 19 / 600 | 1.4 | 5.0 mm |

Nothing on the sheet is below 17 units (4.5 mm) — readable at hang height. Tile titles wrap
to a maximum of two lines; truncate with an ellipsis beyond that rather than pushing the QR.

### ⚠ Non-Latin script — decide this before building

Poppins contains **no CJK, Arabic, Vietnamese-diacritic or Gurmukhi glyphs**. If the poster
prints `中文` or `العربية`, resvg drops those runs silently and the line renders half-empty.
Bundling Noto Sans SC / Arabic is not viable — the SC face alone is ~10 MB against the
Worker bundle limit.

**Recommendation: print caption-language names in Latin script on the poster** —
`English · Mandarin · Arabic`. Native script stays in the player's language gate, where web
fonts load normally. If you want native script on the poster, it needs subsetted Noto faces
built per-poster from the actual glyphs used, which is a bigger job — flag it and I'll spec it.

The mock renders the native-script version so you can see both options.

---

## 3. Layout

### Header band
- Full-bleed rect: `x=0 y=0 width=1122 height=258`, fill `#FFFFFF`.
- Accent rule: `x=0 y=258 width=1122 height=6`, fill `#1F9D57`.
- Inner padding: 64 left/right, 32 top.
- **Row 1** (y 32–80): Prestarter mark at 48 high on the left, 16 gap, then the wordmark.
  Right-aligned to x=1058: the supplied Affirmer horizontal lockup at 34 high.
- **Poster title** occupies y 102–164, left-aligned x=64. Wording: **"Workplace Safety
  Training"** — kept as-is; confirm if you'd rather it name the licence.
- **Row 3** occupies y 180–226: client name left, "Scan a code to watch" pill right
  (radius 999, padding 10 vertical / 24 horizontal, right edge at x=1058).

It is deliberately not a copy of the admin header — admin is a UI chrome bar, this is a
poster masthead. Same ink and same green rule tie them together.

### QR tile grid
- 3 columns × 3 rows. Page margin 64 left/right. Grid starts at y = **296** (band 258 +
  rule 6 + 32 top padding).
- Tile **312 wide × 372 high**, column gap **29**, row gap **26**.
- Bottom row therefore ends at y = **1464** (296 + 3×372 + 2×26), clearing the footer by 38.
- Tile: `rx=16`, fill `#FFFFFF`, stroke `#1F9D57`, `stroke-width=1.5`, **no shadow**.
- Tile padding 24. Contents centred on the tile's horizontal axis:
  - QR box **224 × 224** at the top of the padding box.
  - Tile title 16 below the QR — 22/1.25, centred, **maximum two lines** (55 units).
  - Meta line 8 below the title block: duration and caption languages on one line,
    `6:42 · English · Mandarin · Arabic`, 17/1.4 in `#475467`.
  - 20 clear at the bottom of the card.

  Full internal stack: 24 + 224 + 16 + 55 + 8 + 24 + 20 = **371** against a 372 tile.
  Any change to the QR box or the title size has to be taken out of the tile height too.
- **Nine tiles per sheet.** A tenth video starts a continuation sheet
  ("Sheet 2 of 2" at 17/400 `#667085`, right of the provenance line). Never shrink the QR to
  fit more on — module size is the whole point.
- Fewer than 9: keep the 3-column grid and let the last row be short, left-aligned. Do not
  centre a widowed tile or grow tiles to fill.

### Footer
- Divider: `x=64 → 1058` at y = **1502**, `#E4E7EC`, 1 unit.
- 18 below it, baseline row: provenance left, `prestarter.au` right. The footer block is
  45 high and sits 40 above the page edge, so it ends at y = 1547.
- Provenance text, verbatim: `Licensed to {client name} — not for distribution outside this
  organisation.` This line must never be dropped.

---

## 4. QR tile chrome — explicitly confirmed

**Open to restyle (as specced above):** card background `#FFFFFF`, border 1.5 units `#1F9D57`,
corner radius 16, no drop shadow, 24 padding, QR box 224.

**Not touched:** modules pure `#000000` on pure `#FFFFFF`, four-module quiet zone, square
modules, no rounded corners on modules, no logo knocked into the code, no tinting, no
gradient. The card is white, so the quiet zone reads as continuous with the card — still
emit it explicitly rather than relying on the card.

### Rasterisation detail worth getting right
Draw the modules as a **nested `<svg>` in module coordinates** rather than absolute units:

```
<svg x="68" y="24" width="224" height="224" viewBox="0 0 41 41"
     shape-rendering="crispEdges">
  <rect width="41" height="41" fill="#FFFFFF"/>
  <path fill="#000000" d="M4 4h1v1h-1z M6 4h1v1h-1z …"/>
</svg>
```

Two reasons: every module then shares the same subpixel phase, so they rasterise evenly at
any scale (module pitch is 5.46 units — not an integer, and per-module `<rect>` elements
land on different subpixel boundaries and print visibly uneven); and one `<path>` instead of
~1,000 `<rect>` elements cuts both file size and resvg time substantially. Swap `41` for the
real module count including the quiet zone.

---

## 5. Logo

Two lockups sit in the band. **Nothing can be fetched at render time**, so both must be
inlined into the SVG string.

**Prestarter mark** (left, 48 high) — draw as inline paths:

```
<g transform="translate(64,40) scale(0.9286)">
  <rect x="4" y="14" width="44" height="36" rx="8" fill="none"
        stroke="#FFFFFF" stroke-width="6"/>
  <path d="M20 23 L34 32 L20 41 Z" fill="#FFFFFF"/>
  <circle cx="52" cy="12" r="10.4" fill="#FFFFFF"/>
  <path transform="translate(37.9,-1.6) scale(0.4)"
        d="M19 35 C21 31 25.5 31 27.5 35 L31 41 C36 32 42 24 46.5 19.5
           C49.5 16.5 53.5 19.5 51.5 23.5 C46 31 39.5 41 34.5 48.5
           C32.5 51.5 28.5 51.5 26.5 47.5 C24 43 21.5 39 19 35 Z"
        fill="#3385D9"/>
</g>
```

The group's natural box is 64 × 56; `scale(H/56)` renders it at height `H`. On the white
band the two `#FFFFFF` fills above become `#1F9D57` and the tick stays `#3385D9`.

**Affirmer lockup** (right, 34 high) — `affirmer-logo-horizontal.png`, single `#3385D9` on
transparent, used exactly as supplied. Embed it as a base64 data URI in an `<image>`
element, or trace it to paths once and inline them. This replaces the current plain grey
"Affirmer" text. Do not recolour it.

No logo appears anywhere else on the sheet — the tiles stay quiet so the codes dominate.

---

## 6. Multilingual variant — recommendation

**Default: one QR per video.** List caption languages as text under the duration and let the
player's language gate do the choosing. The gate already exists, is keyboard accessible, and
was built for exactly this.

**Reason not to split the tile:** two QRs inside a 312-wide tile means roughly 105 units per
code — under 28 mm printed, about half the current module pitch. Laminated, outdoors, on a
low-end camera, that is where scan failures start, and a code that fails for some workers is
worse than one extra tap in the player.

**If a client insists**, the opt-in variant is: drop to **2 columns**, tile 481 × 380, and
place two 224-unit QRs side by side with the language label beneath each at 18/600 — same
module size as the default, half as many videos per sheet. That is the trade, stated plainly.
Do not build it until someone asks.

---

## 7. Order of work in `poster.ts`

1. Swap the header band `#111827` → `#FFFFFF` and flip its text to `#101828` / `#475467`;
   replace the `#f97316` rule with 6 units of `#1F9D57`; band height 258.
2. Replace the plain-text "Affirmer" with the inline mark group in §5; add the Prestarter
   lockup on the left.
3. `font-family="Inter"` → `"Poppins"` throughout; apply the §2 size scale.
4. Retag greys to the §1 hex values.
5. Rebuild the tile as the §3 card (312 × 372, radius 16, 1.5 × `#1F9D57`, no shadow); move the
   module drawing into the nested-`<svg>` form in §4.
6. Footer divider + provenance + `prestarter.au`.
7. `render-png.ts`: add the three Poppins TTFs to `fontBuffers`, drop Inter, bump the render
   scale to 2.0846 (200 dpi) or 3.1269 (300 dpi). **Verify PNG text is actually present** —
   missing fonts fail silently here.

---

## 8. Open questions

- Poster title wording — "Workplace Safety Training" kept from the current version. Should it
  name the licence or the site instead?
- Non-Latin caption-language names: Latin transliteration (recommended) or subsetted Noto
  faces built per poster?
- 200 dpi or 300 dpi PNG default. 300 is four times the pixels through resvg — fine for a
  9-tile sheet, worth measuring against the Worker CPU limit.
- Continuation-sheet label wording: "Sheet 2 of 2" as specced, or repeat the client name?
