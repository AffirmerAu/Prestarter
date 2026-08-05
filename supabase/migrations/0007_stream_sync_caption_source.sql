-- Captions can now be registered from a file that already exists on Cloudflare Stream
-- (uploaded directly via Stream's own dashboard, outside our admin console) instead of only
-- via a fresh upload through our API. Same pattern as 0005_preview_source.sql: add the new
-- value to the existing check constraint rather than loosening it to free text. Rows created
-- this way still land reviewed_at = null like any other caption (spec section 8) — existing
-- on Stream is not the same as human-reviewed for accuracy.
alter table video_languages drop constraint video_languages_source_check;
alter table video_languages add constraint video_languages_source_check
  check (source in ('uploaded', 'generated', 'stream_sync'));
