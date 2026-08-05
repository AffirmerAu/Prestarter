import type { Env } from "./env";

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
  html, body {
    margin: 0;
    padding: 0;
    background: #000;
    height: 100%;
    overflow: hidden; /* the page itself should never scroll — see #container sizing below */
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
    background: #000;
    overflow: hidden;
  }
  #container.fake-fullscreen {
    position: fixed;
    inset: 0;
    max-width: none;
    width: 100vw;
    height: 100vh;
    aspect-ratio: unset;
    z-index: 2147483647;
  }
  video {
    width: 100%;
    height: 100%;
    display: block;
    background: #000;
  }
  /* Watermark — spec section 7. Fixed values, not configurable. */
  #watermark {
    position: absolute;
    top: 16px;
    left: 16px;
    color: #fff;
    opacity: 0.3;
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    font-size: 13px;
    line-height: 1.3;
    text-shadow: 0 0 3px rgba(0,0,0,0.95), 0 1px 2px rgba(0,0,0,0.8);
    pointer-events: none;
    user-select: none;
    white-space: nowrap;
  }
  #controls {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: linear-gradient(transparent, rgba(0,0,0,0.6));
  }
  #controls button {
    background: none;
    border: none;
    color: #fff;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
  }
  #exitFakeFullscreen {
    display: none;
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 1;
    background: rgba(0,0,0,0.5);
    border: none;
    color: #fff;
    font-size: 16px;
    padding: 6px 10px;
    border-radius: 4px;
  }
  #container.fake-fullscreen #exitFakeFullscreen { display: block; }
  #denied {
    color: #fff;
    font-family: system-ui, sans-serif;
    padding: 24px;
    text-align: center;
  }
</style>
</head>
<body>
  <div id="container">
    <video id="video" playsinline></video>
    <div id="watermark"></div>
    <button id="exitFakeFullscreen" aria-label="Exit fullscreen">&times;</button>
    <div id="controls">
      <button id="playPause" aria-label="Play">&#9658;</button>
      <button id="fullscreen" aria-label="Fullscreen">&#9974;</button>
    </div>
  </div>
  <script>
  (function () {
    var VIDEO_ID = ${JSON.stringify(safeVideoId)};
    var ACCESS_KEY = ${JSON.stringify(safeAccessKey)};
    var LANG = ${JSON.stringify(safeLang)};
    var STREAM_CUSTOMER_CODE = ${JSON.stringify(streamCustomerCode)};

    var container = document.getElementById("container");
    var video = document.getElementById("video");
    var watermark = document.getElementById("watermark");
    var playPauseBtn = document.getElementById("playPause");
    var fullscreenBtn = document.getElementById("fullscreen");
    var exitFakeFullscreenBtn = document.getElementById("exitFakeFullscreen");

    var issuedAtMs = null;
    // Set from the token response — resolved server-side from the access key at request
    // time, not baked into the page, since which client this is isn't known until then.
    var markAs = "";

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

    function showDenied(message) {
      container.innerHTML = '<div id="denied">' + message + "</div>";
    }

    function buildManifestUrl(token) {
      return "https://customer-" + STREAM_CUSTOMER_CODE + ".cloudflarestream.com/" + token + "/manifest/video.m3u8";
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
    function attachSource(manifestUrl) {
      return import("https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js").then(function () {
        var Hls = window.Hls;
        if (Hls && Hls.isSupported()) {
          hlsInstance = new Hls();
          hlsInstance.loadSource(manifestUrl);
          hlsInstance.attachMedia(video);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          usingNativeHls = true;
          video.src = manifestUrl;
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

    async function start() {
      var minted = await fetchToken();
      issuedAtMs = minted.issuedAtMs;
      markAs = minted.markAs;
      await attachSource(buildManifestUrl(minted.token));
      scheduleRefresh(minted.expiresAtMs);
    }

    playPauseBtn.addEventListener("click", function () {
      if (video.paused) { video.play(); } else { video.pause(); }
    });
    video.addEventListener("play", function () { playPauseBtn.textContent = "⏸"; });
    video.addEventListener("pause", function () { playPauseBtn.textContent = "▶"; });
    video.addEventListener("timeupdate", updateWatermark);

    function supportsRealFullscreen() {
      return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    }

    function enterRealFullscreen() {
      if (container.requestFullscreen) return container.requestFullscreen();
      if (container.webkitRequestFullscreen) return container.webkitRequestFullscreen();
    }

    function exitRealFullscreen() {
      if (document.exitFullscreen) return document.exitFullscreen();
      if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    }

    fullscreenBtn.addEventListener("click", function () {
      // Fullscreen the CONTAINER, never the <video> element itself, so the
      // watermark (a sibling DOM node) keeps rendering above the video
      // once fullscreen (spec section 7 + amendment). Real Fullscreen API
      // works on desktop and iPadOS 16.4+; iPhone Safari does not support
      // requestFullscreen on non-video elements in shipping releases, so
      // it falls back to a CSS-only "fake fullscreen" that never leaves
      // the page DOM, which is why the watermark still shows there too.
      if (supportsRealFullscreen()) {
        enterRealFullscreen();
      } else {
        container.classList.add("fake-fullscreen");
      }
    });

    exitFakeFullscreenBtn.addEventListener("click", function () {
      container.classList.remove("fake-fullscreen");
    });

    start().catch(function (err) { console.error(err); });
  })();
  </script>
</body>
</html>`;
}
