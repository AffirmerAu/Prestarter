# Prestarter — decision log

Safety video licence platform · Affirmer Pty Limited
Last revised: 31 July 2026 · 28 of 28 decided

This is the record of *why* the platform is built the way it is. The binding technical constraints
live in `spec.md`; this file explains the reasoning behind them. Where a decision was revised after
first being made, both the change and the reason are recorded.

**One-way** decisions are expensive or impossible to reverse. **Blockers** gated other work.

---

## Rights and legal

| # | Decision | Answer | Type |
|---|---|---|---|
| D1 | Which videos can be licensed to third parties? | Commission new generic versions | One-way, blocker |
| D2 | What does a licence grant? | Display only, subcontractors included | One-way, blocker |
| D3 | Voice talent and music re-use rights | Re-render with new voice and music | One-way |

**D1.** Existing catalogue videos were produced under client-specific agreements and contain client
branding, site footage and staff likenesses. Rather than audit and re-license them, Prestarter runs
on newly produced generic content that Affirmer owns outright.

*Consequence:* this removes the rights problem entirely, but changes the business case. The original
proposal argued the platform monetises finished work at near-zero marginal cost. It now requires
production investment up front, and video production sits on the critical path to launch — outside
the software build estimate.

*Follow-up:* choose the first topics on generic demand rather than production interest. Working at
heights, manual handling and PPE appear in nearly every client induction.

**D2.** Subcontractor coverage is the clause that matters most in mining and construction, where a
principal contractor will otherwise hand an induction to a dozen subbies. Decided deliberately to
include them rather than leaving it silent. To be drafted once by a solicitor as a template.

**D3.** New voice and music recorded for all content, so Affirmer owns the underlying assets
outright. Standard stock music licences frequently exclude subscription redistribution, so
purpose-recorded assets avoid a licence breach that would otherwise surface years later.

*Follow-up:* buy voice and music with unlimited distribution rights from the outset. "We own the
content" is only true if the underlying assets allow it.

---

## Product shape

| # | Decision | Answer | Type |
|---|---|---|---|
| D4 | Licence unit | Packs plus per-course add-ons | Reversible |
| D5 | Video identifier scheme | Opaque stable ID in the URL | One-way, blocker |
| D6 | Player domain | `prestarter.au` — dedicated domain | One-way, blocker |
| D7 | Term length and renewal | 12 months from start date | Reversible |
| D8 | Basis of the licence fee | Metered plays, calculated externally | Reversible |

**D5.** Printed posters and laminated signs stay in circulation for years, and the identifier in the
QR URL cannot change afterwards. An opaque stable ID means a video can be renamed, recategorised or
re-versioned without invalidating printed material. Display codes remain for humans.

**D6.** *Revised.* Originally "a separate domain", then briefly `prestarter.affirmer.com.au`, now
settled on the standalone `prestarter.au`.

*Trade-off:* shorter QR URLs, which measurably helps scan reliability on printed signage, and the
product can outgrow Affirmer later without migration. Against that, a worker scanning a code on a
fence sees a domain with no visible Affirmer association — so poster branding and the player page
must carry the Affirmer mark to establish provenance.

*Note:* PRESTART is filed as a software trade mark by Australian entities in adjacent categories.
An IP Australia search across classes 41, 9 and 42 is outstanding and must be completed before any
poster is printed.

**D7.** Twelve months from start date rather than calendar-aligned, which would create a January
renewal cliff and lumpy cash flow. Reminders at 60 and 30 days.

**D8.** *Consequence worth noting.* Under metered pricing a play is revenue rather than cost, which
inverts the meaning of a leaked link — over-cap plays become an invoice a client will correctly
dispute. This is why D9 keeps the cap advisory and why plays above the cap should be absorbed
pending investigation rather than billed. No monetary values exist in the system; metered charges
are calculated externally from the usage export.

---

## Access and enforcement

