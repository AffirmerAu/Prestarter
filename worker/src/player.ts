import type { Env } from "./env";
import { POPPINS_400_WOFF2, POPPINS_600_WOFF2 } from "./fonts";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderPlayerPage(videoId: string, accessKey: string, lang: string | null, env: Env): string {
  const streamCustomerCode = escapeHtml(env.STREAM_CUSTOMER_CODE);
  const safeVideoId = escapeHtml(videoId);
  const safeAccessKey = escapeHtml(accessKey);
  const safeLang = lang ? escapeHtml(lang) : "";

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Prestarter player — stage one</title>
<style>
  /* Self-hosted Poppins (Latin subset, 400 + 600) — base64-embedded so the player makes no
     third-party font request, matching the same reasoning as the no-backdrop-filter rule
     below: this is loaded outdoors on low-end Android over mobile data. Sourced from
     worker/src/fonts.ts (the same @fontsource/poppins package admin/portal use). */
  @font-face {
    font-family: "Poppins";
    font-weight: 400;
    font-style: normal;
    font-display: swap;
    src: url(data:font/woff2;base64,${POPPINS_400_WOFF2}) format("woff2");
  }
  @font-face {
    font-family: "Poppins";
    font-weight: 600;
    font-style: normal;
    font-display: swap;
    src: url(data:font/woff2;base64,${POPPINS_600_WOFF2}) format("woff2");
  }
  :root {
    --ps-green: #1f9d57;
    --ps-ink: #101828;
    --ps-white-92: rgba(255, 255, 255, .92);
    --ps-white-62: rgba(255, 255, 255, .62);
    --ps-cell-bg: rgba(255, 255, 255, .06);
    --ps-cell-border: rgba(255, 255, 255, .30);
    --ps-focus: rgba(255, 255, 255, .60);
    --ps-radius: 12px;
    --ps-font: "Poppins", ui-sans-serif, system-ui, sans-serif;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--ps-ink);
    height: 100%;
    overflow: hidden; /* the page itself should never scroll — see #container sizing below */
  }
  @supports (height: 100dvh) {
    html, body { height: 100dvh; }
  }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #container {
    position: relative;
    /* Fit the largest 16:9 box that still fits inside the viewport (or iframe, which has
       its own vw/vh context) on both axes at once — a fixed max-width in px meant the box
       stopped growing past 960px even in a much bigger, genuinely-16:9 window, leaving a
       black gap below it rather than actually filling the frame. */
    width: min(100vw, calc(100vh * 16 / 9));
    height: min(100vh, calc(100vw * 9 / 16));
    aspect-ratio: 16 / 9;
    background: var(--ps-ink);
    overflow: hidden;
  }
  /* iOS Safari's vh is the "large" viewport — as if the address bar were already hidden —
     which is taller than what's actually visible whenever the bar IS showing (confirmed on a
     real iPhone in landscape: the plain-vh height computed here was taller than the visible
     area, so Safari's own chrome clipped the top and bottom of the container). dvh tracks the
     actually-visible viewport as that chrome shows/hides; vh above stays as the fallback for
     browsers that don't support dvh at all. */
  @supports (height: 100dvh) {
    #container {
      width: min(100dvw, calc(100dvh * 16 / 9));
      height: min(100dvh, calc(100dvw * 9 / 16));
    }
  }
  #container:focus { outline: none; }
  /* While the gate is open there's no video playing yet to preserve an aspect ratio for —
     on a tall/narrow portrait phone the strict 16:9 box becomes a ~200px strip, nowhere near
     enough room for the gate's header + grid + footer, and the content gets clipped by this
     element's own overflow:hidden (confirmed on a real iPhone, not just narrow-viewport
     testing). Expand to the full viewport only for this pre-play moment; shrinks back to the
     normal 16:9 box the instant playback actually starts (hideGate()). */
  #container.gate-open {
    width: 100vw;
    height: 100vh;
    aspect-ratio: unset;
  }
  @supports (height: 100dvh) {
    #container.gate-open { width: 100dvw; height: 100dvh; }
  }
  video {
    width: 100%;
    height: 100%;
    display: block;
    background: var(--ps-ink);
  }
  /* Watermark — spec section 7, position/size/content fixed for anti-piracy traceability.
     Font and colour substituted per the brand design spec (section 0's explicit exception to
     "do not change"); position, size logic and content are untouched. Note: substituting
     Poppins here does cost the watermark its monospace digit alignment as the clock ticks —
     a real, deliberate trade-off, not an oversight. */
  #watermark {
    position: absolute;
    top: 16px;
    left: 16px;
    color: var(--ps-white-62);
    font-family: var(--ps-font);
    font-size: 13px;
    line-height: 1.3;
    text-shadow: 0 0 3px rgba(0,0,0,0.95), 0 1px 2px rgba(0,0,0,0.8);
    pointer-events: none;
    user-select: none;
    white-space: nowrap;
  }
  #bigPlayButton {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: rgba(255,255,255,.94);
    border: none;
    color: var(--ps-green);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    transition: transform .15s ease-out;
  }
  #bigPlayButton:hover { transform: translate(-50%, -50%) scale(1.05); }
  #bigPlayButton:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--ps-focus);
  }
  @media (prefers-reduced-motion: reduce) {
    #bigPlayButton { transition: none; }
    #bigPlayButton:hover { transform: translate(-50%, -50%); }
  }
  #denied {
    color: #fff;
    font-family: var(--ps-font);
    padding: 24px;
    text-align: center;
  }

  /* Language gate — pre-play overlay (spec: "caption language gate"). Fills the player box,
     never position:fixed, so it stays correct inside the iframe-embed format too. */
  #gate {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: none;
    flex-direction: column;
    /* Solid wash, no gradient/blur — deliberate: this audience is disproportionately on
       low-end Android outdoors, where backdrop-filter has a real, visible paint cost. */
    background: rgba(0,0,0,0.6);
    font-family: var(--ps-font);
    opacity: 1;
    transition: opacity 0.2s ease;
  }
  #gate.gateDismissing { opacity: 0; }
  @media (prefers-reduced-motion: reduce) {
    #gate { transition: none; }
  }
  #gateHeader {
    flex: 0 0 auto;
    padding: 20px 16px 12px;
    text-align: center;
    color: #fff;
  }
  #gateIcon { font-size: 22px; margin-bottom: 4px; }
  #gateTitle {
    margin: 0 0 4px;
    font-size: 21px;
    line-height: 1.35;
    font-weight: 600;
    text-shadow: 0 0 3px rgba(0,0,0,0.95), 0 1px 2px rgba(0,0,0,0.8);
  }
  #gateSubtitle {
    margin: 0;
    font-size: 12px;
    opacity: 0.85;
    text-shadow: 0 0 3px rgba(0,0,0,0.95), 0 1px 2px rgba(0,0,0,0.8);
  }
  #gateGrid {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    padding: 4px 16px;
    align-content: start;
  }
  @media (min-width: 480px) {
    #gateGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  .gateCell {
    min-height: 48px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    background: var(--ps-cell-bg);
    border: 2px solid var(--ps-cell-border);
    border-radius: var(--ps-radius);
    color: #fff;
    font-size: 17px;
    line-height: 1.3;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: background-color .15s ease-out, border-color .15s ease-out;
  }
  @media (prefers-reduced-motion: reduce) {
    .gateCell { transition: none; }
  }
  /* Suggested (locale-matched) language — solid brand fill signals "primary", deliberately
     no badge (spec: "visibly the primary option without a badge"). White text on #1F9D57
     is 6.0:1, well over the 4.5:1 minimum. */
  .gateCell.suggested {
    background: var(--ps-green);
    color: #fff;
    border-color: var(--ps-green);
  }
  .gateCell:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--ps-focus);
  }
  #gateFooter {
    flex: 0 0 auto;
    border-top: 1px solid rgba(255,255,255,0.25);
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  }
  #gateSkip {
    width: 100%;
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: 10px;
    background: none;
    border: none;
    color: #fff;
    font-size: 14px;
    cursor: pointer;
    padding: 4px 0;
  }
  #gateSkip:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--ps-focus);
  }
  .gateSkipCircle {
    flex: 0 0 auto;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.85);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Returning-viewer chip — brief, dismissible, non-modal (spec state 3). */
  #gateChip {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 4;
    display: none;
    align-items: center;
    gap: 8px;
    background: rgba(255,255,255,.12);
    border: 1px solid rgba(255,255,255,.24);
    border-radius: 999px;
    padding: 8px 14px;
    font-family: var(--ps-font);
    font-size: 13.5px;
    color: var(--ps-white-92);
    max-width: calc(100% - 32px);
  }
  #gateChipText {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #gateChangeBtn {
    flex: 0 0 auto;
    background: none;
    border: none;
    color: var(--ps-green);
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    padding: 4px;
    text-decoration: underline;
  }
  #gateChangeBtn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--ps-focus);
  }
