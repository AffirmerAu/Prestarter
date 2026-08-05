-- Prestarter — initial schema (spec section 5).
-- Stage two: data model + constraints only. RLS policies are in 0002_rls.sql.

create extension if not exists pgcrypto;
create extension if not exists citext;

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mark_as text not null, -- watermark text (spec section 7) — company name only, not configurable further
  status text not null default 'active' check (status in ('active', 'paused')),
  plan_tier text not null,
  term_start date not null,
  term_end date not null,
  billing_state text not null default 'paid' check (billing_state in ('paid', 'due', 'overdue')),
  paid_to date not null,
  grace_days integer not null default 30,
  daily_cap_advisory integer not null,
  created_at timestamptz not null default now()
);

create table client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  -- Links to Supabase Auth (magic link, D17) so RLS can resolve "which client is
  -- this signed-in request for" — not in spec section 5's table listing verbatim,
  -- but required to make section 14's auth model actually enforce anything.
  user_id uuid references auth.users(id) on delete set null,
  email citext not null unique,
  name text not null,
  role text,
  invited_at timestamptz not null default now(),
  last_seen_at timestamptz
);

-- videos.id is opaque and permanent — printed QR codes encode it (spec section 5 rule).
-- It is NOT the same as stream_uid: id is Prestarter's own identifier used in URLs;
-- stream_uid is Cloudflare Stream's video UID, used only server-side to call the Stream API.
create table videos (
  id uuid primary key default gen_random_uuid(),
  display_code text not null unique, -- human-readable, may change freely
  title text not null,
  duration_seconds integer not null,
  category text not null,
  stream_uid text not null unique,
  status text not null default 'draft' check (status in ('draft', 'released', 'archived')),
  released_at timestamptz,
  replaces_video_id uuid references videos(id)
);

create table video_languages (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id) on delete cascade,
  language_tag text not null, -- BCP-47
  kind text not null check (kind in ('caption', 'audio')),
  label_native text not null,
  is_default boolean not null default false,
  source text not null check (source in ('uploaded', 'generated')),
  reviewed_at timestamptz, -- generated captions must be reviewed before release (spec section 8)
  unique (video_id, language_tag, kind)
);

create table entitlements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  video_id uuid not null references videos(id) on delete cascade,
  effective_from date not null default current_date,
  effective_to date, -- null = open-ended
  unique (client_id, video_id)
);

create table access_keys (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  key text not null unique,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index access_keys_client_id_idx on access_keys(client_id) where revoked_at is null;

-- Administrator visible only — see 0002_rls.sql for the RLS rules that enforce this.
create table play_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  video_id uuid not null references videos(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  address_hash text not null, -- salted hash, never a raw address (spec section 15)
  country text,
  referrer_host text,
  source text not null check (source in ('embed', 'watch', 'poster')),
  language_tag text,
  user_agent_class text
);
create index play_events_client_video_day_idx on play_events(client_id, video_id, occurred_at);

-- Administrator visible only.
create table usage_daily (
  client_id uuid not null references clients(id) on delete cascade,
  video_id uuid not null references videos(id) on delete cascade,
  day date not null,
  plays integer not null default 0,
  distinct_addresses integer not null default 0,
  countries integer not null default 0,
  primary key (client_id, video_id, day)
);

create table billing_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  action text not null check (action in ('marked_paid', 'marked_due', 'marked_overdue', 'paused', 'restored')),
  period_start date,
  period_end date,
  reference text, -- free-text external invoice reference — no amount field exists, by design
  actor text not null, -- 'system' for automatic nightly transitions
  occurred_at timestamptz not null default now(),
  note text
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  video_id uuid references videos(id),
  type text not null check (type in ('advisory_cap_exceeded', 'geographic_spread', 'approaching_cap', 'payment_overdue', 'cutoff_imminent')),
  severity text not null check (severity in ('warning', 'critical')),
  evidence jsonb not null,
  raised_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by text
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  subject_type text not null,
  subject_id uuid not null,
  detail jsonb,
  occurred_at timestamptz not null default now()
);
