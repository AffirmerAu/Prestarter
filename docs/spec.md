# Prestarter — build specification

Safety video licence platform · prestarter.affirmer.com.au

**Status:** draft for review · **Owner:** Matt, Affirmer Pty Limited · **Revised:** 31 July 2026

---

## 0. How to use this document

**If you are the person editing this:** every section is self-contained. Sections marked
**⚠ NEEDS RESOLUTION** contain a conflict that must be settled before a build starts.

**If you are an AI or developer building from this:** treat section 3 as binding constraints, not
suggestions. Where a decision looks suboptimal, implement it as written and raise the concern
separately. Do not resolve the ⚠ items yourself — ask.

Two rules that are easy to breach by accident, so they are stated up front:

- **No monetary values anywhere in the system.** No prices, amounts, rates or currency. Billing is
  a paid / not-paid state only.
- **Clients never see usage figures.** No play counts, no caps, no limits, no entitlement counts, no
  percentages. All usage data is administrator-only.

---

## 1. What this is

`Prestarter` licenses a catalogue of 3D animated workplace safety training videos to enterprise
clients on a subscription basis.

Clients sign in to a portal, copy an embed code or watch link, or download a QR code, and place it
into their own intranet, induction email, or a printed sign on a work site. There is no learning
management system, no assessment content, and no per-worker accounts.

Videos are produced by Affirmer, an Australian animation studio serving mining, construction,
transport and healthcare.

| Role | Who | Needs |
|---|---|---|
| Administrator | Affirmer staff | Manage clients and entitlements, spot leaked links, mark payments, review videos |
| Client contact | WHS or safety manager at a client organisation | Copy a link, download a QR code, print a poster, know when to renew |

---

## 2. Glossary

- **Client** — a licensed organisation.
- **Entitlement** — permission for one client to play one video, with effective dates.
- **Access key** — a rotatable secret in every link belonging to a client. Rotating it invalidates
  every link that client holds.
- **Playback token** — a short-lived signed credential permitting one playback session.
- **Play event** — one recorded playback start. Administrator-visible only.
- **Advisory cap** — a daily play threshold that raises an administrator alert. It never blocks
  playback and is never shown to clients.
- **Watermark** — the on-screen overlay identifying the licensed organisation.

---

## 3. Decisions (binding constraints)

| Ref | Decision |
|---|---|
| D1 | Catalogue is newly produced generic content, not re-licensed client work |
| D2 | Licence grants display rights only; subcontractors of the client are included |
| D3 | New voice and music recorded for all catalogue content; Affirmer owns it outright |
| D4 | Packaged as industry packs plus per-course add-ons ⚠ see 3.1 |
| D5 | URLs carry an opaque stable video ID, never the human-readable code |
| D6 | **Revised.** Served from `prestarter.affirmer.com.au`, a subdomain of the main site |
| D7 | Twelve-month term from start date; reminders at 60 and 30 days |
| D8 | Fee is metered on plays, calculated **outside** the system ⚠ see 3.1 |
| D9 | Daily cap is advisory — it alerts the administrator only, never blocks, never shown to clients |
| D10 | Cap is fixed per plan tier, set by the administrator |
| D11 | Watch links do not expire; key rotation is the kill switch |
| D12 | Only administrators may rotate a key |
| D13 | MP4 download is never offered to clients under any circumstances |
| D14 | Non-payment: grace period, then playback cutoff |
| D15 | Video hosting: Cloudflare Stream |
| D16 | Token service: Cloudflare Worker |
| D17 | Authentication: email magic link |
| D18 | Built in-house |
| D19 | QR codes generated with a maintained library |
| D20 | Play events logged individually with a hashed address |
| D21 | Play events retained indefinitely |
| D22 | **Revised.** Clients see no usage data of any kind. Only licence state: active, renewal approaching, payment due, overdue, or paused |
| D23 | **Revised.** Multilingual captions in scope for version one, managed in Cloudflare Stream |
| D24 | Video updates replace in place; affected clients notified |
| D25 | Catalogue metadata prepared by the studio team |
| D26 | First release is a demo for three existing clients |
| D27 | Ninety-day success measure to be agreed |
| D28 | Stop condition to be agreed |

### 3.1 ⚠ NEEDS RESOLUTION

**A. Packaging versus metering (D4 + D8).** Is a client buying a pack *and* paying per play, or does
a pack include a play allowance with overage beyond it? Recommended wording to adopt or replace:

