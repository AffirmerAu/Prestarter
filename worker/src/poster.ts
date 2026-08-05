import { encodeQr } from "./qr";

// A3 portrait at 200 dpi (spec section 12 minimum): 297mm x 420mm.
const DPI = 200;
const MM_TO_PX = DPI / 25.4;
const PAGE_W = Math.round(297 * MM_TO_PX);
const PAGE_H = Math.round(420 * MM_TO_PX);

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function qrPathAt(text: string, x: number, y: number, sizePx: number): string {
  const { size, isDark } = encodeQr(text);
  const quiet = 4;
  const totalModules = size + quiet * 2;
  const modulePx = sizePx / totalModules;
  let path = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!isDark(row, col)) continue;
      const px = x + (col + quiet) * modulePx;
      const py = y + (row + quiet) * modulePx;
      path += `M${px},${py}h${modulePx}v${modulePx}h${-modulePx}z`;
    }
  }
  return (
    `<rect x="${x}" y="${y}" width="${sizePx}" height="${sizePx}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#000000"/>`
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export interface PosterVideo {
  title: string;
  durationSeconds: number;
  url: string; // fully-built https://.../w/{video_id}?k={access_key}&src=poster[&lang=]
}

export function buildPosterSvg(clientName: string, videos: PosterVideo[]): string {
  const margin = Math.round(12 * MM_TO_PX);
  const headerH = Math.round(70 * MM_TO_PX);
  const cols = 3;
  const gap = Math.round(8 * MM_TO_PX);
  const tileW = (PAGE_W - margin * 2 - gap * (cols - 1)) / cols;
  const qrSize = tileW - Math.round(4 * MM_TO_PX);
  const tileTextH = Math.round(14 * MM_TO_PX);
  const tileH = qrSize + tileTextH;

  let tiles = "";
  videos.forEach((v, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (tileW + gap);
    const y = headerH + margin + row * (tileH + gap);
    tiles +=
      qrPathAt(v.url, x + (tileW - qrSize) / 2, y, qrSize) +
      `<text x="${x + tileW / 2}" y="${y + qrSize + Math.round(6 * MM_TO_PX)}" text-anchor="middle" font-family="Inter" font-size="${Math.round(4 * MM_TO_PX)}" fill="#111111">${escapeXml(v.title)}</text>` +
      `<text x="${x + tileW / 2}" y="${y + qrSize + Math.round(11 * MM_TO_PX)}" text-anchor="middle" font-family="Inter" font-size="${Math.round(3.2 * MM_TO_PX)}" fill="#555555">${formatDuration(v.durationSeconds)}</text>`;
  });

  const provenanceY = PAGE_H - Math.round(10 * MM_TO_PX);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W} ${PAGE_H}" width="${PAGE_W}" height="${PAGE_H}">` +
    `<rect width="${PAGE_W}" height="${PAGE_H}" fill="#ffffff"/>` +
    `<rect width="${PAGE_W}" height="${headerH}" fill="#111827"/>` +
    `<rect y="${headerH}" width="${PAGE_W}" height="${Math.round(2 * MM_TO_PX)}" fill="#f97316"/>` +
    `<text x="${margin}" y="${Math.round(28 * MM_TO_PX)}" font-family="Inter" font-size="${Math.round(11 * MM_TO_PX)}" font-weight="700" fill="#ffffff">Workplace Safety Training</text>` +
    `<text x="${margin}" y="${Math.round(42 * MM_TO_PX)}" font-family="Inter" font-size="${Math.round(6 * MM_TO_PX)}" fill="#e5e7eb">${escapeXml(clientName)}</text>` +
    `<text x="${margin}" y="${Math.round(54 * MM_TO_PX)}" font-family="Inter" font-size="${Math.round(5 * MM_TO_PX)}" fill="#f97316">Scan to watch</text>` +
    `<text x="${PAGE_W - margin}" y="${Math.round(28 * MM_TO_PX)}" text-anchor="end" font-family="Inter" font-size="${Math.round(6 * MM_TO_PX)}" fill="#9ca3af">Affirmer</text>` +
    tiles +
    `<text x="${PAGE_W / 2}" y="${provenanceY}" text-anchor="middle" font-family="Inter" font-size="${Math.round(3.2 * MM_TO_PX)}" fill="#6b7280">Licensed to ${escapeXml(clientName)} — not for distribution outside this organisation</text>` +
    `</svg>`
  );
}
