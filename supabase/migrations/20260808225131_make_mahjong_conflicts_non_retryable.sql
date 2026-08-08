do $$
declare
  target regprocedure;
  definition text;
  corrected_definition text;
begin
  foreach target in array array[
    'public.mahjong_join_game(text,uuid,text,text,bigint)'::regprocedure,
    'public.mahjong_leave_game(text,uuid,text,bigint)'::regprocedure,
    'public.mahjong_commit_transition(text,uuid,text,text,bigint,jsonb,jsonb,jsonb)'::regprocedure,
    'public.mahjong_fill_bot_seats(text,uuid,text,bigint)'::regprocedure
  ] loop
    definition := pg_get_functiondef(target);
    corrected_definition := replace(
      definition,
      'errcode = ''40001'',',
      'errcode = ''P0001'','
    );

    if corrected_definition = definition then
      raise exception 'Expected retryable Mahjong conflict in %', target;
    end if;

    execute corrected_definition;
  end loop;
end;
$$;