| # | Decision | Answer | Type |
|---|---|---|---|
| D9 | What happens at the daily cap? | Advisory only — alerts admin, never blocks | Reversible |
| D10 | Cap-setting policy | Fixed per plan tier | Reversible |
| D11 | Do watch links expire? | Permanent until the key rotates | Reversible |
| D12 | Can clients rotate their own key? | Admin only | Reversible |
| D13 | Is an MP4 download ever offered? | Never | One-way |
| D14 | Non-payment behaviour | Grace period, then cutoff | Reversible |

**D9.** Blocking a worker from a safety induction because a counter tripped is a serious failure
mode — commercially, and potentially in a real safety sense. The cap alerts the administrator and
nothing more. It is never shown to clients (see D22).

**D11.** Permanent links, with key rotation as the kill switch. Expiring links would break printed
posters, which defeats the purpose of the QR codes.

**D12.** A client rotating their own key would break every embed and poster they have deployed, and
the support call lands with Affirmer regardless. Admin action on request.

**D13.** Once a client holds the file, a perpetual licence has been granted whether intended or not,
and no later control recovers it. Offline sites with no connectivity are a genuine case in mining —
handle those individually under a separate negotiated agreement, never as a product tier.

**D14.** Grace period then cutoff, driven by the `paid_to` date and a manual paid/unpaid mark.
Marking a client paid restores playback instantly with no need to reissue links.

---

## Technical platform

| # | Decision | Answer | Type |
|---|---|---|---|
| D15 | Video hosting provider | Cloudflare Stream | Reversible |
| D16 | Token service | Cloudflare Worker | Reversible |
| D17 | Authentication | Email magic link | Reversible |
| D18 | Build in-house or contract | Build all in-house | Reversible |
| D19 | QR encoder | Maintained library | Reversible |

**D15.** Cloudflare Stream: two-dimensional pricing with no egress charges, signed URLs validated at
the edge, and native to the platform already in use. Storage is charged by duration rather than file
size, and adaptive renditions do not multiply the storage bill.

*Known limitation:* no Widevine or FairPlay DRM. Assessed as acceptable because the threat model is
link sharing rather than redistribution, and DRM does not prevent sharing. Bunny Stream remains the
migration target if DRM ever becomes necessary. Because playback runs through `prestarter.au`,
changing host later requires re-uploading files and repointing the Worker — no client-facing link
changes and no printed poster invalidated.

*Revisit DRM if:* a Prestarter video appears on a competitor's site or a training marketplace; a
client's procurement specifies it; or content is licensed to a reseller.

**D16.** Cloudflare Worker, co-located with Stream, serving the player page from the same platform.

*Implementation caution:* if entitlements are cached in Workers KV to avoid a round trip to the
Sydney database, the cache must be purged on key rotation, entitlement change and billing state
change. A stale cache means a revoked key keeps playing, which defeats the only revocation
mechanism in the system.

**D17.** Safety managers are infrequent users who will have forgotten a password every time.
Multiple contacts per organisation, since the person who sets it up is rarely the daily user.

**D18.** Stage one built in-house because it proves the security model and carries the most design
weight. Later stages could be contracted, since the specification makes them unambiguous.

**D19.** A maintained library, verified against a second implementation before the first poster is
printed. A defective QR code is not visibly defective until it fails to scan on a wall.

---

## Data and privacy

| # | Decision | Answer | Type |
|---|---|---|---|
| D20 | What gets logged per play? | Event-level with hashed address | One-way |
| D21 | Play event retention | Indefinite | Reversible |
| D22 | Do clients see their own usage data? | **Revised — no usage data at all** | Reversible |

**D20.** Event-level logging from day one, even though only daily aggregates are used. Aggregation
is always possible later; retrospective collection is not. Addresses are hashed or truncated and
raw addresses are never stored. Because version one identifies organisations rather than
individuals, no personal information about learners is collected at all — a genuine procurement
advantage worth protecting deliberately.

**D21.** Indefinite retention, justified because play records function as billing records under
metered pricing (D8). Hashed addresses keep this defensible under the Privacy Act.