> A pack grants access to a defined set of videos and includes an annual play allowance. Plays
> beyond the allowance are charged at review. Per-course add-ons extend the accessible set, not the
> allowance.

Note this is a commercial question only. Because no monetary values exist in the system and metered
charges are calculated externally from the usage export, the software behaves identically either
way. It does not block the build.

**B. What "renewal approaching" means (D7 + D8).** Under a time-based term it means the term end is
near. Under metering it could also mean an allowance is nearly consumed. Because clients see no
figures, the trigger must be one or the other. Recommended: **term end only**. If allowance
exhaustion should also warn the client, specify the wording, since it cannot include a number.

---

## 4. Architecture

| Layer | Technology | Responsibility |
|---|---|---|
| Front end | React, TypeScript, Vite, Tailwind on Cloudflare Pages | Admin console and client portal |
| Database | Supabase (PostgreSQL), Sydney region | Clients, entitlements, keys, usage, billing state, alerts |
| Auth | Supabase Auth, email magic link | Client and staff sign-in |
| Video | Cloudflare Stream, signed URLs required on every video | Encoding, adaptive streaming, captions, delivery |
| Token service | Cloudflare Worker | Entitlement checks, cap accounting, token signing |
| Player | Static page on `prestarter.affirmer.com.au` | Playback, watermark overlay, caption language selection |
| Email | Resend | Magic links, onboarding, admin alerts, renewal and overdue notices |

**Non-negotiable:** clients never receive a Cloudflare Stream URL. They receive links to
`prestarter.affirmer.com.au` carrying their access key. The player requests a token at playback time.

---

## 5. Data model

```
clients
  id, name, mark_as, status (active|paused),
  plan_tier, term_start, term_end,
  billing_state (paid|due|overdue), paid_to, grace_days (default 14),
  daily_cap_advisory, created_at

client_contacts
  id, client_id, email, name, role, invited_at, last_seen_at

videos
  id (opaque, used in URLs), display_code, title, duration_seconds,
  category, stream_uid, status (draft|released|archived),
  released_at, replaces_video_id

video_languages
  id, video_id, language_tag (BCP-47), kind (caption|audio),
  label_native, is_default, source (uploaded|generated), reviewed_at

entitlements
  id, client_id, video_id, effective_from, effective_to

access_keys
  id, client_id, key, issued_at, revoked_at

play_events                      -- administrator visible only
  id, client_id, video_id, occurred_at, address_hash,
  country, referrer_host, source (embed|watch|poster),
  language_tag, user_agent_class

usage_daily                      -- administrator visible only
  client_id, video_id, day, plays, distinct_addresses, countries
  -- primary key (client_id, video_id, day)

billing_events
  id, client_id, action (marked_paid|marked_due|marked_overdue|paused|restored),
  period_start, period_end, reference, actor, occurred_at, note
  -- reference is a free-text field for an external invoice number.
  -- No monetary amount field exists on this table by design.

alerts
  id, client_id, video_id, type, severity, evidence (jsonb),
  raised_at, acknowledged_at, acknowledged_by

audit_log
  id, actor, action, subject_type, subject_id, detail (jsonb), occurred_at
```

**Rules**

- Row level security scopes every client-facing query to the signed-in user's `client_id`, and
  **excludes `play_events` and `usage_daily` entirely** — clients have no read path to usage data.
- `daily_cap_advisory` must not be exposed on any client-facing endpoint.
- No table has a monetary column. If a build introduces one, that is a defect.
- `videos.id` is opaque and permanent. `display_code` may change freely; the ID may not, because
  printed QR codes encode it.
- Entitlement changes, key rotations, billing marks and status changes all write to `audit_log`.

---

## 6. Playback and token flow

1. A learner opens an embed or watch link containing `video_id` and the client's access key.
   The link may carry an optional `lang` parameter.
2. The player page requests a token from the Worker.
3. The Worker validates, in order: key exists and is not revoked; client status is `active`;
   current date is within the term; the client is not past `paid_to` plus `grace_days`; an
   entitlement exists for this client and video.
4. The Worker records a play event and increments the daily counter.
5. If the daily count exceeds `daily_cap_advisory`, the Worker **still issues the token** and raises
   an administrator alert. The cap has no effect on playback and is never surfaced to the client.
6. The Worker returns a signed Cloudflare Stream token with a **120-second lifetime**, plus the
   watermark configuration and the available caption languages.
7. The player begins playback and requests a fresh token before expiry, for the session duration.

**Failure behaviour:** on any validation failure, deny playback with a clear message. Never fall
back to an unsigned URL. The denial message must not disclose usage figures — "this licence is not
currently active, please contact your safety team" is sufficient.

