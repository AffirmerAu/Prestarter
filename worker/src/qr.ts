import * as QRCode from "qrcode";

// Spec section 12: pure black on pure white, four-module quiet zone, no tinting, rounding,
// or embedded logo — these reduce scan reliability on laminated signage. We only use the
// `qrcode` library for the encoding math (Reed-Solomon etc.); the actual markup is built by
// hand here so there's no risk of the library's own SVG renderer adding styling we don't want.
const QUIET_ZONE_MODULES = 4;

export function encodeQr(text: string): { size: number; isDark: (row: number, col: number) => boolean } {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const { modules } = qr;
  return {
    size: modules.size,
    isDark: (row: number, col: number) => !!modules.data[row * modules.size + col],
  };
}

export function qrToSvg(text: string, pixelsPerModule = 8): string {
  const { size, isDark } = encodeQr(text);
  const totalModules = size + QUIET_ZONE_MODULES * 2;
  const dimension = totalModules * pixelsPerModule;

  let path = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!isDark(row, col)) continue;
      const x = (col + QUIET_ZONE_MODULES) * pixelsPerModule;
      const y = (row + QUIET_ZONE_MODULES) * pixelsPerModule;
      path += `M${x},${y}h${pixelsPerModule}v${pixelsPerModule}h-${pixelsPerModule}z`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" width="${dimension}" height="${dimension}" shape-rendering="crispEdges">` +
    `<rect width="${dimension}" height="${dimension}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#000000"/>` +
    `</svg>`
  );
}
