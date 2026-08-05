-- Row level security (spec section 5 rules): every client-facing query is scoped to the
-- signed-in user's client_id. play_events and usage_daily get NO client policy at all —
-- RLS default-denies once enabled, so simply never granting a select policy on those two
-- tables to `authenticated` is what "excludes them entirely" means in practice.
--
-- Admin access (stage three console) goes through the Supabase service role key server-side,
-- which bypasses RLS by design — so no separate "admin" policies are needed here.

create or replace function current_client_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select client_id from client_contacts where user_id = auth.uid()
$$;

alter table clients enable row level security;
alter table client_contacts enable row level security;
alter table videos enable row level security;
alter table video_languages enable row level security;
alter table entitlements enable row level security;
alter table access_keys enable row level security;
alter table play_events enable row level security;
alter table usage_daily enable row level security;
alter table billing_events enable row level security;
alter table alerts enable row level security;
alter table audit_log enable row level security;

-- clients: row-level scoping (RLS policy below) controls WHICH ROW; that alone isn't enough
-- since daily_cap_advisory must never reach a client response (spec section 5 rule), and RLS
-- can't hide a column, only filter rows. So on top of the row policy, direct table access is
-- revoked for the API roles entirely — clients can only reach this data through the
-- client_safe_status view, which projects just the safe columns. The security_invoker view
-- still needs the row policy underneath it to have anything to read.
create policy clients_select on clients
  for select using (id = current_client_id());

create view client_safe_status as
select id, name, mark_as, status, term_end, billing_state
from clients
where id = current_client_id();
alter view client_safe_status set (security_invoker = true);

revoke select on clients from authenticated, anon;
grant select on client_safe_status to authenticated;

-- client_contacts: see your own org's contacts (harmless — colleagues' names/emails).
create policy client_contacts_select on client_contacts
  for select using (client_id = current_client_id());

-- videos / video_languages: visible only where an entitlement currently covers them.
create policy videos_select on videos
  for select using (
    exists (
      select 1 from entitlements e
      where e.video_id = videos.id
        and e.client_id = current_client_id()
        and e.effective_from <= current_date
        and (e.effective_to is null or e.effective_to >= current_date)
    )
  );

create policy video_languages_select on video_languages
  for select using (
    exists (
      select 1 from entitlements e
      where e.video_id = video_languages.video_id
        and e.client_id = current_client_id()
        and e.effective_from <= current_date
        and (e.effective_to is null or e.effective_to >= current_date)
    )
  );

-- entitlements: needed so the portal can enumerate "which videos do we have".
create policy entitlements_select on entitlements
  for select using (client_id = current_client_id());

-- access_keys: clients need to read their own (non-revoked) key to build links/QR codes.
-- Never expose other clients' keys, never expose revoked ones (dead links shouldn't be
-- reconstructable from the portal).
create policy access_keys_select on access_keys
  for select using (client_id = current_client_id() and revoked_at is null);

-- play_events, usage_daily, billing_events, alerts, audit_log: deliberately NO policies
-- for `authenticated` — RLS enabled with zero policies means zero rows returned to clients,
-- which is the enforcement mechanism for "administrator visible only".
