-- Server-authoritative Taiwanese Mahjong state and public Realtime projection.
create table public.mahjong_games (
  slug text primary key check (slug ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$'),
  status text not null default 'open'
    check (status in ('open', 'ready', 'playing', 'claiming', 'complete')),
  round_number bigint not null default 0 check (round_number >= 0),
  dealer smallint check (dealer between 0 and 3),
  current_player smallint check (current_player between 0 and 3),
  deadline_at timestamptz,
  state_version bigint not null default 0 check (state_version >= 0),
  wall_count smallint check (wall_count between 0 and 144),
  winners smallint[] check (
    winners is null or winners <@ array[0, 1, 2, 3]::smallint[]
  ),
  result jsonb,
  last_event_sequence bigint not null default 0 check (last_event_sequence >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mahjong_seats (
  game_slug text not null references public.mahjong_games(slug) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  user_id uuid not null references auth.users(id) on delete cascade,
  handle text not null check (char_length(handle) between 1 and 32),
  joined_at timestamptz not null default now(),
  primary key (game_slug, seat),
  unique (game_slug, user_id)
);

create index mahjong_seats_user_id_idx
on public.mahjong_seats (user_id);

create table public.mahjong_events (
  id bigint generated always as identity primary key,
  game_slug text not null references public.mahjong_games(slug) on delete cascade,
  sequence bigint not null check (sequence > 0),
  round_number bigint not null check (round_number > 0),
  event jsonb not null check (jsonb_typeof(event) = 'object'),
  created_at timestamptz not null default now(),
  unique (game_slug, sequence)
);

create index mahjong_events_game_round_sequence_idx
on public.mahjong_events (game_slug, round_number, sequence);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.mahjong_states (
  game_slug text primary key references public.mahjong_games(slug) on delete cascade,
  version bigint not null default 0 check (version >= 0),
  state jsonb,
  updated_at timestamptz not null default now()
);

create table private.mahjong_action_receipts (
  game_slug text not null references public.mahjong_games(slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  operation text not null check (char_length(operation) between 1 and 32),
  state_version bigint not null check (state_version >= 0),
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (game_slug, user_id, idempotency_key)
);

create index mahjong_action_receipts_created_at_idx
on private.mahjong_action_receipts (created_at);

alter table public.mahjong_games enable row level security;
alter table public.mahjong_seats enable row level security;
alter table public.mahjong_events enable row level security;
alter table private.mahjong_states enable row level security;
alter table private.mahjong_states force row level security;
alter table private.mahjong_action_receipts enable row level security;
alter table private.mahjong_action_receipts force row level security;

revoke all on private.mahjong_states from public, anon, authenticated;
revoke all on private.mahjong_action_receipts from public, anon, authenticated;
revoke all on public.mahjong_games from anon, authenticated;
revoke all on public.mahjong_seats from anon, authenticated;
revoke all on public.mahjong_events from anon, authenticated;
grant select on public.mahjong_games to authenticated;
grant select on public.mahjong_seats to authenticated;
grant select on public.mahjong_events to authenticated;

-- Mahjong lobby summaries and redacted events are intentionally readable by
-- every authenticated demo participant. Concealed state never enters public.
create policy "Authenticated users can view Mahjong games"
on public.mahjong_games for select
to authenticated
using (true);

create policy "Authenticated users can view Mahjong seats"
on public.mahjong_seats for select
to authenticated
using (true);

create policy "Authenticated users can view redacted Mahjong events"
on public.mahjong_events for select
to authenticated
using (true);

create or replace function public.mahjong_create_game(
  p_game_slug text,
  p_user_id uuid,
  p_handle text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_handle text;
  current_game public.mahjong_games;
begin
  if p_user_id is null then
    raise exception 'Authenticated user is required';
  end if;
  if p_game_slug !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' then
    raise exception 'Invalid Mahjong game ID';
  end if;
  if char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Invalid idempotency key';
  end if;

  normalized_handle := left(nullif(trim(both '@' from trim(p_handle)), ''), 32);
  if normalized_handle is null then
    raise exception 'Player handle is required';
  end if;

  insert into public.mahjong_games (slug)
  values (p_game_slug)
  on conflict (slug) do nothing;

  select * into current_game
  from public.mahjong_games
  where slug = p_game_slug
  for update;

  if exists (
    select 1 from public.mahjong_seats
    where game_slug = p_game_slug and user_id <> p_user_id
  ) and not exists (
    select 1 from public.mahjong_seats
    where game_slug = p_game_slug and user_id = p_user_id
  ) then
    raise exception 'This Mahjong lobby already has a different host';
  end if;

  insert into public.mahjong_seats (game_slug, seat, user_id, handle)
  values (p_game_slug, 0, p_user_id, normalized_handle)
  on conflict (game_slug, user_id) do update
  set handle = excluded.handle;

  insert into private.mahjong_states (game_slug, version, state)
  values (p_game_slug, current_game.state_version, null)
  on conflict (game_slug) do nothing;

  insert into private.mahjong_action_receipts (
    game_slug, user_id, idempotency_key, operation, state_version, response
  ) values (
    p_game_slug, p_user_id, p_idempotency_key, 'create',
    current_game.state_version, jsonb_build_object('created', true)
  ) on conflict (game_slug, user_id, idempotency_key) do nothing;

  return jsonb_build_object(
    'game', to_jsonb(current_game),
    'seat', 0,
    'duplicate', false
  );
end;
$$;

create or replace function public.mahjong_join_game(
  p_game_slug text,
  p_user_id uuid,
  p_handle text,
  p_idempotency_key text,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_handle text;
  current_game public.mahjong_games;
  assigned_seat smallint;
  occupied_count integer;
  existing_receipt private.mahjong_action_receipts;
begin
  if p_user_id is null then
    raise exception 'Authenticated user is required';
  end if;
  if char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Invalid idempotency key';
  end if;
  normalized_handle := left(nullif(trim(both '@' from trim(p_handle)), ''), 32);
  if normalized_handle is null then
    raise exception 'Player handle is required';
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

  select seat into assigned_seat
  from public.mahjong_seats
  where game_slug = p_game_slug and user_id = p_user_id;

  if assigned_seat is null then
    select seat_number into assigned_seat
    from generate_series(0, 3) as candidate(seat_number)
    where not exists (
      select 1 from public.mahjong_seats
      where game_slug = p_game_slug and seat = seat_number
    )
    order by seat_number
    limit 1;
    if assigned_seat is null then
      raise exception 'This Mahjong lobby is full';
    end if;
    insert into public.mahjong_seats (game_slug, seat, user_id, handle)
    values (p_game_slug, assigned_seat, p_user_id, normalized_handle);
  else
    update public.mahjong_seats
    set handle = normalized_handle
    where game_slug = p_game_slug and user_id = p_user_id;
  end if;

  select count(*) into occupied_count
  from public.mahjong_seats
  where game_slug = p_game_slug;

  update public.mahjong_games
  set
    status = case
      when status = 'complete' then 'complete'
      when occupied_count = 4 then 'ready'
      else 'open'
    end,
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
    p_game_slug, p_user_id, p_idempotency_key, 'join', current_game.state_version,
    jsonb_build_object('seat', assigned_seat, 'version', current_game.state_version)
  );

  return jsonb_build_object(
    'seat', assigned_seat,
    'version', current_game.state_version,
    'duplicate', false
  );
end;
$$;

create or replace function public.mahjong_leave_game(
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

  delete from public.mahjong_seats
  where game_slug = p_game_slug and user_id = p_user_id;

  update public.mahjong_games
  set
    status = case
      when status in ('playing', 'claiming', 'complete') then status
      when (select count(*) from public.mahjong_seats where game_slug = p_game_slug) = 4
        then 'ready'
      else 'open'
    end,
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
    p_game_slug, p_user_id, p_idempotency_key, 'leave', current_game.state_version,
    jsonb_build_object('left', true, 'version', current_game.state_version)
  );

  return jsonb_build_object(
    'left', true,
    'version', current_game.state_version,
    'duplicate', false
  );
end;
$$;

create or replace function public.mahjong_load_game(
  p_game_slug text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when game.slug is null then null
    else jsonb_build_object(
      'game', to_jsonb(game),
      'seats', coalesce((
        select jsonb_agg(to_jsonb(seat_row) order by seat_row.seat)
        from public.mahjong_seats seat_row
        where seat_row.game_slug = game.slug
      ), '[]'::jsonb),
      'state', state_row.state
    )
  end
  from public.mahjong_games game
  left join private.mahjong_states state_row on state_row.game_slug = game.slug
  where game.slug = p_game_slug;
$$;

create or replace function public.mahjong_commit_transition(
  p_game_slug text,
  p_user_id uuid,
  p_idempotency_key text,
  p_operation text,
  p_expected_version bigint,
  p_next_state jsonb,
  p_projection jsonb,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_game public.mahjong_games;
  existing_receipt private.mahjong_action_receipts;
  next_version bigint;
  next_status text;
  next_round bigint;
  next_dealer smallint;
  next_player smallint;
  next_deadline timestamptz;
  next_wall_count smallint;
  next_winners smallint[];
  next_result jsonb;
  event_count integer;
begin
  if p_user_id is null then
    raise exception 'Authenticated user is required';
  end if;
  if char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Invalid idempotency key';
  end if;
  if jsonb_typeof(p_next_state) <> 'object' or jsonb_typeof(p_projection) <> 'object' then
    raise exception 'Invalid Mahjong transition payload';
  end if;
  if jsonb_typeof(coalesce(p_events, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid Mahjong events payload';
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

  next_status := p_projection ->> 'status';
  next_round := (p_projection ->> 'roundNumber')::bigint;
  next_dealer := nullif(p_projection ->> 'dealer', '')::smallint;
  next_player := nullif(p_projection ->> 'currentPlayer', '')::smallint;
  next_deadline := nullif(p_projection ->> 'deadlineAt', '')::timestamptz;
  next_wall_count := nullif(p_projection ->> 'wallCount', '')::smallint;
  next_winners := case
    when p_projection -> 'winners' is null or p_projection -> 'winners' = 'null'::jsonb
      then null
    else array(
      select winner.value::smallint
      from jsonb_array_elements_text(p_projection -> 'winners') as winner(value)
    )
  end;
  next_result := p_projection -> 'result';
  next_version := current_game.state_version + 1;
  event_count := jsonb_array_length(coalesce(p_events, '[]'::jsonb));

  update public.mahjong_games
  set
    status = next_status,
    round_number = next_round,
    dealer = next_dealer,
    current_player = next_player,
    deadline_at = next_deadline,
    state_version = next_version,
    wall_count = next_wall_count,
    winners = next_winners,
    result = next_result,
    last_event_sequence = last_event_sequence + event_count,
    updated_at = now()
  where slug = p_game_slug
  returning * into current_game;

  update private.mahjong_states
  set version = next_version, state = p_next_state, updated_at = now()
  where game_slug = p_game_slug;

  insert into public.mahjong_events (game_slug, sequence, round_number, event)
  select
    p_game_slug,
    current_game.last_event_sequence - event_count + event_row.ordinality,
    next_round,
    event_row.value
  from jsonb_array_elements(coalesce(p_events, '[]'::jsonb))
    with ordinality as event_row(value, ordinality);

  if next_status = 'complete' then
    delete from public.mahjong_seats
    where game_slug = p_game_slug and seat between 1 and 3;
  end if;

  insert into private.mahjong_action_receipts (
    game_slug, user_id, idempotency_key, operation, state_version, response
  ) values (
    p_game_slug, p_user_id, p_idempotency_key, left(p_operation, 32), next_version,
    jsonb_build_object('version', next_version)
  );

  return jsonb_build_object('version', next_version, 'duplicate', false);
end;
$$;

revoke all on function public.mahjong_create_game(text, uuid, text, text)
from public, anon, authenticated;
revoke all on function public.mahjong_join_game(text, uuid, text, text, bigint)
from public, anon, authenticated;
revoke all on function public.mahjong_leave_game(text, uuid, text, bigint)
from public, anon, authenticated;
revoke all on function public.mahjong_load_game(text)
from public, anon, authenticated;
revoke all on function public.mahjong_commit_transition(
  text, uuid, text, text, bigint, jsonb, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.mahjong_create_game(text, uuid, text, text)
to service_role;
grant execute on function public.mahjong_join_game(text, uuid, text, text, bigint)
to service_role;
grant execute on function public.mahjong_leave_game(text, uuid, text, bigint)
to service_role;
grant execute on function public.mahjong_load_game(text)
to service_role;
grant execute on function public.mahjong_commit_transition(
  text, uuid, text, text, bigint, jsonb, jsonb, jsonb
) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mahjong_games'
  ) then
    alter publication supabase_realtime add table public.mahjong_games;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mahjong_seats'
  ) then
    alter publication supabase_realtime add table public.mahjong_seats;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mahjong_events'
  ) then
    alter publication supabase_realtime add table public.mahjong_events;
  end if;
end
$$;
