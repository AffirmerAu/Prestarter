// Provisions the "video-thumbnails" Supabase Storage bucket used for admin-uploaded video
// cover images (worker/src/thumbnails.ts). Public-read: a course thumbnail isn't licensed
// content — the actual video stays behind Cloudflare Stream's signed URLs regardless; this is
// just cover art, same sensitivity as anything already in admin/portal/public/brand. Safe to
// re-run — no-ops if the bucket already exists.
// Usage: node setup-thumbnail-bucket.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const devVars = Object.fromEntries(
  fs
    .readFileSync(path.join(here, "..", "..", "worker", ".dev.vars"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim()];
    }),
);

const SUPABASE_URL = devVars.SUPABASE_URL;
const SERVICE_KEY = devVars.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET_ID = "video-thumbnails";

const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
  method: "POST",
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    id: BUCKET_ID,
    name: BUCKET_ID,
    public: true,
    file_size_limit: 5 * 1024 * 1024, // 5MB
    allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
  }),
});
const body = await res.json().catch(() => null);
if (res.ok) {
  console.log("created bucket:", JSON.stringify(body));
} else if (body?.message?.toLowerCase().includes("already exists") || res.status === 409) {
  console.log("bucket already exists, nothing to do");
} else {
  throw new Error(`bucket setup failed: ${res.status} ${JSON.stringify(body)}`);
}
