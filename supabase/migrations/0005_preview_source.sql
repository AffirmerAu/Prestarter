-- The admin console's review player (spec section 9: "review player showing the watermark
-- and captions exactly as clients see them") plays a real video through the real entitlement
-- flow, which writes a play_events row. Without a distinct source, that row would look like a
-- real client play — inflating usage_daily and potentially tripping the advisory cap alert for
-- a client's account just from Affirmer staff doing QA. Add 'preview' as its own source so
-- the Worker can log it for audit purposes while excluding it from client-facing counters.
alter table play_events drop constraint play_events_source_check;
alter table play_events add constraint play_events_source_check
  check (source in ('embed', 'watch', 'poster', 'preview'));
