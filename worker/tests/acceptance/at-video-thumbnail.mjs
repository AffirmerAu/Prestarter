// Admin console "add a thumbnail image to a video" flow — user-reported requirement. Not a
// numbered spec section 18 acceptance test (new scope beyond the original spec), written
// before/alongside the implementation per this project's working agreement.
//
// No videos.thumbnail_url column exists — the public URL is fully deterministic from the
// video id (worker/src/thumbnails.ts / admin/src/components/VideoThumbnail.tsx), so this test
// checks the actual object landed in Supabase Storage at that exact URL, not just that the
// upload endpoint returned 200.
//
// Uses a throwaway video row (draft, synthetic stream_uid) — thumbnail upload never touches
// Cloudflare Stream, so no real Stream video is needed.
//
// Usage: start `wrangler dev`, then node at-video-thumbnail.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// A well-known minimal valid 1x1 transparent PNG.
const ONE_PX_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const adminToken = await signInAsAdmin();

const video = (
  await rest("videos", {
    method: "POST",
    body: JSON.stringify({
      display_code: `AT-THUMB-${Date.now()}`,
      title: "AT Thumbnail Test Video",
      duration_seconds: 60,
      category: "test",
      stream_uid: `at-thumb-fake-${Date.now()}`,
      status: "draft",
    }),
  })
).body?.[0];
check("setup: throwaway video created", !!video, JSON.stringify(video));

const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/video-thumbnails/${video.id}`;

try {
  // --- No thumbnail uploaded yet: the public URL reports not-found ---
  // (Supabase Storage's gateway returns HTTP 400 for this, with the real "not found" status
  // embedded in the JSON body — confirmed empirically. An <img onError> handler doesn't care
  // about the exact status code either way, only that the request wasn't a 2xx.)
  const beforeRes = await fetch(publicUrl);
  const beforeBody = await beforeRes.json().catch(() => null);
  check("no thumbnail exists yet (public URL reports not-found)", !beforeRes.ok && beforeBody?.statusCode === "404", JSON.stringify(beforeBody));

  // --- Missing file is rejected ---
  const badForm = new FormData();
  const badRes = await fetch(`${WORKER_URL}/internal/videos/${video.id}/thumbnail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: badForm,
  });
  check("missing file is rejected", badRes.status === 400, `status ${badRes.status}`);

  // --- A non-image file is rejected ---
  const textForm = new FormData();
  textForm.set("file", new Blob(["not an image"], { type: "text/plain" }), "note.txt");
  const textRes = await fetch(`${WORKER_URL}/internal/videos/${video.id}/thumbnail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: textForm,
  });
  check("a non-image file is rejected", textRes.status === 400, `status ${textRes.status}`);

  // --- A real image upload succeeds and actually lands at the deterministic public URL ---
  const pngBytes = Buffer.from(ONE_PX_PNG_BASE64, "base64");
  const imgForm = new FormData();
  imgForm.set("file", new Blob([pngBytes], { type: "image/png" }), "thumb.png");
  const uploadRes = await fetch(`${WORKER_URL}/internal/videos/${video.id}/thumbnail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: imgForm,
  });
  const uploadBody = await uploadRes.json();
  check("thumbnail upload succeeds", uploadRes.status === 200 && uploadBody.url === publicUrl, JSON.stringify(uploadBody));

  const afterRes = await fetch(publicUrl);
  const afterBytes = Buffer.from(await afterRes.arrayBuffer());
  check("the uploaded image is actually retrievable at the public URL", afterRes.status === 200, `status ${afterRes.status}`);
  check("the retrieved bytes match what was uploaded", afterBytes.equals(pngBytes), `got ${afterBytes.length} bytes, expected ${pngBytes.length}`);
  check("served with the right content type", afterRes.headers.get("content-type") === "image/png", afterRes.headers.get("content-type"));

  // --- Re-uploading replaces the same object (same URL, new bytes) rather than accumulating files ---
  const secondPngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const secondForm = new FormData();
  secondForm.set("file", new Blob([secondPngBytes], { type: "image/png" }), "thumb2.png");
  await fetch(`${WORKER_URL}/internal/videos/${video.id}/thumbnail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: secondForm,
  });
  const replacedRes = await fetch(publicUrl);
  const replacedBytes = Buffer.from(await replacedRes.arrayBuffer());
  check("re-uploading replaces the same object rather than creating a new one", replacedBytes.equals(secondPngBytes), `got ${replacedBytes.length} bytes`);

  // --- Uploading for a nonexistent video is rejected ---
  const missingVideoForm = new FormData();
  missingVideoForm.set("file", new Blob([pngBytes], { type: "image/png" }), "thumb.png");
  const missingRes = await fetch(`${WORKER_URL}/internal/videos/00000000-0000-0000-0000-000000000000/thumbnail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: missingVideoForm,
  });
  check("uploading for a nonexistent video is rejected", missingRes.status === 404, `status ${missingRes.status}`);
} finally {
  await fetch(`${SUPABASE_URL}/storage/v1/object/video-thumbnails/${video.id}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {});
  await rest(`videos?id=eq.${video.id}`, { method: "DELETE" });
}

process.exit(fail);
