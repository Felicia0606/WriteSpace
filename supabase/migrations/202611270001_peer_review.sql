-- Additive peer feedback storage. Existing Firebase data is unchanged.
create schema if not exists peer_review_private;
revoke all on schema peer_review_private from public, anon, authenticated;

create table peer_review_private.access_grants (
  user_uid text not null,
  issuer text not null,
  class_id text not null,
  group_id text not null,
  expires_at timestamptz not null,
  primary key (user_uid, issuer, class_id, group_id)
);

-- The Edge Function alone grants access after reading authoritative Firebase records.
create function public.peer_review_grant_access(p_uid text, p_issuer text, p_class text, p_group text)
returns void language sql security definer set search_path = '' as $$
  insert into peer_review_private.access_grants (user_uid, issuer, class_id, group_id, expires_at)
  values (p_uid, p_issuer, p_class, p_group, now() + interval '120 seconds')
  on conflict (user_uid, issuer, class_id, group_id) do update set expires_at = excluded.expires_at;
$$;
revoke all on function public.peer_review_grant_access(text, text, text, text) from public, anon, authenticated;
grant execute on function public.peer_review_grant_access(text, text, text, text) to service_role;

create function public.peer_review_can_read(p_class text, p_group text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from peer_review_private.access_grants g
    where g.user_uid = (select auth.jwt()->>'sub')
      and g.issuer = (select auth.jwt()->>'iss')
      and g.class_id = p_class and g.group_id = p_group
      and g.expires_at > now()
  );
$$;
revoke all on function public.peer_review_can_read(text, text) from public;
grant execute on function public.peer_review_can_read(text, text) to anon, authenticated;

create table public.peer_review_snapshots (
  id uuid primary key default gen_random_uuid(),
  class_id text not null,
  group_id text not null,
  content_hash text not null,
  text_content text not null check (char_length(text_content) <= 200000),
  created_at timestamptz not null default now(),
  unique (class_id, group_id, content_hash),
  unique (id, class_id, group_id)
);
create table public.peer_review_comments (
  id uuid primary key,
  class_id text not null,
  group_id text not null,
  snapshot_id uuid not null,
  author_uid text not null,
  author_name text not null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  selection_start integer,
  selection_end integer,
  quote text,
  created_at timestamptz not null default now(),
  foreign key (snapshot_id, class_id, group_id) references public.peer_review_snapshots(id, class_id, group_id),
  check ((selection_start is null and selection_end is null and quote is null) or
    (selection_start is not null and selection_end is not null and quote is not null and
     selection_start >= 0 and selection_end > selection_start and char_length(quote) > 0))
);
create table public.peer_review_reactions (
  id uuid primary key default gen_random_uuid(),
  class_id text not null,
  group_id text not null,
  author_uid text not null,
  author_name text not null,
  emoji text not null check (emoji in ('👍', '❤️', '💡', '👏', '🎉')),
  -- Soft removal emits an UPDATE that can be filtered and authorized by Realtime.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (class_id, group_id, author_uid, emoji)
);
create index peer_review_comments_group on public.peer_review_comments(class_id, group_id, created_at, id);
create index peer_review_reactions_group on public.peer_review_reactions(class_id, group_id, created_at, id);

alter table public.peer_review_snapshots enable row level security;
alter table public.peer_review_comments enable row level security;
alter table public.peer_review_reactions enable row level security;
revoke all on public.peer_review_snapshots, public.peer_review_comments, public.peer_review_reactions from anon, authenticated;
grant select on public.peer_review_snapshots, public.peer_review_comments, public.peer_review_reactions to anon, authenticated;
grant all on public.peer_review_snapshots, public.peer_review_comments, public.peer_review_reactions to service_role;

-- Firebase tokens without a role claim use anon. A bare anon key still has no
-- matching sub + issuer grant, so it cannot read a single row. No Auth changes needed.
create policy peer_snapshots_read on public.peer_review_snapshots for select to anon, authenticated
  using (public.peer_review_can_read(class_id, group_id));
create policy peer_comments_read on public.peer_review_comments for select to anon, authenticated
  using (public.peer_review_can_read(class_id, group_id));
create policy peer_reactions_read on public.peer_review_reactions for select to anon, authenticated
  using (public.peer_review_can_read(class_id, group_id));

alter publication supabase_realtime add table public.peer_review_comments, public.peer_review_reactions;
