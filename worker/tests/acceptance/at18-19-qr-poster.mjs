// AT18: a downloaded QR code, printed and scanned with a standard phone camera, opens the
// correct video.
// AT19: a poster exported for a client contains one QR per licensed video and no others.
//
// jsQR is a genuinely independent decoding implementation from the `qrcode` encoding library
// used to generate these — decoding with it is exactly the "verified against a second
// implementation" spec section 12 asks for before the first poster is printed. What this
// script can't do is the physical print-and-scan pass (paper, lighting, a real phone camera)
// — that's a real, separate check to do once before anything actually goes on a wall.
//
// Needs a live `wrangler dev` and the seeded test orgs/admin. Temporarily grants a second
// entitlement to prove AT19's "no others" half, then removes it again.
//
// Usage: node at18-19-qr-poster.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import jsQR from "jsqr";

const here = fileURLToPath(new URL(".", import.meta.url));
const devVars = Object.fromEntries(
  fs
    .readFileSync(path.join(here, "..", "..", ".dev.vars"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim()];
    }),
);
const orgs = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "..", "supabase", "seed", "test-orgs.json"), "utf8"));
const adminTest = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "..", "supabase", "seed", "admin-test.json"), "utf8"));

const SUPABASE_URL = devVars.SUPABASE_URL;
const ANON_KEY = devVars.SUPABASE_ANON_KEY;
const SERVICE_KEY = devVars.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_URL = process.env.WORKER_URL || "http://127.0.0.1:8787";

let fail = 0;
function check(label, cond, detail) {
  if (cond) console.log(`PASS  ${label}`);
  else {
    console.log(`FAIL  ${label}${detail ? " — " + detail : ""}`);
    fail = 1;
  }
}

const rest = (p, opts = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${p}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...opts.headers,
    },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

async function signInAsAdmin() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminTest.testAdmin.email, password: adminTest.testAdmin.password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`admin sign-in failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

const a = orgs["Acme Pty Ltd"];
const adminToken = await signInAsAdmin();

// --- AT18: a single QR (as exported for one video) decodes to a link that actually works ---
{
  const res = await fetch(`${WORKER_URL}/internal/clients/${a.clientId}/videos/${orgs.videoId}/qr.png`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  check("QR PNG export succeeds", res.status === 200, `status ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const png = PNG.sync.read(buf);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  check("QR decodes to a URL at all", !!decoded, "no QR found in image");
  if (decoded) {
    const decodedUrl = new URL(decoded.data);
    check("decoded link points at the right video", decodedUrl.pathname === `/w/${orgs.videoId}`, decoded.data);
    check("decoded link carries the client's access key", decodedUrl.searchParams.get("k") === a.key, decoded.data);

    const tokenCheck = await fetch(
      `${WORKER_URL}/api/token?videoId=${orgs.videoId}&k=${decodedUrl.searchParams.get("k")}`,
    );
    check("the decoded link's video+key actually mints a token (opens the correct video)", tokenCheck.status === 200, `status ${tokenCheck.status}`);
  }
}

// --- AT19: poster contains one QR per licensed video and no others ---
{
  // Prove the "no others" half by temporarily granting a second entitlement.
  const secondVideo = (await rest(`videos?stream_uid=neq.${devVars.STAGE1_VIDEO_UID}&select=id&limit=1`)).body?.[0];
  if (!secondVideo) {
    console.log("SKIP  AT19: no second video in the catalogue to test the multi-video case against");
  } else {
    await rest("entitlements", {
      method: "POST",
      body: JSON.stringify({ client_id: a.clientId, video_id: secondVideo.id }),
    });

    const res = await fetch(`${WORKER_URL}/internal/clients/${a.clientId}/poster.png`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const png = PNG.sync.read(buf);

    // Same tile geometry as worker/src/poster.ts.
    const DPI = 200, MM_TO_PX = DPI / 25.4;
    const PAGE_W = Math.round(297 * MM_TO_PX);
    const margin = Math.round(12 * MM_TO_PX);
    const headerH = Math.round(70 * MM_TO_PX);
    const cols = 3, gap = Math.round(8 * MM_TO_PX);
    const tileW = (PAGE_W - margin * 2 - gap * (cols - 1)) / cols;
    const qrSize = Math.round(tileW - Math.round(4 * MM_TO_PX));
    const tileTextH = Math.round(14 * MM_TO_PX);
    const tileH = qrSize + tileTextH;

    function decodeTile(i) {
      const col = i % cols, row = Math.floor(i / cols);
      const x0 = Math.round(margin + col * (tileW + gap));
      const y0 = Math.round(headerH + margin + row * (tileH + gap));
      const sub = Buffer.alloc(qrSize * qrSize * 4);
      for (let yy = 0; yy < qrSize; yy++) {
        png.data.copy(sub, yy * qrSize * 4, ((y0 + yy) * png.width + x0) * 4, ((y0 + yy) * png.width + x0 + qrSize) * 4);
      }
      const result = jsQR(new Uint8ClampedArray(sub), qrSize, qrSize);
      return result ? result.data : null;
    }

    const tile0 = decodeTile(0);
    const tile1 = decodeTile(1);
    const tile2 = decodeTile(2);
    check("tile 0 decodes to the first licensed video", tile0?.includes(`/w/${orgs.videoId}`), tile0);
    check("tile 1 decodes to the second licensed video", tile1?.includes(`/w/${secondVideo.id}`), tile1);
    check("no third tile exists (no others)", tile2 === null, tile2);

    await rest(`entitlements?client_id=eq.${a.clientId}&video_id=eq.${secondVideo.id}`, { method: "DELETE" });
  }
}

process.exit(fail);
