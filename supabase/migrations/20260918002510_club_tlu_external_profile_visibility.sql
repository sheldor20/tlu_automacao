-- Preserve employee permissions; prevent external club accounts from listing staff.
-- The existing column grants already protect profiles.active and profiles.is_admin.
create function club_private.has_internal_profile() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.active and p.deleted_at is null);
$$;
revoke all on function club_private.has_internal_profile() from public,anon,authenticated;
grant usage on schema club_private to authenticated;
grant execute on function club_private.has_internal_profile() to authenticated,service_role;
create policy club_profiles_external_isolation on public.profiles as restrictive for select to authenticated
 using(user_id=(select auth.uid()) or (select club_private.has_internal_profile()));
