-- Keep both players seated while clearing the completed round atomically.
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
    raise exception 'Authentication required';
  end if;

  select * into current_game
  from public.games
  where slug = p_game_slug
  for update;

  if current_game.slug is null then
    raise exception 'Game not found';
  end if;

  if auth.uid() not in (current_game.host_user_id, current_game.guest_user_id) then
    raise exception 'Only seated players can start another round';
  end if;

  -- A concurrent replay request may arrive after the first one has already reset
  -- the game. Return the fresh lobby without deleting any newly submitted move.
  if current_game.status = 'ready' and
     not current_game.host_has_played and
     not current_game.guest_has_played then
    return current_game;
  end if;

  if current_game.status <> 'complete' then
    raise exception 'The current round is not complete';
  end if;

  delete from public.game_moves
  where game_slug = p_game_slug;

  update public.games
  set
    host_has_played = false,
    guest_has_played = false,
    host_move = null,
    guest_move = null,
    winner = null,
    status = 'ready'
  where slug = p_game_slug
  returning * into current_game;

  return current_game;
end;
$$;

revoke all on function public.reset_rps_round(text) from public, anon;
grant execute on function public.reset_rps_round(text) to authenticated;
