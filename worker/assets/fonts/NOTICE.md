Inter typeface — Copyright 2020 The Inter Project Authors, licensed under the SIL Open Font
License 1.1 (https://scripts.sil.org/OFL). Source: https://github.com/rsms/inter, v4.1.

Bundled here (`Inter-Regular.ttf`, `Inter-Bold.ttf`) because `@resvg/resvg-wasm` has no access
to system fonts in the Workers runtime — poster/QR text rendering needs an explicit font
buffer passed to `Resvg`'s `font.fontBuffers` option (see `worker/src/render-png.ts`).
