-- Profile photos. Each person's Google photo is kept in sync from sign-in, and anyone can
-- upload their own photo instead (Settings), stored in the public "avatars" bucket under a
-- folder named for their user id. The app shows the uploaded photo, else the Google one, else
-- a colored initial. The bucket itself (public, 5 MB, images only) is declared in
-- supabase/config.toml and created by `supabase seed buckets` in the deploy.

alter table public.profiles
  add column google_avatar_url text,
  -- The uploaded photo's path in the avatars bucket, "<user id>/<file>". Only a path, never a
  -- URL, so a profile can't point everyone's browser at an outside address.
  add column avatar_path text check (avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  add constraint avatar_path_is_own check (avatar_path is null or split_part(avatar_path, '/', 1) = id::text);

grant update (avatar_path) on public.profiles to authenticated;

-- Google sign-in puts the photo in avatar_url (and picture).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, google_avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  );
  return new;
end;
$$;

-- Each sign-in refreshes the Google data, so a changed Google photo follows along.
create function public.sync_google_avatar() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles
  set google_avatar_url = coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  where id = new.id
    and google_avatar_url is distinct from coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture');
  return new;
end;
$$;

create trigger on_auth_user_metadata_updated
  after update of raw_user_meta_data on auth.users
  for each row execute function public.sync_google_avatar();

update public.profiles p
set google_avatar_url = coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
from auth.users u
where u.id = p.id;

-- People manage the files in their own folder; everyone reads through the bucket's public URLs.
create policy "avatars: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: delete from own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
