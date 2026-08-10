import { Resvg, initWasm } from "@resvg/resvg-wasm";
import wasmModule from "@resvg/resvg-wasm/index_bg.wasm";
import poppinsRegular from "../assets/fonts/Poppins-Regular.ttf";
import poppinsSemiBold from "../assets/fonts/Poppins-SemiBold.ttf";
import poppinsBold from "../assets/fonts/Poppins-Bold.ttf";

let wasmReady: Promise<void> | null = null;

function ensureWasm(): Promise<void> {
  if (!wasmReady) wasmReady = initWasm(wasmModule);
  return wasmReady;
}

// Renders an SVG string to PNG bytes at the given DPI (spec section 12: posters at 200 dpi
// minimum). `widthPx` is the target raster width; resvg scales the SVG's own viewBox to fit.
//
// resvg-wasm has no access to system fonts in the Workers runtime — without an explicit font
// buffer, every <text> element renders as nothing (confirmed empirically: the QR code and
// background rects came through fine, but the header, title, duration and provenance text
// were all silently missing). Poppins is bundled in assets/fonts/ for exactly this reason —
// static TTFs, not the app's woff2 files, which resvg can't read.
//
// resvg does no fuzzy font matching: Poppins-Regular.ttf and Poppins-Bold.ttf share the family
// name "Poppins" (regular/bold subfamilies, matched via font-weight), but Poppins-SemiBold.ttf
// is its own distinct family "Poppins SemiBold" (confirmed via each file's name table) — the
// SVG has to reference whichever exact family name a given weight actually uses.
export async function svgToPng(svg: string, widthPx: number): Promise<Uint8Array> {
  await ensureWasm();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: widthPx },
    font: {
      fontBuffers: [new Uint8Array(poppinsRegular), new Uint8Array(poppinsSemiBold), new Uint8Array(poppinsBold)],
      loadSystemFonts: false,
      defaultFontFamily: "Poppins",
    },
  });
  const rendered = resvg.render();
  return rendered.asPng();
}
