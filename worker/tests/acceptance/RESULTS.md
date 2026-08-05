# Spec section 18 — full run-through

Run against the real Cloudflare Stream account, stage-one build only (Worker + player, no
Supabase). Most of the 23 tests depend on features that are explicitly stage two or later
(entitlements, billing, admin console, client portal, QR/poster export, captions) — those are
marked **not yet buildable**, not fail. Anything marked **PASS** was actually executed this
session, not assumed.

## Access control

| # | Test | Result |
|---|---|---|
| 1 | Raw Stream URL without a token is refused | **PASS** — `at1-raw-url-refused.sh`, raw manifest and raw iframe both 401 against the real account. |
| 2 | Token older than 120s is refused | **PASS** — `at2-expired-token-refused.sh`, run at the literal 120s value. Master manifest, variant playlist, and a *previously-valid* segment URL all return 401 once `exp` passes. See AT2 script header for the segment-level detail. |
| 3 | Key rotation stops playback within 60s | Not yet buildable — no `access_keys` table (stage two). |
| 4 | Pausing a client stops playback immediately | Not yet buildable — no `clients.status` (stage two). |
| 5 | Play after `term_end` refused | Not yet buildable — no `term_end` (stage two). |
| 6 | No-entitlement play refused | Partial stand-in only: the Worker checks `videoId` against one hardcoded stage-one UID, not a real entitlements table. Real check is stage two. |
| 7 | Cross-org RLS at API level | Not yet buildable — no Supabase in this stage (explicit scope decision). |

## Advisory cap

| # | Test | Result |
|---|---|---|
| 8 | Cap exceeded alerts, doesn't block | Not yet buildable — no `play_events`/`usage_daily`/`alerts` (stage two). |
| 9 | Cap value never client-facing | Vacuously true right now (the field doesn't exist anywhere yet) — not the same as verified protection. Re-test for real once the field exists in stage two. |

## Billing

| # | Test | Result |
|---|---|---|
| 10–13 | Billing state transitions, mark-paid | Not yet buildable — no `billing_events`/`billing_state` (stage two). |
| 14 | No monetary value anywhere | **PASS (static check)** — grepped `worker/src` for price/amount/invoice/currency/cost/AUD/USD; only hit was `CLAUDE` coincidentally containing the substring "AUD". No monetary field exists in the code built so far. |

## Client visibility

| # | Test | Result |
|---|---|---|
| 15 | Portal has no usage figures | Not yet buildable — no client portal (stage four). |
| 16 | Denial message discloses no usage figures | **PASS** — triggered real 403s (wrong `videoId`, missing `videoId`) against the local Worker; both return the fixed message `"This licence is not currently active, please contact your safety team."` with no figures, and the two failure cases are indistinguishable from each other (doesn't leak which check failed). |

## Content

| # | Test | Result |
|---|---|---|
| 17 | Every play logs a hashed-address `play_events` row | Not yet buildable — no DB (stage two). |
| 18 | QR scan opens correct video | Not yet buildable — no QR generation (stage three/four). |
| 19 | Poster export has correct QRs only | Not yet buildable — stage three/four. |
| 20 | Captions load/select, `?lang=` preselects | Not yet buildable — no caption UI or `?lang=` handling in the player at all yet. Explicitly out of this stage's scope (spec section 8 work). |
| 21 | Watermark correct name, no caption overlap, legible at 1080p/720p/mobile | **PASS** — tested in a real browser at 1920×1080, 1280×720, and 375×812 (mobile preset). Watermark text legible against a busy background at all three via zoomed screenshots. No caption track exists yet to test the overlap half of this claim against real captions — positioning versus the bottom control bar was confirmed clear. |
| 22 | Watermark clock reflects token issue time, not device clock | **PASS (source audit)** — only one `Date.now()` call in the entire player, used solely for internal refresh-timer scheduling math; it never touches what's displayed. The displayed clock is `issuedAtMs` (from the server) plus `video.currentTime` (media-relative), formatted via `new Date(ms)` with an explicit argument — it never reads the device's wall clock. |
| 23 | MP4 download unavailable via interface and API | **PASS** — `GET .../stream/{uid}/downloads` returns an empty result (no download enabled); the default download URL returns 401 directly; the player itself renders no download control (confirmed by reading `player.ts`). |

## AT24 (new, this session's amendment) — watermark survives fullscreen

Desktop: code path confirmed correct (fullscreens `#container`, never `<video>`); CSS fake-fullscreen
fallback (for iPhone Safari) verified pixel-by-pixel in a real browser — watermark stays visible,
exit control works. True native-Fullscreen-API pixel result on desktop is **not independently
verified by me** — the automated browser tool used couldn't complete a real OS-level fullscreen
transition (no real display). iPhone Safari needs a physical device. See
`AT24-fullscreen-watermark.md` for the honest breakdown.

## Bug found and fixed during this run

`attachSource()` in `player.ts` originally checked `video.canPlayType("application/vnd.apple.mpegurl")`
first and used native `<video>.src` if truthy, falling back to `hls.js` otherwise. This Chromium
build reported truthy support and then failed with `MEDIA_ERR_SRC_NOT_SUPPORTED` — a known footgun.
Fixed to prefer `hls.js` (`Hls.isSupported()`, an MSE capability check) whenever available, with
native `<video>.src` only as the fallback for browsers where `hls.js` genuinely isn't supported
(effectively Safari/iOS). Re-verified with `tsc --noEmit` and a syntax check of the rendered page's
inline script.

## Environment limitation noted, not a code defect

Fetching the real Stream manifest via `fetch()`/`hls.js` from inside the sandboxed Browser tool used
for this session fails (`TypeError: Failed to fetch`) even though: curl succeeds against the
identical URL: Cloudflare returns `Access-Control-Allow-Origin: *`; and an unrelated external API
(`jsonplaceholder.typicode.com`) fetches fine from the same page. This points to the tool's own
network handling rather than a CORS or code problem — direct HTTP testing (curl) against the real
Cloudflare account remains the authoritative evidence for AT1/AT2/AT23, which is what those tests are
actually about (server-side access control, not one browser's decode success).
