-- Contract step. Run only after confirming the client reads game_players and
-- rps_rounds correctly; the expand migration deliberately left these columns in
-- place and kept writing them so an older build would keep working.
--
-- NOT YET APPLIED. Apply it, then remove the legacy writes from
-- public.join_game, public.reset_rps_round and private.resolve_rps_move.

alter table public.games
drop column if exists host_handle,
drop column if exists guest_user_id,
drop column if exists guest_handle,
drop column if exists host_has_played,
drop column if exists guest_has_played,
drop column if exists host_move,
drop column if exists guest_move,
drop column if exists winner;

drop index if exists games_guest_user_id_idx;
