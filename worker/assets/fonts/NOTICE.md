Poppins typeface — Copyright 2020 The Poppins Project Authors
(https://github.com/itfoundry/Poppins), licensed under the SIL Open Font License 1.1
(https://scripts.sil.org/OFL). Source: https://github.com/google/fonts/tree/main/ofl/poppins.

Bundled here (`Poppins-Regular.ttf`, `Poppins-SemiBold.ttf`, `Poppins-Bold.ttf`) because
`@resvg/resvg-wasm` has no access to system fonts in the Workers runtime — poster PNG text
rendering needs an explicit font buffer passed to `Resvg`'s `font.fontBuffers` option (see
`worker/src/render-png.ts`). The app's self-hosted woff2 Poppins files (admin/portal) can't be
reused here — resvg needs the static TTFs directly.

Family names embedded in each file (verified via each font's name table, since resvg does no
fuzzy matching): `Poppins-Regular.ttf` and `Poppins-Bold.ttf` share the family "Poppins"
(regular/bold subfamilies); `Poppins-SemiBold.ttf` is its own distinct family
"Poppins SemiBold".
