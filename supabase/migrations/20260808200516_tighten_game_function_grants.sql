revoke all on function public.join_game(text, text) from public, anon;
grant execute on function public.join_game(text, text) to authenticated;

revoke all on function public.set_game_updated_at() from public, anon, authenticated;
