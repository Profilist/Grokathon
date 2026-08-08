-- Seat claiming and RPS resolution for the multi-game schema.
--
-- These functions write BOTH the new tables (game_players, rps_rounds, and the
-- new columns on games) and the legacy two-seat columns on public.games, so a
-- client built before the expand migration keeps working. The legacy writes go
-- away with 20260808240000_multi_game_contract.sql.

-- Opening a game creates the public.games listing that carries the game type
-- and wager, plus seat 0. Mahjong state is owned by the Mahjong Edge Function,
-- so no seat is written here for that type.
create or replace function public.open_game(
  p_game_slug text,
  p_game_type text,
  p_wager_cents integer,
  p_handle text
)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_game public.games;
  seats smallint;
  normalized_handle text;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user is required';
  end if;
  if p_game_type not in ('rps', 'mahjong', 'poker') then
    raise exception 'Unknown game type';
  end if;
  if p_game_slug !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' then
    raise exception 'Invalid game ID';
  end if;

  normalized_handle := left(nullif(trim(both '@' from trim(p_handle)), ''), 40);
  if normalized_handle is null then
    raise exception 'Player handle is required';
  end if;

  seats := case p_game_type when 'mahjong' then 4 when 'poker' then 8 else 2 end;

  insert into public.games (
    slug, game_type, wager_cents, seat_count, host_user_id, host_handle, status
  )
  values (
    p_game_slug, p_game_type, greatest(coalesce(p_wager_cents, 0), 0),
    seats, auth.uid(), normalized_handle, 'open'
  )
  on conflict (slug) do nothing;

  select * into current_game from public.games where slug = p_game_slug;
  if current_game.slug is null then
    raise exception 'Could not open game';
  end if;

  -- Someone else already opened this slug; hand back their listing untouched.
  if current_game.host_user_id <> auth.uid() then
    return current_game;
  end if;

  if p_game_type <> 'mahjong' then
    insert into public.game_players (game_slug, seat, user_id, handle)
    values (p_game_slug, 0, auth.uid(), normalized_handle)
    on conflict (game_slug, user_id) do nothing;
  end if;

  if p_game_type = 'rps' then
    insert into public.rps_rounds (game_slug) values (p_game_slug)
    on conflict (game_slug) do nothing;
  end if;

  return current_game;
end;
$$;

revoke all on function public.open_game(text, text, integer, text)
from public, anon;
grant execute on function public.open_game(text, text, integer, text)
to authenticated;

-- Claiming the next free seat. Idempotent for a player already seated.
-- The old signature used p_guest_handle, so it has to be dropped rather than
-- replaced in place.
drop function if exists public.join_game(text, text);

create or replace function public.join_game(p_game_slug text, p_handle text)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_game public.games;
  taken_seats integer;
  next_seat smallint;
  normalized_handle text;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user is required';
  end if;

  normalized_handle := left(nullif(trim(both '@' from trim(p_handle)), ''), 40);
  if normalized_handle is null then
    raise exception 'Player handle is required';
  end if;

  select * into current_game
  from public.games where slug = p_game_slug for update;

  if current_game.slug is null then
    raise exception 'Game not found';
  end if;
  if current_game.game_type = 'mahjong' then
    raise exception 'Mahjong seats are claimed through the Mahjong server';
  end if;

  if exists (
    select 1 from public.game_players
    where game_slug = p_game_slug and user_id = auth.uid()
  ) then
    return current_game;
  end if;

  if current_game.status <> 'open' then
    raise exception 'Lobby is unavailable or already full';
  end if;

  select count(*) into taken_seats
  from public.game_players where game_slug = p_game_slug;

  if taken_seats >= current_game.seat_count then
    raise exception 'Lobby is unavailable or already full';
  end if;

  select min(candidate) into next_seat
  from generate_series(0, current_game.seat_count - 1) as candidate
  where candidate not in (
    select seat from public.game_players where game_slug = p_game_slug
  );

  insert into public.game_players (game_slug, seat, user_id, handle)
  values (p_game_slug, next_seat, auth.uid(), normalized_handle);

  if taken_seats + 1 >= current_game.seat_count then
    update public.games
    set
      status = 'ready',
      -- Legacy mirror, only meaningful for the two-seat game.
      guest_user_id = case when current_game.seat_count = 2 then auth.uid() else guest_user_id end,
      guest_handle = case when current_game.seat_count = 2 then normalized_handle else guest_handle end,
      updated_at = now()
    where slug = p_game_slug
    returning * into current_game;
  end if;

  return current_game;
end;
$$;

revoke all on function public.join_game(text, text) from public, anon;
grant execute on function public.join_game(text, text) to authenticated;

-- RPS resolution. Choices live in rps_moves, readable only by their author, and
-- are copied onto rps_rounds only once both seats have locked in.
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

  select choice into move_0 from public.rps_moves
  where game_slug = new.game_slug and user_id = seat_0_user;
  select choice into move_1 from public.rps_moves
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
      -- Legacy mirror.
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

drop trigger if exists game_moves_resolve_rps on public.rps_moves;
drop trigger if exists rps_moves_resolve_rps on public.rps_moves;

create trigger rps_moves_resolve_rps
after insert on public.rps_moves
for each row execute function private.resolve_rps_move();

-- Play again: wipe the round and reopen it for both seated players.
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
