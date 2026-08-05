import { Resvg, initWasm } from "@resvg/resvg-wasm";
import wasmModule from "@resvg/resvg-wasm/index_bg.wasm";
import interRegular from "../assets/fonts/Inter-Regular.ttf";
import interBold from "../assets/fonts/Inter-Bold.ttf";

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
// were all silently missing). Inter is bundled in assets/fonts/ for exactly this reason.
export async function svgToPng(svg: string, widthPx: number): Promise<Uint8Array> {
  await ensureWasm();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: widthPx },
    font: {
      fontBuffers: [new Uint8Array(interRegular), new Uint8Array(interBold)],
      loadSystemFonts: false,
      defaultFontFamily: "Inter",
    },
  });
  const rendered = resvg.render();
  return rendered.asPng();
}
