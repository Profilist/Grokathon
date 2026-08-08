-- Demo-only bot seats remain explicit in the public projection while their
-- play is still produced by the authoritative Edge Function.
alter table public.mahjong_seats
add column is_bot boolean not null default false;

alter table public.mahjong_seats
alter column user_id drop not null;

alter table public.mahjong_seats
add constraint mahjong_seats_identity_check check (
  (is_bot and user_id is null) or
  (not is_bot and user_id is not null)
);

create or replace function public.mahjong_fill_bot_seats(
  p_game_slug text,
  p_user_id uuid,
  p_idempotency_key text,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_game public.mahjong_games;
  existing_receipt private.mahjong_action_receipts;
  inserted_count integer;
begin
  if p_user_id is null then
    raise exception 'Authenticated user is required';
  end if;
  if char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Invalid idempotency key';
  end if;

  select * into existing_receipt
  from private.mahjong_action_receipts
  where game_slug = p_game_slug
    and user_id = p_user_id
    and idempotency_key = p_idempotency_key;
  if existing_receipt.game_slug is not null then
    return existing_receipt.response || jsonb_build_object('duplicate', true);
  end if;

  select * into current_game
  from public.mahjong_games
  where slug = p_game_slug
  for update;
  if current_game.slug is null then
    raise exception 'Mahjong game not found';
  end if;
  if current_game.state_version <> p_expected_version then
    raise exception using
      errcode = '40001',
      message = 'Mahjong state changed; refresh and retry';
  end if;
  if current_game.status in ('playing', 'claiming') then
    raise exception 'This Mahjong hand is already in progress';
  end if;
  if not exists (
    select 1
    from public.mahjong_seats
    where game_slug = p_game_slug
      and seat = 0
      and user_id = p_user_id
      and not is_bot
  ) then
    raise exception 'Only the human host can fill this table with bots';
  end if;
  if (select count(*) from public.mahjong_seats where game_slug = p_game_slug) = 4 then
    raise exception 'This Mahjong lobby is already full';
  end if;

  insert into public.mahjong_seats (game_slug, seat, user_id, handle, is_bot)
  select
    p_game_slug,
    candidate.seat,
    null,
    case candidate.seat
      when 1 then 'grokbot_south'
      when 2 then 'grokbot_west'
      else 'grokbot_north'
    end,
    true
  from generate_series(1, 3) as candidate(seat)
  where not exists (
    select 1
    from public.mahjong_seats occupied
    where occupied.game_slug = p_game_slug
      and occupied.seat = candidate.seat
  );
  get diagnostics inserted_count = row_count;

  update public.mahjong_games
  set
    status = case when status = 'complete' then 'complete' else 'ready' end,
    state_version = state_version + 1,
    updated_at = now()
  where slug = p_game_slug
  returning * into current_game;

  update private.mahjong_states
  set version = current_game.state_version, updated_at = now()
  where game_slug = p_game_slug;

  insert into private.mahjong_action_receipts (
    game_slug, user_id, idempotency_key, operation, state_version, response
  ) values (
    p_game_slug, p_user_id, p_idempotency_key, 'fillBots', current_game.state_version,
    jsonb_build_object('botsAdded', inserted_count, 'version', current_game.state_version)
  );

  return jsonb_build_object(
    'botsAdded', inserted_count,
    'version', current_game.state_version,
    'duplicate', false
  );
end;
$$;

revoke all on function public.mahjong_fill_bot_seats(text, uuid, text, bigint)
from public, anon, authenticated;

grant execute on function public.mahjong_fill_bot_seats(text, uuid, text, bigint)
to service_role;
