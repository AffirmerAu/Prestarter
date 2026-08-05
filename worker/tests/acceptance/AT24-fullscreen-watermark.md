# AT24 (new) — watermark survives fullscreen

Not in spec section 18's original list of 23. Added per amendment: the player fullscreens the
*container* div, never the `<video>` element, specifically so the watermark (a sibling DOM node)
keeps rendering on top once fullscreen. This test exists to prove that actually holds, on both the
path that works and the path that needs a fallback.

## Background

- Desktop browsers (Chrome, Edge, Firefox, Safari) and iPadOS 16.4+ support
  `Element.requestFullscreen()` on an arbitrary element. Fullscreening `#container` makes its
  entire subtree — including the watermark div — render inside the fullscreen viewport, per the
  Fullscreen API spec. No separate compositing step needed.
- iPhone Safari does **not** support `requestFullscreen()` on a non-video element in shipping
  releases (tracked at [WebKit bug 212934](https://www2.webkit.org/show_bug.cgi?id=212934) since
  2020, still open as of this build). The only reliable native fullscreen path there is
  `video.webkitEnterFullscreen()`, which is video-element-only and hands the whole screen to iOS's
  own player chrome — nothing can render above it. So on iPhone specifically, the player falls back
  to a CSS-only "fake fullscreen" (`position: fixed; inset: 0` on the container) that never leaves
  the page DOM, which is why the watermark still shows there too.

## Fixture

`worker/tests/acceptance/fixtures/fullscreen-watermark.html` — same fullscreen logic and watermark
CSS as `worker/src/player.ts`, pointed at a public placeholder video instead of a real Cloudflare
Stream manifest, so this test doesn't need Stream credentials. Serve it with any static file
server and open it in a browser.

## Steps — desktop (Chrome, Edge, Firefox, desktop Safari)

1. Serve the fixture and open it.
2. Click the fullscreen button.
3. Confirm: the container fills the viewport, the watermark text is still visible top left, and
   `document.fullscreenElement.id === "container"` (not `"video"`).
4. Confirm the watermark does not overlap the bottom control bar.

**Verified in this session** against a Chromium-based browser: clicking fullscreen correctly calls
`container.requestFullscreen()` (confirmed via the on-page status readout and by reading the
handler source — it never calls `video.requestFullscreen()`). The automated browser tool used for
this check runs without a real display and Chrome does not complete the actual fullscreen
transition there (`document.fullscreenElement` stays `null` after the call, with no rejection or
error), so the on-screen pixel result — watermark literally visible while the frame occupies the
whole screen — could not be captured from this environment. That's a limitation of the sandboxed
tool, not something in question about the code: once `requestFullscreen()` succeeds on an element,
its whole subtree renders in the fullscreen viewport by definition, which is exactly why the
watermark (a child of `#container`) is unaffected. **Recommend one manual pass in a real desktop
browser window before signing this off**, since "the API was called correctly" is not quite the
same as "a human saw it work."

## Steps — iPhone Safari (manual only — no automated iOS environment available)

1. Serve the fixture somewhere reachable from an iPhone (or use a simulator with a real Safari
   build, not just WebKit's desktop debug build, since fullscreen availability differs).
2. Open it in Safari on the iPhone, tap the fullscreen button.
3. Confirm `document.fullscreenEnabled` is falsy on that device/OS version (expected — this is what
   drives the fallback branch) and that the fixture switches to the CSS fake-fullscreen path: the
   container should expand to cover the viewport via CSS, the watermark stays visible, and the ×
   close button (top right) exits back to normal layout.
4. Note the OS/Safari version tested — Apple has been rolling out real `requestFullscreen()`
   support behind flags in recent WebKit betas, so this could change in a future iOS release and
   the fallback branch would then be unnecessary for newer devices while still needed for older
   ones in the field.
5. Also check: rotating the device while in fake-fullscreen, and backgrounding/returning to the tab
   (Safari has been known to reset video state on backgrounding).

This step needs a physical device or a real Safari simulator — flagging it rather than claiming a
result I can't produce.
