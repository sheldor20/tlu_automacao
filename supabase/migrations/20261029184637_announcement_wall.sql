create table public.announcement_publishers (
 user_id uuid primary key references public.profiles(user_id) on delete cascade,
 granted_by uuid not null references public.profiles(user_id),
 created_at timestamptz not null default now()
);
create table public.announcements (
 id uuid primary key default gen_random_uuid(),
 author_id uuid not null references public.profiles(user_id),
 author_name text not null,
 title text not null check(length(btrim(title)) between 1 and 160),
 body text not null default '' check(length(body)<=10000),
 media_path text,
 created_at timestamptz not null default now(),
 check(length(btrim(body))>0 or media_path is not null)
);
create table public.announcement_comments (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null references public.announcements(id) on delete cascade,
 author_id uuid not null references public.profiles(user_id),
 author_name text not null,
 body text not null check(length(btrim(body)) between 1 and 2000),
 created_at timestamptz not null default now()
);
create table public.announcement_reactions (
 post_id uuid not null references public.announcements(id) on delete cascade,
 user_id uuid not null references public.profiles(user_id),
 reaction text not null check(reaction in ('❤️','👏','👍','🎉')),
 primary key(post_id,user_id)
);
create index announcements_created_idx on public.announcements(created_at desc);
create index announcement_comments_post_idx on public.announcement_comments(post_id,created_at);
alter table public.announcement_publishers enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_comments enable row level security;
alter table public.announcement_reactions enable row level security;
-- Only authenticated server handlers can access these tables. They verify active profiles and action-specific permissions.
revoke all on public.announcement_publishers,public.announcements,public.announcement_comments,public.announcement_reactions from anon,authenticated;
grant all on public.announcement_publishers,public.announcements,public.announcement_comments,public.announcement_reactions to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('announcement-media','announcement-media',false,4000000,array['image/jpeg','image/png','image/webp','image/gif']);