**If entitlements are cached in Workers KV** for latency: the cache **must** be purged on key
rotation, entitlement change and billing state change. A stale cache means a revoked key keeps
playing, which defeats the only revocation mechanism in the system. Maximum TTL 60 seconds if
purging is not implemented.

**Cloudflare Stream configuration:** `requireSignedURLs: true` on every video. MP4 downloads
disabled at account and video level (D13).

---

## 7. Watermark (fixed — not configurable)

- Positioned **top left** of the video frame, inset roughly 16px from each edge.
- Two lines, or one line with a separator: the client's `mark_as` value, and the playback time.
- White text with a dark outline (`0 0 3px rgba(0,0,0,0.95), 0 1px 2px rgba(0,0,0,0.8)`), 30%
  opacity.
- Monospace, approximately 13px at standard player width, scaling with the player.
- No background strip. The outline carries legibility over both bright and dark frames. If testing
  shows it failing over a light sky, add a subtle rounded backdrop rather than increasing opacity.
- Rendered as a DOM element above the `<video>` element, **never** encoded into the file.
- The clock is derived from the **token issue time**, not the viewing device clock, so it cannot be
  falsified locally.
- Must not overlap the caption region, which sits at the bottom of the frame, nor the player
  controls.
- No client-configurable settings. No per-client variation beyond the name.

---

## 8. Captions and languages

Captions are managed in Cloudflare Stream, one WebVTT file per language per video, tagged with a
BCP-47 language code. A video may carry many languages; each language may appear only once.

**Authoring**
- Upload a prepared WebVTT file, or use Stream's AI caption generation as a first pass.
- Generated captions must be human-reviewed before a video is released. Record the reviewer and
  date in `video_languages.reviewed_at`. A mistranslated safety instruction is a liability, not a
  typo, so unreviewed generated captions must not reach a client.
- Store the native-script label (`中文`, `한국어`) in `label_native` for display.

**Selection at playback**
1. If the link carries `?lang=`, that language is selected before playback starts.
2. Otherwise, match the browser or device locale if a matching track exists.
3. Otherwise, use the track flagged `is_default`.
4. The player also exposes a standard caption menu so the viewer can change it mid-playback.

Preselection via the link matters more than the menu: a worker who cannot read English cannot
navigate an English-labelled caption menu.

**Client visibility.** The portal shows which languages a video is available in — this is content
information, not usage data, and clients need it to print the right posters.

**Audio tracks.** Cloudflare Stream supports multiple audio tracks on a single video, so translated
voiceover can be added later without re-encoding or duplicating videos. The `video_languages` table
already carries `kind = audio` for this. No audio-track interface in version one.

---

## 9. Administration console

**Dashboard**
- Metrics: plays today, active clients, videos released, open alerts, **accounts overdue**.
- Alert list, most severe first, each with headline, evidence sentence containing real figures, a
  plain-English recommendation, and actions: open client, rotate key, pause client, dismiss.
- Seven-day play chart, all clients combined.
- Busiest links today, with country count per link.
- Overdue accounts panel: client, days overdue, days until cutoff, mark-paid action.

**Clients**
- List: name, key, plays today against advisory cap, term end, billing state, alert badge, status.
- Detail: contacts, watermark text, plan tier, advisory cap, term dates, grace period.
- **Billing panel** — see section 10.
- Access key display with rotate action (admin only). Rotation warns that every existing link and
  printed poster for that client will stop working.
- Entitlement checklist across the full catalogue.
- Link and QR panel; poster export.
- Usage history and export.

**Video library**
- Tile grid: thumbnail, title, display code, duration, category, client count, language badges.
- Click to open a review player showing the watermark and captions exactly as clients see them.
- Caption management per video: list languages, upload WebVTT, generate via AI, mark reviewed.
- Add, edit, archive. Replacing a video keeps the same `videos.id` and records
  `replaces_video_id`, then notifies affected clients.

---

## 10. Billing state (no monetary values)

The system records **whether** a client has paid, never **how much**. Amounts, invoices and any
metered calculation live in external accounting.

**States**

| State | Meaning | Playback |
|---|---|---|
| `paid` | Paid up to `paid_to` | Normal |
| `due` | Past `paid_to`, inside grace period | Normal |
| `overdue` | Past `paid_to` plus `grace_days` | **Blocked** (D14) |

