create index if not exists games_host_user_id_idx
on public.games (host_user_id);

create index if not exists games_guest_user_id_idx
on public.games (guest_user_id);
