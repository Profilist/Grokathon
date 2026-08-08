create table if not exists public.games (
  slug text primary key check (slug ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$'),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  host_handle text not null check (char_length(host_handle) between 1 and 32),
  guest_user_id uuid references auth.users(id) on delete set null,
  guest_handle text check (guest_handle is null or char_length(guest_handle) between 1 and 32),
  status text not null default 'open' check (status in ('open', 'ready')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_guest_pair check (
    (guest_user_id is null and guest_handle is null and status = 'open') or
    (guest_user_id is not null and guest_handle is not null and status = 'ready')
  ),
  constraint game_players_differ check (guest_user_id is null or guest_user_id <> host_user_id)
);

alter table public.games enable row level security;

revoke all on public.games from anon, authenticated;
grant select, insert on public.games to authenticated;
grant update (guest_user_id, guest_handle, status) on public.games to authenticated;

drop policy if exists "Authenticated users can view game lobbies" on public.games;
create policy "Authenticated users can view game lobbies"
on public.games for select
to authenticated
using (true);

drop policy if exists "Hosts can create their own game lobbies" on public.games;
create policy "Hosts can create their own game lobbies"
on public.games for insert
to authenticated
with check (
  host_user_id = (select auth.uid()) and
  guest_user_id is null and
  guest_handle is null and
  status = 'open'
);

drop policy if exists "Players can claim an open guest seat" on public.games;
create policy "Players can claim an open guest seat"
on public.games for update
to authenticated
using (
  guest_user_id is null and
  host_user_id <> (select auth.uid())
)
with check (
  guest_user_id = (select auth.uid()) and
  guest_handle is not null and
  status = 'ready' and
  host_user_id <> (select auth.uid())
);

create or replace function public.set_game_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists games_set_updated_at on public.games;
create trigger games_set_updated_at
before update on public.games
for each row execute function public.set_game_updated_at();

create or replace function public.join_game(
  p_game_slug text,
  p_guest_handle text
)
returns public.games
language plpgsql
security invoker
set search_path = ''
as $$
declare
  joined_game public.games;
  normalized_handle text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  normalized_handle := left(nullif(trim(both '@' from trim(p_guest_handle)), ''), 32);
  if normalized_handle is null then
    raise exception 'Guest handle is required';
  end if;

  update public.games
  set
    guest_user_id = auth.uid(),
    guest_handle = normalized_handle,
    status = 'ready'
  where slug = p_game_slug
    and guest_user_id is null
    and host_user_id <> auth.uid()
  returning * into joined_game;

  if joined_game.slug is null then
    select * into joined_game
    from public.games
    where slug = p_game_slug
      and guest_user_id = auth.uid();
  end if;

  if joined_game.slug is null then
    raise exception 'Lobby is unavailable or already full';
  end if;

  return joined_game;
end;
$$;

revoke all on function public.join_game(text, text) from public;
grant execute on function public.join_game(text, text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
end
$$;
