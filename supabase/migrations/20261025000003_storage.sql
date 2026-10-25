-- Private bucket for audio. Objects live under {auth.uid()}/...
-- (the bucket name is "recordings", so the full object path is recordings/{uid}/...)

insert into storage.buckets (id, name, public, file_size_limit)
values ('recordings', 'recordings', false, 524288000) -- 500 MB
on conflict (id) do nothing;

create policy "recordings: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "recordings: insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "recordings: update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "recordings: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