</style>
</head>
<body>
  <div id="container" tabindex="-1">
    <video id="video" playsinline></video>
    <div id="watermark"></div>
    <button id="bigPlayButton" aria-label="Play">
      <svg width="18" height="20" viewBox="0 0 18 20" fill="currentColor" aria-hidden="true"><path d="M1 1L17 10L1 19V1Z" stroke-linejoin="round"/></svg>
    </button>
    <div id="gate" role="dialog" aria-modal="true" aria-labelledby="gateTitle">
      <div id="gateHeader">
        <div id="gateIcon" aria-hidden="true">&#127760;</div>
        <h2 id="gateTitle">Select your language</h2>
        <p id="gateSubtitle">Seleccione su idioma &middot; &#36873;&#25321;&#35821;&#35328; &middot; &#2349;&#2366;&#2359;&#2366; &#2330;&#2369;&#2344;&#2375;&#2306;</p>
      </div>
      <div id="gateGrid" role="group" aria-label="Available languages"></div>
      <div id="gateFooter">
        <button id="gateSkip" type="button">
          <span class="gateSkipCircle" aria-hidden="true">
            <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><path d="M1 1L13 8L1 15V1Z" stroke-linejoin="round"/></svg>
          </span>
          <span>Skip &mdash; play without captions</span>
        </button>
      </div>
    </div>
    <div id="gateChip" role="status">
      <span id="gateChipText"></span>
      <button id="gateChangeBtn" type="button">change</button>
    </div>
  </div>
  <script>
  (function () {
    var VIDEO_ID = ${JSON.stringify(safeVideoId)};
    var ACCESS_KEY = ${JSON.stringify(safeAccessKey)};
    var LANG = ${JSON.stringify(safeLang)};
    var STREAM_CUSTOMER_CODE = ${JSON.stringify(streamCustomerCode)};
    var STORAGE_KEY = "prestarter:captionLang";

    var container = document.getElementById("container");
    var video = document.getElementById("video");
    var watermark = document.getElementById("watermark");
    var bigPlayButton = document.getElementById("bigPlayButton");
    var gate = document.getElementById("gate");
    var gateGrid = document.getElementById("gateGrid");
    var gateSkip = document.getElementById("gateSkip");
    var gateChip = document.getElementById("gateChip");
    var gateChipText = document.getElementById("gateChipText");
    var gateChangeBtn = document.getElementById("gateChangeBtn");

    var availableLanguages = []; // [{languageTag, labelNative, isDefault}], reviewed only
    var currentCaptionLang = null; // BCP-47 tag, or null for captions off
    var started = false; // true once beginPlayback() has been invoked (idempotent past that)

    var issuedAtMs = null;
    // Set from the token response — resolved server-side from the access key at request
    // time, not baked into the page, since which client this is isn't known until then.
    var markAs = "";

    // Endonyms, not English names — a viewer who needs the Mandarin track cannot necessarily
    // read the word "Chinese". Keyed by BCP-47 primary subtag. Intl.DisplayNames is only a
    // fallback for anything not in this table, logged so the table can grow.
    var ENDONYMS = {
      en: "English", es: "Espa\\u00f1ol", zh: "\\u4e2d\\u6587", ko: "\\ud55c\\uad6d\\uc5b4",
      tl: "Tagalog", vi: "Ti\\u1ebfng Vi\\u1ec7t", hi: "\\u0939\\u093f\\u0928\\u094d\\u0926\\u0940",
      ar: "\\u0627\\u0644\\u0639\\u0631\\u0628\\u064a\\u0629", pt: "Portugu\\u00eas",
      ne: "\\u0928\\u0947\\u092a\\u093e\\u0932\\u0940", pa: "\\u0a2a\\u0a70\\u0a1c\\u0a3e\\u0a2c\\u0a40",
      id: "Bahasa Indonesia",
    };
    function endonymFor(tag) {
      var base = (tag || "").split("-")[0].toLowerCase();
      if (ENDONYMS[base]) return ENDONYMS[base];
      try {
        var dn = new Intl.DisplayNames([navigator.language || "en"], { type: "language" });
        var name = dn.of(tag);
        if (name && name.toLowerCase() !== base) {
          console.warn('[prestarter] no endonym mapped for "' + tag + '" \\u2014 using Intl.DisplayNames fallback "' + name + '". Add it to the ENDONYMS table in player.ts.');
          return name;
        }
      } catch (e) {}
      console.warn('[prestarter] no endonym or Intl.DisplayNames result for language tag "' + tag + '".');
      return tag;
    }

    // Wrapped in try/catch: this player also loads inside a client's own cross-origin
    // <iframe> embed (the portal's "Iframe embed" link format), where some browsers
    // partition or block third-party storage entirely. Falling back to "no persisted
    // preference" there is fine; throwing and breaking the whole player is not.
    function readStoredLang() {
      try { return window.localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }
    function writeStoredLang(value) {
      try { window.localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
    }

    function pad(n) { return n < 10 ? "0" + n : "" + n; }

    function formatClock(ms) {
      var d = new Date(ms);
      return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
    }

    function updateWatermark() {
      if (issuedAtMs === null) return;
      // Clock derives from token issue time plus playback position, never
      // the device clock (spec section 7) — this cannot be falsified by
      // changing the device's date/time.
      var displayMs = issuedAtMs + video.currentTime * 1000;
      watermark.textContent = markAs + " · " + formatClock(displayMs);
    }

    async function fetchToken() {
      var qs = "videoId=" + encodeURIComponent(VIDEO_ID) + "&k=" + encodeURIComponent(ACCESS_KEY);
      if (LANG) qs += "&lang=" + encodeURIComponent(LANG);
      var res = await fetch("/api/token?" + qs);
      if (!res.ok) {
        var body = await res.json().catch(function () { return {}; });
        showDenied(body.message || "This licence is not currently active, please contact your safety team.");
        throw new Error("token request failed");
      }
      return res.json();
    }

    // Read-only: populates the gate without minting a Stream token or recording a play event
    // (see worker/src/index.ts handleLanguagesRequest) — the real /api/token call, and the
    // play event that comes with it, only happens once the viewer actually taps something.
    async function fetchLanguages() {
      try {
        var qs = "videoId=" + encodeURIComponent(VIDEO_ID) + "&k=" + encodeURIComponent(ACCESS_KEY);
        var res = await fetch("/api/languages?" + qs);
        if (!res.ok) return [];
        var body = await res.json();
        return body.languages || [];
      } catch (e) {
        // Not blocking — the real entitlement check still happens in full when playback is
        // actually attempted (fetchToken, above). A bad/expired key just won't show a gate.
        console.error("[prestarter] failed to load caption languages", e);
        return [];
      }
    }

    function showDenied(message) {
      container.innerHTML = '<div id="denied">' + message + "</div>";
    }

    function buildManifestUrl(token) {
      return "https://customer-" + STREAM_CUSTOMER_CODE + ".cloudflarestream.com/" + token + "/manifest/video.m3u8";
    }

    // Spec section 8 selection order: ?lang= link param, then browser/device locale, then
    // the track flagged is_default, then no captions. Used both for the <2-language "nothing
    // to gate on" case and to re-derive a sane selection if resolution is ever re-run.
    function pickInitialLanguage(languages) {
      if (!languages.length) return null;
      if (LANG) {
        var exact = languages.filter(function (l) { return l.languageTag === LANG; })[0];
        if (exact) return exact.languageTag;
      }
      var nav = (navigator.language || "").toLowerCase();
      var navPrimary = nav.split("-")[0];
      var localeMatch = languages.filter(function (l) {
        var tag = l.languageTag.toLowerCase();
        return tag === nav || tag.split("-")[0] === navPrimary;
      })[0];
      if (localeMatch) return localeMatch.languageTag;
      var def = languages.filter(function (l) { return l.isDefault; })[0];
      return def ? def.languageTag : null;
    }

    // Locale match ONLY (no ?lang=, no is_default) — used purely to decide which gate cell
    // gets the "suggested" treatment. Never auto-skips the gate on its own.
    function computeSuggestedTag(languages) {
      var nav = (navigator.language || "").toLowerCase();
      var navPrimary = nav.split("-")[0];
      var match = languages.filter(function (l) {
        var tag = l.languageTag.toLowerCase();
        return tag === nav || tag.split("-")[0] === navPrimary;
      })[0];
      return match ? match.languageTag : null;
    }

    // Cloudflare Stream muxes every uploaded caption straight into the HLS manifest as a
    // subtitle rendition, keyed by the same language tag it was uploaded under (spec section
    // 8) — so "selecting" a caption is just matching that tag against whichever track-listing
    // API the active playback path exposes, not fetching or rendering anything ourselves.
    // Registered as a persistent listener (not .once) on both paths below, since a token
    // refresh reloads the manifest and re-lists tracks, which would otherwise silently drop
    // the viewer's choice mid-playback.
    function applyCaptionSelection() {
      if (hlsInstance && hlsInstance.subtitleTracks) {
        var idx = -1;
        for (var i = 0; i < hlsInstance.subtitleTracks.length; i++) {
          var t = hlsInstance.subtitleTracks[i];
          if (currentCaptionLang && (t.lang || "").toLowerCase() === currentCaptionLang.toLowerCase()) {
            idx = i;
            break;
          }
        }
        hlsInstance.subtitleTrack = idx;
      } else if (video.textTracks) {
        for (var j = 0; j < video.textTracks.length; j++) {
          var track = video.textTracks[j];
          var matches = !!currentCaptionLang && (track.language || "").toLowerCase() === currentCaptionLang.toLowerCase();
          track.mode = matches ? "showing" : "hidden";
        }
      }
    }

    var hlsInstance = null; // set once, reused across refreshes
    var usingNativeHls = false;

    // hls.js (MSE-based) is preferred whenever it's supported, with native
    // <video>.src as the fallback — not the other way around. Checking
    // video.canPlayType("application/vnd.apple.mpegurl") first and trusting
    // a truthy result is a known footgun: some Chromium builds report
    // support there without actually being able to demux HLS, so playback
    // fails with MEDIA_ERR_SRC_NOT_SUPPORTED. Hls.isSupported() (an MSE
    // capability check) is the reliable signal; native HLS is really only
    // needed for Safari/iOS, where Hls.isSupported() is false anyway.
    // If captions fail to load some other way, this still isn't allowed to block playback —
    // errors here fall through to showDenied only for genuine source failures, never silently
    // hang on a caption problem.
    function attachSource(manifestUrl) {
      return import("https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js").then(function () {
        var Hls = window.Hls;
        if (Hls && Hls.isSupported()) {
          hlsInstance = new Hls();
          hlsInstance.loadSource(manifestUrl);
          hlsInstance.attachMedia(video);
          hlsInstance.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, applyCaptionSelection);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          usingNativeHls = true;
          video.src = manifestUrl;
          video.textTracks.addEventListener("addtrack", applyCaptionSelection);
        } else {
          showDenied("This browser cannot play this video.");
        }
      });
    }

    // Cloudflare re-validates the token's exp on every request — not just
    // the initial manifest fetch, but every variant playlist and every
    // individual segment (confirmed empirically against a live account:
    // a segment URL that worked before exp returns 401 if re-requested
    // after, even mid-session). Segment URLs also freeze in the same exp
    // at the moment the manifest is generated, so swapping in a bare new
    // token isn't enough — a fresh manifest fetch (new segment URLs, new
    // embedded exp) is needed before the old one lapses, well ahead of the
    // 120s deadline to leave room for the round trip and re-buffering.
    var REFRESH_MARGIN_MS = 20000;

    function reloadSource(manifestUrl) {
      var resumeAt = video.currentTime;
      var wasPlaying = !video.paused;
      if (usingNativeHls) {
        video.addEventListener(
          "loadedmetadata",
          function onLoaded() {
            video.removeEventListener("loadedmetadata", onLoaded);
            video.currentTime = resumeAt;
            if (wasPlaying) video.play();
          },
          { once: true },
        );
        video.src = manifestUrl;
      } else if (hlsInstance) {
        hlsInstance.once(window.Hls.Events.MANIFEST_PARSED, function () {
          video.currentTime = resumeAt;
          if (wasPlaying) video.play();
        });
        hlsInstance.loadSource(manifestUrl);
      }
    }

    function scheduleRefresh(expiresAtMs) {
      var delay = expiresAtMs - Date.now() - REFRESH_MARGIN_MS;
      if (delay < 0) delay = 0;
      setTimeout(function () {
        fetchToken()
          .then(function (minted) {
            issuedAtMs = minted.issuedAtMs;
            markAs = minted.markAs;
            reloadSource(buildManifestUrl(minted.token));
            scheduleRefresh(minted.expiresAtMs);
          })
          .catch(function (err) {
            console.error("token refresh failed", err);
          });
      }, delay);
    }

    // Single entry point for actually starting playback — called from the gate (language
    // cell or skip), the returning-viewer play button, or the plain play button. Mints the
    // real Stream token and records the play event (spec section 6 step 4) here, and only
    // here, never earlier — see the /api/languages split above.
    function beginPlayback() {
      if (started) return;
      started = true;
      bigPlayButton.style.display = "none";
      fetchToken()
        .then(function (minted) {
          issuedAtMs = minted.issuedAtMs;
          markAs = minted.markAs;
          return attachSource(buildManifestUrl(minted.token)).then(function () {
            applyCaptionSelection();
            scheduleRefresh(minted.expiresAtMs);
            return video.play();
          });
        })
        .catch(function (err) {
          // fetchToken() already renders #denied on a real entitlement failure (container's
          // innerHTML is replaced, so the lines below become harmless no-ops on detached
          // nodes). A rejected video.play() is different — autoplay policy, not a denial —
          // so let the viewer just tap again.
          console.error(err);
          started = false;
          bigPlayButton.style.display = "flex";
        });
    }

    // --- Language gate -------------------------------------------------------------------

    var lastFocused = null;
    var focusTrapHandler = null;

    function trapFocus(el) {
      focusTrapHandler = function (e) {
        if (e.key !== "Tab") return;
        var focusable = el.querySelectorAll("button");
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      };
      document.addEventListener("keydown", focusTrapHandler);
    }
    function releaseFocusTrap() {
      if (focusTrapHandler) {
        document.removeEventListener("keydown", focusTrapHandler);
        focusTrapHandler = null;
      }
    }

    function chooseLanguage(tag) {
      currentCaptionLang = tag;
      writeStoredLang(tag);
      hideGate();
      beginPlayback();
    }

    function showGate(languages) {
      var suggested = computeSuggestedTag(languages);
      var ordered = languages.slice();
      if (suggested) {
        ordered.sort(function (a, b) {
          if (a.languageTag === suggested) return -1;
          if (b.languageTag === suggested) return 1;
          return 0;
        });
      }
      gateGrid.innerHTML = "";
      ordered.forEach(function (l) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "gateCell" + (l.languageTag === suggested ? " suggested" : "");
        var span = document.createElement("span");
        span.lang = l.languageTag;
        span.textContent = endonymFor(l.languageTag);
        btn.appendChild(span);
        btn.addEventListener("click", function () { chooseLanguage(l.languageTag); });
        gateGrid.appendChild(btn);
      });

      hideChip();
      bigPlayButton.style.display = "none";
      gate.classList.remove("gateDismissing");
      gate.style.display = "flex";
      container.classList.add("gate-open");
      lastFocused = document.activeElement;
      trapFocus(gate);
      var first = gateGrid.querySelector("button");
      (first || gateSkip).focus();
    }

    function hideGate() {
      // Shrink the container back to its normal 16:9 box immediately, not deferred to the
      // end of the fade — gate is inset:0 to container, so it shrinks (and fades) together;
      // waiting would instead let the plain <video> element flash at full-viewport size
      // behind the still-fading scrim for 200ms before snapping down.
      container.classList.remove("gate-open");
      var prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var finish = function () {
        gate.style.display = "none";
        gate.classList.remove("gateDismissing");
        releaseFocusTrap();
        // Spec: "focus moved to the player on dismiss" — the container is always a valid,
        // stable landing spot regardless of what state playback ends up in a moment later.
        container.focus();
      };
      if (prefersReduced) {
        finish();
      } else {
        gate.classList.add("gateDismissing");
        setTimeout(finish, 200);
      }
    }

    gateSkip.addEventListener("click", function () {
      currentCaptionLang = null;
      writeStoredLang("off");
      hideGate();
      beginPlayback();
    });

    // --- Returning-viewer chip ------------------------------------------------------------

    var chipTimer = null;

    function showChip(tag) {
      gateChipText.textContent = "Captions: " + (tag ? endonymFor(tag) : "Off") + " ·";
      gateChip.style.display = "flex";
      clearTimeout(chipTimer);
      chipTimer = setTimeout(hideChip, 4000);
    }
    function hideChip() {
      clearTimeout(chipTimer);
      gateChip.style.display = "none";
    }
    gateChangeBtn.addEventListener("click", function () {
      hideChip();
      showGate(availableLanguages);
    });

    // --- Initial resolution (spec: language resolution order) ----------------------------

    function resolveInitialState(languages) {
      var availableTags = languages.map(function (l) { return l.languageTag; });

      // 1. ?lang= — present and valid skips the gate entirely (state 3).
      if (LANG && availableTags.indexOf(LANG) !== -1) {
        return { state: "chip", lang: LANG };
      }
      // An unknown/unavailable ?lang= falls through to normal resolution below, not an error.

      // 2. Stored preference (including the persisted "off" choice).
      var stored = readStoredLang();
      if (stored === "off") {
        return { state: "chip", lang: null };
      }
      if (stored && availableTags.indexOf(stored) !== -1) {
        return { state: "chip", lang: stored };
      }

      // Nothing meaningful to gate on with 0 or 1 languages — still apply the locale/
      // is_default heuristic quietly, but there's no real choice to surface, so no gate and
      // no chip either (there's nothing a "change" link would meaningfully undo).
      if (languages.length < 2) {
        return { state: "plain", lang: pickInitialLanguage(languages) };
      }

      // 3. No skip condition met — show the gate. Locale match (if any) only affects
      // ordering/styling inside showGate(), it does not bypass the gate on its own.
      return { state: "gate", lang: null };
    }

    async function init() {
      availableLanguages = await fetchLanguages();
      var resolved = resolveInitialState(availableLanguages);
      currentCaptionLang = resolved.lang;

      if (resolved.state === "gate") {
        showGate(availableLanguages);
      } else if (resolved.state === "chip") {
        showChip(currentCaptionLang);
      }
      // "plain": nothing extra to show — the default-visible big play button is enough.
    }

    // --- Playback controls ------------------------------------------------------------------
    // No persistent control bar — the big play button handles the first tap and every
    // resume after a pause; tapping the video itself (once playback has actually begun)
    // toggles play/pause the same way. No fullscreen, no mid-playback CC menu: the language
    // gate is the only caption-selection point now.

    function togglePlayback() {
      if (!started) { beginPlayback(); return; }
      if (video.paused) { video.play(); } else { video.pause(); }
    }
    bigPlayButton.addEventListener("click", togglePlayback);
    video.addEventListener("click", togglePlayback);
    video.addEventListener("play", function () {
      bigPlayButton.style.display = "none";
      hideChip();
    });
    video.addEventListener("pause", function () {
      bigPlayButton.style.display = "flex";
    });
    video.addEventListener("timeupdate", updateWatermark);

    init().catch(function (err) { console.error(err); });
  })();
  </script>
</body>
</html>`;
}
