-- Administrator role (spec section 14: "Separate administrator role"). Mirrors
-- client_contacts' link to auth.users, but admins are Affirmer staff, not client contacts,
-- and are never scoped to a single client_id.
create table admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email citext not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

-- No RLS policy for `authenticated` here at all — admin routes are checked in the Worker
-- (validates the caller's Supabase session, then looks this table up with the service role
-- key), not via PostgREST directly from the browser. RLS enabled anyway, default-deny, so a
-- stray anon/authenticated request can't read the admin list either way.
alter table admins enable row level security;
