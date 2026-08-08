-- Spectator chat for [grokwatch:<id>] cards.
--
-- Intentionally no foreign key to public.games(slug): a spectate post can be
-- seen before the host ever opens their own marked post, so the lobby row may
-- not exist yet. The slug shape is re-checked here instead.
create table public.spectator_messages (
  id bigint generated always as identity primary key,
  game_slug text not null check (game_slug ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  handle text not null check (char_length(handle) between 1 and 40),
  body text not null check (char_length(btrim(body)) between 1 and 280),
  created_at timestamptz not null default now()
);

create index spectator_messages_game_slug_created_at_idx
on public.spectator_messages (game_slug, created_at desc);

alter table public.spectator_messages enable row level security;

revoke all on public.spectator_messages from anon, authenticated;
grant select, insert on public.spectator_messages to authenticated;

-- Spectate rooms are public, matching the existing lobby select policy.
create policy "Authenticated users can read spectator chat"
on public.spectator_messages for select
to authenticated
using (true);

create policy "Spectators can post as themselves"
on public.spectator_messages for insert
to authenticated
with check (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.spectator_messages;
