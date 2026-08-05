-- Spec section 8: "unreviewed generated captions must not reach a client" — a mistranslated
-- safety instruction is a liability, not a typo. The original video_languages_select policy
-- only checked entitlement, not review state, which would let the client portal (or any
-- direct API call) read an unreviewed caption row for a video the client is otherwise
-- entitled to. Enforcing at the RLS layer rather than trusting the portal UI to filter it out
-- client-side, per CLAUDE.md's "enforced at the database layer, not just hidden in the
-- interface" principle.
drop policy video_languages_select on video_languages;

create policy video_languages_select on video_languages
  for select using (
    reviewed_at is not null
    and exists (
      select 1 from entitlements e
      where e.video_id = video_languages.video_id
        and e.client_id = current_client_id()
        and e.effective_from <= current_date
        and (e.effective_to is null or e.effective_to >= current_date)
    )
  );
