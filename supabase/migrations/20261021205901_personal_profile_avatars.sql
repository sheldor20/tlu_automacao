insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('profile-avatars','profile-avatars',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy profile_avatar_read on storage.objects for select to authenticated
using (bucket_id='profile-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy profile_avatar_insert on storage.objects for insert to authenticated
with check (bucket_id='profile-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy profile_avatar_delete on storage.objects for delete to authenticated
using (bucket_id='profile-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