**D22.** *Revised.* Originally "yes, from version one". Clients now see **no usage figures of any
kind** — no play counts, caps, percentages, entitlement counts or remaining allowance, in the
interface or in any API response. All usage data is administrator-only, enforced at the database
layer through row-level security rather than hidden in the front end.

Clients see licence *state* only: active, renewal approaching, payment due, overdue, or paused.

*Open question:* a safety manager who needs completion evidence for an audit now has no
self-service route. An answer should be ready before the first client asks — even "email us and
we'll send a report" is sufficient, but the request will come.

---

## Content operations

| # | Decision | Answer | Type |
|---|---|---|---|
| D23 | Captions at launch? | **Revised — in scope, handled in Cloudflare** | Reversible |
| D24 | Video updated mid-term | Replace in place, notify affected clients | Reversible |
| D25 | Catalogue metadata owner | Studio team | Reversible |

**D23.** *Revised.* Originally deferred to phase two, now in scope for version one, with captions
managed in Cloudflare Stream as one WebVTT file per language per video.

*Reasoning for the change:* D3 means new voiceover is being recorded for every video, so the script
and timing exist at the moment of production. Captioning then costs almost nothing; retrofitting
means reconstructing text from finished audio. It is the cheapest it will ever be. Affirmer's
positioning also rests on training that works across multilingual and multi-literacy workforces,
which a caption-free launch would undercut.

*Implementation notes:* AI-generated captions must be human-reviewed before release — a
mistranslated safety instruction is a liability, not a typo. Language is preselected via a `?lang=`
parameter on the link rather than relying on a menu, because a worker who cannot read English
cannot navigate an English caption menu. Cloudflare Stream also supports multiple audio tracks on a
single video, so translated voiceover can be added later without duplicating videos.

**D24.** Replace in place with a note to affected clients. Instant updates across every client are a
core selling point, and an outdated procedure circulating in a safety video is a liability. Previous
versions are archived so it can be evidenced what was showing on a given date — a question that
will eventually be asked after an incident.

**D25.** Titles, durations, categories, descriptions, thumbnails and captions across the catalogue.
Unglamorous, and the most common reason a launch like this slips. Can run in parallel with
development rather than blocking it.

---

## Scope and success

| # | Decision | Answer | Type |
|---|---|---|---|
| D26 | What is the first release for? | A demo for three existing clients | Blocker |
| D27 | 90-day success measure | To be agreed with James | Open |
| D28 | Stop condition | To be agreed with James | Open |

**D26.** A demo needs polish and can fake parts of the back end; a system operated from day one
needs correct enforcement and can look rough. Attempting both at once is how a six-week build
becomes six months. Most other decisions in this log are production-grade, which is fine — treat
them as the plan for after the demo lands, not as work for the next six weeks.

**D27 and D28.** Recorded as decided, but both genuinely defer to a conversation with James. They
are not settled. A stated success threshold and a stated exit condition should exist before the
build starts, while both are easy to judge dispassionately.

*Worth noting on D28:* if licence conversations keep converting into custom production quotes, that
is useful information rather than failure — it would mean the catalogue works as a sales instrument
rather than a product.

---

## Still open

| Item | Reference | Needed by |
|---|---|---|
| Packaging wording: pack plus per-play, or pack with allowance and overage | spec 3.1 A | Before client conversations |
| What triggers "renewal approaching" — term end only, or allowance too | spec 3.1 B | Before notifications are built |
| One host or two — bind `/w/*` and `/e/*` directly to the Worker | spec open items | Before first poster printed |
| IP Australia trade mark search, classes 41, 9 and 42 | D6 | Before first poster printed |
| Manual usage report route for clients needing audit evidence | D22 | Before first client asks |
| Ninety-day success measure and stop condition | D27, D28 | Before build starts |

## Resolved during build

**Grace period.** Spec section 10 listed 14 days as a placeholder default. Set to **30 days**
ahead of stage two's billing logic (decided directly with Matt, 2026-08-01). `clients.grace_days`
defaults to 30 in the schema; still overridable per client via "Extend grace" (D14).
