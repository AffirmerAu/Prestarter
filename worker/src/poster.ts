import { encodeQr } from "./qr";
import { AFFIRMER_LOGO_HORIZONTAL_PNG_BASE64, AFFIRMER_LOGO_HORIZONTAL_ASPECT } from "./poster-assets";

// A3 portrait, spec section 12 / docs/design-brief-poster.md section 0: fixed 1122 x 1587
// coordinate space (1 unit = 0.2646mm), not a reflowing page. PNG export renders at 200dpi
// (2339 x 3307px, see admin-export.ts) from this same SVG.
const PAGE_W = 1122;
const PAGE_H = 1587;
const MARGIN = 64;

const HEADER_H = 258;
const ACCENT_H = 6;

const COLS = 3;
const ROWS = 3;
const TILES_PER_SHEET = COLS * ROWS;
const TILE_W = 312;
const TILE_H = 372;
const TILE_GAP_X = 29;
const TILE_GAP_Y = 26;
const GRID_Y = 296;
const QR_SIZE = 224;

const FOOTER_DIVIDER_Y = 1502;

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Naive wrap to at most 2 lines within a given pixel width, ellipsising a third+ line rather
// than pushing the QR down — tile height is fixed to keep the grid pitch identical to the QR
// module pitch spec below.
function wrapTitle(title: string, maxWidth: number, fontSize: number): [string, string?] {
  const avgCharWidth = fontSize * 0.56;
  const maxChars = Math.max(4, Math.floor(maxWidth / avgCharWidth));
  if (title.length <= maxChars) return [title];

  const words = title.split(/\s+/);
  let line1 = "";
  let i = 0;
  while (i < words.length && (line1 + (line1 ? " " : "") + words[i]).length <= maxChars) {
    line1 += (line1 ? " " : "") + words[i];
    i++;
  }
  if (i === 0) {
    line1 = title.slice(0, maxChars);
    return [line1, title.length > maxChars ? "…" : undefined];
  }
  let line2 = words.slice(i).join(" ");
  if (line2.length > maxChars) line2 = line2.slice(0, maxChars - 1).trimEnd() + "…";
  return [line1, line2 || undefined];
}

// Draws QR modules as a nested <svg> in module coordinates rather than absolute page units —
// docs/design-brief-poster.md section 4: module pitch (5.46 units) isn't an integer, so
// per-module absolute-unit rects rasterise unevenly; a shared subpixel phase via viewBox
// scaling keeps every module crisp at any print/raster scale, and one <path> beats ~1,000
// <rect> elements for both file size and resvg time.
function qrTile(text: string, x: number, y: number, sizePx: number): string {
  const { size, isDark } = encodeQr(text);
  const quiet = 4;
  const totalModules = size + quiet * 2;
  let path = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!isDark(row, col)) continue;
      const mx = col + quiet;
      const my = row + quiet;
      path += `M${mx} ${my}h1v1h-1z `;
    }
  }
  return (
    `<svg x="${x}" y="${y}" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${totalModules} ${totalModules}" shape-rendering="crispEdges">` +
    `<rect width="${totalModules}" height="${totalModules}" fill="#FFFFFF"/>` +
    `<path fill="#000000" d="${path.trim()}"/>` +
    `</svg>`
  );
}

// docs/design-brief-poster.md section 5 — inline paths, nothing fetched at render time.
// Natural box 64x56; on the white header the two placeholder fills become brand green and
// the tick stays Affirmer blue.
function prestarterMark(x: number, y: number, heightPx: number): string {
  const scale = heightPx / 56;
  return (
    `<g transform="translate(${x},${y}) scale(${scale})">` +
    `<rect x="4" y="14" width="44" height="36" rx="8" fill="none" stroke="#1F9D57" stroke-width="6"/>` +
    `<path d="M20 23 L34 32 L20 41 Z" fill="#1F9D57"/>` +
    `<circle cx="52" cy="12" r="10.4" fill="#1F9D57"/>` +
    `<path transform="translate(37.9,-1.6) scale(0.4)" d="M19 35 C21 31 25.5 31 27.5 35 L31 41 C36 32 42 24 46.5 19.5 C49.5 16.5 53.5 19.5 51.5 23.5 C46 31 39.5 41 34.5 48.5 C32.5 51.5 28.5 51.5 26.5 47.5 C24 43 21.5 39 19 35 Z" fill="#3385D9"/>` +
    `</g>`
  );
}

