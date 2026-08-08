-- Expand step of an expand/contract migration to a multi-game model.
--
-- Everything here is additive. The legacy two-seat columns on public.games
-- (host_handle, guest_user_id, guest_handle, host_has_played, guest_has_played,
-- host_move, guest_move, winner) are kept and still written to, so a client
-- built before this migration keeps working. They are dropped later by
-- 20260808240000_multi_game_contract.sql once the new shape is verified.
--
--   public.games         game-agnostic listing: type, wager, capacity, outcome
--   public.game_players  seats, for games whose state lives in this schema
--   public.rps_moves     RPS submissions (renamed from public.game_moves)
--   public.rps_rounds    revealed RPS result
--
-- Mahjong keeps its own authoritative tables from
-- 20260808214430_add_authoritative_mahjong. Nothing here touches them; mahjong
-- simply gains a public.games row so its type and wager have one home, and its
-- seats stay in public.mahjong_seats.

-- 1. Retire the constraints that hard-code exactly two seats -----------------
-- These block a 4- or 8-seat game from ever reaching 'ready'. Dropping a check
-- constraint removes no data.

alter table public.games
drop constraint if exists game_guest_pair,
drop constraint if exists game_round_state,
drop constraint if exists game_players_differ;

-- Legacy columns must be nullable now that non-RPS games never fill them.
alter table public.games alter column host_handle drop not null;

-- 2. Widen public.games ------------------------------------------------------

alter table public.games
add column game_type text not null default 'rps',
add column wager_cents integer not null default 500,
add column seat_count smallint not null default 2,
add column winner_user_id uuid references auth.users(id) on delete set null,
add column is_draw boolean not null default false;

update public.games
set game_type = case
  when slug ~* '^mahjong-' then 'mahjong'
  when slug ~* '^poker-' then 'poker'
  else 'rps'
end;

update public.games
set
  seat_count = case game_type when 'mahjong' then 4 when 'poker' then 8 else 2 end,
  wager_cents = case game_type when 'mahjong' then 2000 when 'poker' then 1000 else 500 end;

update public.games
set
  winner_user_id = case winner
    when 'host' then host_user_id
    when 'guest' then guest_user_id
    else null
  end,
  is_draw = winner = 'draw'
where winner is not null;

alter table public.games
alter column game_type drop default,
alter column seat_count drop default,
alter column wager_cents drop default;

alter table public.games
add constraint games_game_type_check
check (game_type in ('rps', 'mahjong', 'poker')),
add constraint games_seat_count_check check (seat_count between 2 and 8),
add constraint games_wager_check check (wager_cents between 0 and 100000000),
add constraint games_outcome_check
check (status = 'complete' or (winner_user_id is null and not is_draw)),
add constraint games_single_outcome_check
check (not (is_draw and winner_user_id is not null));

create index games_winner_user_id_idx on public.games (winner_user_id);
create index games_game_type_idx on public.games (game_type);

-- 3. Generic seats -----------------------------------------------------------

create table public.game_players (
  game_slug text not null references public.games(slug) on delete cascade,
  seat smallint not null check (seat between 0 and 7),
  user_id uuid not null references auth.users(id) on delete cascade,
  handle text not null check (char_length(handle) between 1 and 40),
  joined_at timestamptz not null default now(),
  primary key (game_slug, seat),
  unique (game_slug, user_id)
);

create index game_players_user_id_idx on public.game_players (user_id);

-- Seat 0 is always the host; the old guest becomes seat 1.
insert into public.game_players (game_slug, seat, user_id, handle, joined_at)
select slug, 0, host_user_id, host_handle, created_at
from public.games
where host_handle is not null;

insert into public.game_players (game_slug, seat, user_id, handle, joined_at)
select slug, 1, guest_user_id, guest_handle, updated_at
from public.games
where guest_user_id is not null and guest_handle is not null;

alter table public.game_players enable row level security;

revoke all on public.game_players from anon, authenticated;
grant select on public.game_players to authenticated;

create policy "Authenticated users can view seats"
on public.game_players for select
to authenticated
using (true);

alter publication supabase_realtime add table public.game_players;

-- 4. RPS gets its own tables -------------------------------------------------

alter table public.game_moves rename to rps_moves;
alter index game_moves_user_id_idx rename to rps_moves_user_id_idx;

create table public.rps_rounds (
  game_slug text primary key references public.games(slug) on delete cascade,
  seat_0_locked boolean not null default false,
  seat_1_locked boolean not null default false,
  seat_0_move text check (seat_0_move in ('rock', 'paper', 'scissors')),
  seat_1_move text check (seat_1_move in ('rock', 'paper', 'scissors')),
  winner_seat smallint check (winner_seat in (0, 1)),
  is_draw boolean not null default false,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  -- Moves are only ever written at reveal, together with resolved_at, so a
  -- spectator reading this table can never see a choice early.
  constraint rps_round_reveal_check check (
    (resolved_at is null and seat_0_move is null and seat_1_move is null
      and winner_seat is null and not is_draw) or
    (resolved_at is not null and seat_0_move is not null and seat_1_move is not null)
  )
);

insert into public.rps_rounds (
  game_slug, seat_0_locked, seat_1_locked, seat_0_move, seat_1_move,
  winner_seat, is_draw, resolved_at
)
select
  slug,
  host_has_played,
  guest_has_played,
  host_move,
  guest_move,
  case winner when 'host' then 0 when 'guest' then 1 else null end,
  coalesce(winner = 'draw', false),
  case when status = 'complete' then updated_at else null end
from public.games
where game_type = 'rps';

alter table public.rps_rounds enable row level security;

revoke all on public.rps_rounds from anon, authenticated;
grant select on public.rps_rounds to authenticated;

create policy "Authenticated users can view rps rounds"
on public.rps_rounds for select
to authenticated
using (true);

alter publication supabase_realtime add table public.rps_rounds;

-- Re-point the move policy at the new seat table.
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
  )
);
