create table public.generated_assets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  game_slug text not null references public.games(slug) on delete cascade,
  move text not null check (move in ('rock', 'paper', 'scissors')),
  status text not null default 'generating'
    check (status in ('generating', 'ready', 'failed')),
  program jsonb,
  texture_path text,
  error_code text,
  schema_version smallint not null default 3 check (schema_version = 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint generated_assets_state_check check (
    (status = 'generating' and program is null and error_code is null) or
    (
      status = 'ready' and
      program is not null and
      program ->> 'version' = '3' and
      error_code is null
    ) or
    (status = 'failed' and program is null and error_code is not null)
  )
);

create index generated_assets_owner_created_idx
on public.generated_assets (owner_user_id, created_at desc);

create index generated_assets_game_slug_idx
on public.generated_assets (game_slug);

alter table public.generated_assets enable row level security;

revoke all on public.generated_assets from anon, authenticated;
grant select on public.generated_assets to authenticated;

create policy "Players can view their generated assets"
on public.generated_assets for select
to authenticated
using (owner_user_id = (select auth.uid()));

alter publication supabase_realtime add table public.generated_assets;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'rps-generated-assets',
  'rps-generated-assets',
  false,
  8388608,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.rps_moves
add column asset_id uuid references public.generated_assets(id);

create index rps_moves_asset_id_idx
on public.rps_moves (asset_id)
where asset_id is not null;

alter table public.rps_rounds
add column seat_0_asset_id uuid references public.generated_assets(id),
add column seat_1_asset_id uuid references public.generated_assets(id),
add constraint rps_round_asset_reveal_check check (
  resolved_at is not null or
  (seat_0_asset_id is null and seat_1_asset_id is null)
);

create index rps_rounds_seat_0_asset_id_idx
on public.rps_rounds (seat_0_asset_id)
where seat_0_asset_id is not null;

create index rps_rounds_seat_1_asset_id_idx
on public.rps_rounds (seat_1_asset_id)
where seat_1_asset_id is not null;

drop policy if exists "Seated players can submit one move" on public.rps_moves;

create policy "Seated players can submit one move"
on public.rps_moves for insert
to authenticated
with check (
  user_id = (select auth.uid()) and
  game_slug in (
    select p.game_slug
    from public.game_players p
    join public.games g on g.slug = p.game_slug
    where p.user_id = (select auth.uid())
      and g.game_type = 'rps'
      and g.status in ('ready', 'playing')
  ) and
  (
    asset_id is null or
    asset_id in (
      select a.id
      from public.generated_assets a
      where a.owner_user_id = (select auth.uid())
        and a.game_slug = rps_moves.game_slug
        and a.move = rps_moves.choice
        and a.status = 'ready'
    )
  )
);

create or replace function private.resolve_rps_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_game public.games;
  actor_seat smallint;
  seat_0_user uuid;
  seat_1_user uuid;
  move_0 text;
  move_1 text;
  asset_0 uuid;
  asset_1 uuid;
  resolved_winner smallint;
  drawn boolean;
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'Authenticated player identity required';
  end if;

  select * into current_game
  from public.games where slug = new.game_slug for update;

  if current_game.slug is null or current_game.game_type <> 'rps' or
     current_game.status not in ('ready', 'playing') then
    raise exception 'Game is unavailable for this player';
  end if;

  select seat into actor_seat
  from public.game_players
  where game_slug = new.game_slug and user_id = new.user_id;
  if actor_seat is null then
    raise exception 'Game is unavailable for this player';
  end if;

  select user_id into seat_0_user
  from public.game_players where game_slug = new.game_slug and seat = 0;
  select user_id into seat_1_user
  from public.game_players where game_slug = new.game_slug and seat = 1;

  select choice, asset_id into move_0, asset_0 from public.rps_moves
  where game_slug = new.game_slug and user_id = seat_0_user;
  select choice, asset_id into move_1, asset_1 from public.rps_moves
  where game_slug = new.game_slug and user_id = seat_1_user;

  insert into public.rps_rounds (game_slug) values (new.game_slug)
  on conflict (game_slug) do nothing;

  if move_0 is not null and move_1 is not null then
    drawn := move_0 = move_1;
    resolved_winner := case
      when drawn then null
      when (move_0 = 'rock' and move_1 = 'scissors') or
           (move_0 = 'paper' and move_1 = 'rock') or
           (move_0 = 'scissors' and move_1 = 'paper') then 0
      else 1
    end;

    update public.rps_rounds
    set
      seat_0_locked = true, seat_1_locked = true,
      seat_0_move = move_0, seat_1_move = move_1,
      seat_0_asset_id = asset_0, seat_1_asset_id = asset_1,
      winner_seat = resolved_winner, is_draw = drawn,
      resolved_at = now(), updated_at = now()
    where game_slug = new.game_slug;

    update public.games
    set
      status = 'complete',
      is_draw = drawn,
      winner_user_id = case
        when drawn then null
        when resolved_winner = 0 then seat_0_user
        else seat_1_user
      end,
      host_has_played = true,
      guest_has_played = true,
      host_move = move_0,
      guest_move = move_1,
      winner = case when drawn then 'draw' when resolved_winner = 0 then 'host' else 'guest' end,
      updated_at = now()
    where slug = new.game_slug;
  else
    update public.rps_rounds
    set
      seat_0_locked = seat_0_locked or actor_seat = 0,
      seat_1_locked = seat_1_locked or actor_seat = 1,
      updated_at = now()
    where game_slug = new.game_slug;

    update public.games
    set
      status = 'playing',
      host_has_played = host_has_played or actor_seat = 0,
      guest_has_played = guest_has_played or actor_seat = 1,
      updated_at = now()
    where slug = new.game_slug;
  end if;

  return new;
end;
$$;

revoke all on function private.resolve_rps_move()
from public, anon, authenticated, service_role;

create or replace function public.reset_rps_round(p_game_slug text)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_game public.games;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user is required';
  end if;

  select * into current_game
  from public.games where slug = p_game_slug for update;

  if current_game.slug is null or current_game.game_type <> 'rps' then
    raise exception 'Rock Paper Scissors game not found';
  end if;
  if not exists (
    select 1 from public.game_players
    where game_slug = p_game_slug and user_id = auth.uid()
  ) then
    raise exception 'Only seated players can start another round';
  end if;

  if current_game.status <> 'complete' then
    return current_game;
  end if;

  delete from public.rps_moves where game_slug = p_game_slug;

  update public.rps_rounds
  set
    seat_0_locked = false, seat_1_locked = false,
    seat_0_move = null, seat_1_move = null,
    seat_0_asset_id = null, seat_1_asset_id = null,
    winner_seat = null, is_draw = false,
    resolved_at = null, updated_at = now()
  where game_slug = p_game_slug;

  update public.games
  set
    status = 'ready',
    winner_user_id = null,
    is_draw = false,
    host_has_played = false,
    guest_has_played = false,
    host_move = null,
    guest_move = null,
    winner = null,
    updated_at = now()
  where slug = p_game_slug
  returning * into current_game;

  return current_game;
end;
$$;

revoke all on function public.reset_rps_round(text) from public, anon;
grant execute on function public.reset_rps_round(text) to authenticated;