function affirmerLockup(rightX: number, y: number, heightPx: number): string {
  const widthPx = heightPx * AFFIRMER_LOGO_HORIZONTAL_ASPECT;
  const x = rightX - widthPx;
  return `<image x="${x}" y="${y}" width="${widthPx}" height="${heightPx}" href="data:image/png;base64,${AFFIRMER_LOGO_HORIZONTAL_PNG_BASE64}"/>`;
}

export interface PosterVideo {
  title: string;
  durationSeconds: number;
  url: string; // fully-built https://.../w/{video_id}?k={access_key}&src=poster[&lang=]
}

function buildSheet(clientName: string, videos: PosterVideo[], sheetLabel?: string): string {
  let tiles = "";
  videos.forEach((v, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = MARGIN + col * (TILE_W + TILE_GAP_X);
    const y = GRID_Y + row * (TILE_H + TILE_GAP_Y);
    const qrX = x + (TILE_W - QR_SIZE) / 2;
    const qrY = y + 24;

    const [line1, line2] = wrapTitle(v.title, TILE_W - 48, 22);
    const titleY1 = qrY + QR_SIZE + 16 + 22;
    const titleY2 = titleY1 + 27.5;

    tiles +=
      `<rect x="${x}" y="${y}" width="${TILE_W}" height="${TILE_H}" rx="16" fill="#FFFFFF" stroke="#1F9D57" stroke-width="1.5"/>` +
      qrTile(v.url, qrX, qrY, QR_SIZE) +
      `<text x="${x + TILE_W / 2}" y="${titleY1}" text-anchor="middle" font-family="Poppins SemiBold" font-size="22" fill="#101828">${escapeXml(line1)}</text>` +
      (line2 ? `<text x="${x + TILE_W / 2}" y="${titleY2}" text-anchor="middle" font-family="Poppins SemiBold" font-size="22" fill="#101828">${escapeXml(line2)}</text>` : "");
  });

  const pillW = 320;
  const pillH = 45;
  const pillX = PAGE_W - MARGIN - pillW;
  const pillY = 180;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="420mm" viewBox="0 0 ${PAGE_W} ${PAGE_H}">` +
    `<rect width="${PAGE_W}" height="${PAGE_H}" fill="#FFFFFF"/>` +
    // Header band
    `<rect width="${PAGE_W}" height="${HEADER_H}" fill="#FFFFFF"/>` +
    `<rect y="${HEADER_H}" width="${PAGE_W}" height="${ACCENT_H}" fill="#1F9D57"/>` +
    prestarterMark(MARGIN, 32, 48) +
    `<text x="${MARGIN + 54.9 + 16}" y="68" font-family="Poppins" font-weight="700" font-size="38" letter-spacing="-0.95" fill="#101828">Prestarter</text>` +
    affirmerLockup(PAGE_W - MARGIN, 39, 34) +
    `<text x="${MARGIN}" y="158" font-family="Poppins" font-weight="700" font-size="56" letter-spacing="-1.68" fill="#101828">Workplace Safety Training</text>` +
    `<text x="${MARGIN}" y="214" font-family="Poppins SemiBold" font-size="34" letter-spacing="-0.51" fill="#475467">${escapeXml(clientName)}</text>` +
    `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="25" fill="#1F9D57"/>` +
    `<text x="${pillX + pillW / 2}" y="${pillY + pillH / 2 + 9}" text-anchor="middle" font-family="Poppins SemiBold" font-size="25" fill="#FFFFFF">Scan a code to watch</text>` +
    tiles +
    // Footer
    `<rect x="${MARGIN}" y="${FOOTER_DIVIDER_Y}" width="${PAGE_W - MARGIN * 2}" height="1" fill="#E4E7EC"/>` +
    `<text x="${MARGIN}" y="${FOOTER_DIVIDER_Y + 32}" font-family="Poppins" font-size="17" fill="#667085">Licensed to ${escapeXml(clientName)} — not for distribution outside this organisation.${sheetLabel ? ` ${escapeXml(sheetLabel)}` : ""}</text>` +
    `<text x="${PAGE_W - MARGIN}" y="${FOOTER_DIVIDER_Y + 32}" text-anchor="end" font-family="Poppins SemiBold" font-size="19" fill="#101828">prestarter.au</text>` +
    `</svg>`
  );
}

// Nine tiles per sheet (docs/design-brief-poster.md section 3) — module size never shrinks to
// fit more on. A client licensed for more than nine videos needs a continuation sheet, which
// isn't built yet (the admin/portal export endpoints return a single file); for now the sheet
// is capped at the first nine so the layout never overflows the page. Flagged as follow-up.
export function buildPosterSvg(clientName: string, videos: PosterVideo[]): string {
  return buildSheet(clientName, videos.slice(0, TILES_PER_SHEET));
}
