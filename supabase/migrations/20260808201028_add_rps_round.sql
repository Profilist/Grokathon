alter table public.games
drop constraint if exists games_status_check,
drop constraint if exists game_guest_pair;

alter table public.games
add column host_has_played boolean not null default false,
add column guest_has_played boolean not null default false,
add column host_move text,
add column guest_move text,
add column winner text;

alter table public.games
add constraint games_status_check
check (status in ('open', 'ready', 'playing', 'complete')),
add constraint game_guest_pair
check (
  (guest_user_id is null and guest_handle is null and status = 'open') or
  (guest_user_id is not null and guest_handle is not null and status <> 'open')
),
add constraint game_round_state
check (
  (
    status in ('open', 'ready') and
    not host_has_played and
    not guest_has_played and
    host_move is null and
    guest_move is null and
    winner is null
  ) or
  (
    status = 'playing' and
    host_has_played <> guest_has_played and
    host_move is null and
    guest_move is null and
    winner is null
  ) or
  (
    status = 'complete' and
    host_has_played and
    guest_has_played and
    host_move in ('rock', 'paper', 'scissors') and
    guest_move in ('rock', 'paper', 'scissors') and
    winner in ('host', 'guest', 'draw')
  )
);

create table public.game_moves (
  game_slug text not null references public.games(slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  choice text not null check (choice in ('rock', 'paper', 'scissors')),
  created_at timestamptz not null default now(),
  primary key (game_slug, user_id)
);

create index game_moves_user_id_idx
on public.game_moves (user_id);

alter table public.game_moves enable row level security;

revoke all on public.game_moves from anon, authenticated;
grant select, insert on public.game_moves to authenticated;

create policy "Players can view their own move"
on public.game_moves for select
to authenticated
using (user_id = (select auth.uid()));

create policy "Seated players can submit one move"
on public.game_moves for insert
to authenticated
with check (
  user_id = (select auth.uid()) and
  game_slug in (
    select slug
    from public.games
    where status in ('ready', 'playing')
      and (select auth.uid()) in (host_user_id, guest_user_id)
  )
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.resolve_rps_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_game public.games;
  resolved_host_move text;
  resolved_guest_move text;
  resolved_winner text;
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'Authenticated player identity required';
  end if;

  select * into current_game
  from public.games
  where slug = new.game_slug
  for update;

  if current_game.slug is null or
     current_game.status not in ('ready', 'playing') or
     new.user_id not in (current_game.host_user_id, current_game.guest_user_id) then
    raise exception 'Game is unavailable for this player';
  end if;

  select choice into resolved_host_move
  from public.game_moves
  where game_slug = new.game_slug
    and user_id = current_game.host_user_id;

  select choice into resolved_guest_move
  from public.game_moves
  where game_slug = new.game_slug
    and user_id = current_game.guest_user_id;

  if resolved_host_move is not null and resolved_guest_move is not null then
    resolved_winner := case
      when resolved_host_move = resolved_guest_move then 'draw'
      when
        (resolved_host_move = 'rock' and resolved_guest_move = 'scissors') or
        (resolved_host_move = 'paper' and resolved_guest_move = 'rock') or
        (resolved_host_move = 'scissors' and resolved_guest_move = 'paper')
      then 'host'
      else 'guest'
    end;

    update public.games
    set
      host_has_played = true,
      guest_has_played = true,
      host_move = resolved_host_move,
      guest_move = resolved_guest_move,
      winner = resolved_winner,
      status = 'complete'
    where slug = new.game_slug;
  else
    update public.games
    set
      host_has_played = host_has_played or new.user_id = host_user_id,
      guest_has_played = guest_has_played or new.user_id = guest_user_id,
      status = 'playing'
    where slug = new.game_slug;
  end if;

  return new;
end;
$$;

revoke all on function private.resolve_rps_move() from public, anon, authenticated, service_role;

create trigger game_moves_resolve_rps
after insert on public.game_moves
for each row execute function private.resolve_rps_move();
