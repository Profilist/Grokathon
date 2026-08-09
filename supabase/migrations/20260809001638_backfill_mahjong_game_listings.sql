-- Existing Mahjong tables predate the shared public.games listing. Add only
-- the missing discovery rows so every marker can resolve its game type and
-- display wager from one slug. Mahjong seats and authoritative state remain in
-- their existing tables; game_players intentionally stays empty for Mahjong.
insert into public.games (
  slug,
  host_user_id,
  host_handle,
  status,
  created_at,
  updated_at,
  game_type,
  wager_cents,
  seat_count
)
select
  game.slug,
  host.user_id,
  host.handle,
  case game.status
    when 'ready' then 'ready'
    when 'playing' then 'playing'
    when 'claiming' then 'playing'
    when 'complete' then 'complete'
    else 'open'
  end,
  game.created_at,
  game.updated_at,
  'mahjong',
  2000,
  4
from public.mahjong_games as game
join public.mahjong_seats as host
  on host.game_slug = game.slug
  and host.seat = 0
  and host.user_id is not null
  and not host.is_bot
on conflict (slug) do nothing;