**Administrator actions**
- **Mark paid** — a single checkmark control on the client record. Sets `billing_state = paid`,
  advances `paid_to` by the term length, writes a `billing_events` row with the actor, timestamp and
  optional external invoice reference. No amount is entered because no amount field exists.
- **Mark as due** — reverses an incorrect mark-paid.
- **Extend grace** — adjusts `grace_days` for a client with a payment genuinely in progress.

**Automatic transitions**
- Nightly job: any client past `paid_to` moves `paid` → `due`; any client past
  `paid_to + grace_days` moves `due` → `overdue`.
- Entering `overdue` blocks token issue immediately. It does **not** delete anything, and marking
  paid restores playback instantly with no need to reissue links.

**Notifications**

| Trigger | To | Content |
|---|---|---|
| Term end in 60 and 30 days | Client contacts and admin | Renewal approaching. No figures. |
| Enters `due` | Client contacts and admin | Payment outstanding, access continues for now. |
| Three days before cutoff | Client contacts and admin | Access will pause shortly unless payment is confirmed. |
| Enters `overdue` | Client contacts and admin | Access paused, contact Affirmer. |
| Daily digest | Admin only | All accounts in `due` or `overdue`. |

Client-facing wording must never include amounts, play counts or dates derived from usage.

---

## 11. Client portal

The portal shows **content and licence state only**. It contains no numbers describing usage.

**Status banner** — exactly one of:

| State | Message |
|---|---|
| Active | Your licence is active. |
| Renewal approaching | Your licence is approaching its renewal date. Affirmer will be in touch. |
| Payment due | A payment is outstanding on your licence. Access continues for now. |
| Overdue | Access is paused pending payment. Please contact Affirmer. |
| Paused | Your licence is currently paused. Please contact Affirmer. |

**Video list** — one row per licensed video: thumbnail, title, duration, available languages,
QR download, link. No counts, no totals, no "X of Y".

**Link panel** — format switcher (watch page, iframe embed, HLS manifest) with a copy control.
Optional language selector that appends `?lang=` to the generated link.

**Poster export** — every licensed video, as section 12.

**Footer note** — a short line explaining that the company name and playback time appear discreetly
on every play.

**Explicitly absent from the portal:** play counts, daily limits, caps, percentages, entitlement
counts, remaining allowance, cost, or any figure derived from usage.

---

## 12. QR codes and poster export

**QR codes**
- Encode `https://prestarter.affirmer.com.au/w/{video_id}?k={access_key}&src=poster`, plus `&lang=` where a
  language is selected.
- Pure black on pure white, four-module quiet zone. No tinting, rounding, or embedded logo — these
  reduce scan reliability on laminated signage.
- Output SVG (print) and PNG (office printer).
- Generated with a maintained library, verified against a second implementation before the first
  poster is printed.

**Poster**
- A3 portrait, printable.
- Dark header band with accent rule: title, client name, "scan to watch" instruction, Affirmer mark.
- Grid of QR tiles, each with course title and duration.
- Provenance line: licensed to `{client.name}`, not for distribution outside this organisation.
- Output SVG and PNG at 200 dpi minimum.
- No usage figures anywhere on the poster.

**Optional — multilingual posters.** Where a video has captions in several languages, the poster can
print one QR per language beneath the title, each labelled in its own script (`English`, `中文`,
`한국어`), so a worker scans the code for their language and needs no menu. Delete this item if not
wanted.

---

## 13. Alerts (administrator only)

| Type | Condition | Severity |
|---|---|---|
| Advisory cap exceeded | A link's daily plays exceed the client's advisory cap | Critical |
| Geographic spread | A link plays from three or more countries in a day | Warning |
| Approaching cap | Client's daily total exceeds 80% of the advisory cap | Warning |
| Payment overdue | Client has entered `overdue` | Critical |
| Cutoff imminent | Client is three days from cutoff | Warning |

No alert of any kind is shown to clients. Each alert records evidence values so it can be judged
later, and acknowledgement is recorded with actor and timestamp.

**Known weakness for phase two:** cap thresholds are absolute, so a client running a genuine
induction blitz generates false positives. Compare against that client's own trailing baseline.

---

## 14. Authentication

- Email magic link, via Supabase Auth and Resend.
- Multiple contacts per client organisation — the person who sets it up is rarely the daily user.
- Separate administrator role.
- No password reset flow required.

---

## 15. Non-functional requirements

| Area | Requirement |
|---|---|
| Availability | Playback must survive a portal outage. Embedded video in client systems must not depend on the admin console being up. |
| Performance | Token issue under 200 ms. Playback start comparable to mainstream video platforms. |
| Data residency | Application database in the Sydney region. Video is delivered from a global CDN — do not promise residency for video. |
| Backups | Daily database backup with a documented and tested restore. |
| Privacy | Australian Privacy Act. No learner names or identifiers collected. Addresses hashed or truncated, never stored raw. |
| Retention | Play events retained indefinitely as operational records. |
| Accessibility | Player controls keyboard operable. Captions available and selectable. Watermark must not obscure captions. |
| Browsers | Current Chrome, Edge, Safari, Firefox; mobile Safari and Chrome for QR scan traffic. |

---

## 16. Out of scope for version one

- Payment processing, card capture, invoices, or any monetary value in the system.
- Client-visible usage metrics of any kind.
- Per-learner links and named completion reporting.
- SCORM, xAPI, LTI or any LMS integration.
- Assessment or quizzing.
- Digital rights management.
- Client-configurable watermarks.
- MP4 downloads in any form.
- Translated audio-track interface (schema present, no UI).

---

## 17. Build order

Stage one must be complete and proven before any interface work begins.

1. **Security model.** One video in Cloudflare Stream with signed URLs required. Worker mints a
   token. Player plays it with the top-left watermark. Verify a raw Stream URL fails and an expired
   token fails.
2. **Data and enforcement.** Schema, entitlement checks, play recording, advisory cap alerts,
   billing state transitions and cutoff.
3. **Admin console.** Clients, entitlements, keys, billing checkmark, video library with review
   player and caption management.
4. **Client portal.** Status banner, video list, links, QR codes, poster export.
5. **Notifications.** Renewal, payment and overdue notices; admin alert digest.

Indicative effort for software: five to eight weeks part-time. **This excludes video production and
caption authoring, which sit on the critical path to launch and are not covered here.**

---

## 18. Acceptance tests

The build is not done until all of these pass.

**Access control**
1. A direct Cloudflare Stream URL, without a token, is refused.
2. A token older than 120 seconds is refused.
3. Rotating a client's key stops playback on every existing link within 60 seconds.
4. Pausing a client stops playback immediately.
5. A play after `term_end` is refused.
6. Playing a video the client has no entitlement for is refused.
7. A client signed in to organisation A cannot read any data belonging to organisation B, tested at
   the API level, not only through the interface.

**Advisory cap**
8. Exceeding the advisory cap raises an administrator alert and **does not** stop playback.
9. The advisory cap value is not present in any client-facing API response or page source.

**Billing**
10. Marking a client paid advances `paid_to`, sets state to `paid`, and writes a `billing_events`
    row with actor and timestamp.
11. A client past `paid_to` moves to `due` and continues to play.
12. A client past `paid_to + grace_days` moves to `overdue` and playback is blocked.
13. Marking an overdue client paid restores playback immediately with no link reissue.
14. No monetary value can be entered or displayed anywhere in the system.

**Client visibility**
15. The client portal contains no play count, cap, percentage, entitlement count or remaining
    allowance, verified by inspecting the rendered page and the network responses.
16. A playback denial message discloses no usage figures.

**Content**
17. Every play writes one `play_events` row with a hashed address and no raw address anywhere.
18. A downloaded QR code, printed and scanned with a standard phone camera, opens the correct video.
19. A poster exported for a client contains one QR per licensed video and no others.
20. Captions in each configured language load and are selectable, and `?lang=` preselects correctly.
21. The top-left watermark shows the correct client name, does not overlap captions at the bottom of
    the frame, and remains legible at 1080p, 720p and on a mobile viewport.
22. The watermark clock reflects token issue time, not a device clock altered by the viewer.
23. MP4 download is unavailable through the interface and through the API.

---

## 19. Open items

- Section 3.1 A and B — packaging wording, and what triggers "renewal approaching".
- D27 and D28 — success measure and stop condition, to be agreed with James.
- **One host or two.** `prestarter.affirmer.com.au` currently serves both the portal and playback.
  Bind `/w/*` and `/e/*` directly to the Worker so a failed Pages deployment cannot stop video
  already embedded in client systems. If playback should live on its own host instead, decide before
  the first poster is printed — QR codes encode the player host permanently.
- **Trade mark clearance.** PRESTART is filed as a software mark by Australian entities in adjacent
  categories. Search IP Australia in classes 41, 9 and 42 before printing any poster.
- Grace period default — currently 14 days.
- Whether clients may request a usage report manually, given the portal shows none. Safety managers
  commonly need evidence for audits, and a refusal with no alternative will generate friction.
