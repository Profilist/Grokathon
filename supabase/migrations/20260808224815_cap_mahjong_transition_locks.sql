alter function public.mahjong_commit_transition(
  text,
  uuid,
  text,
  text,
  bigint,
  jsonb,
  jsonb,
  jsonb
) set lock_timeout = '500ms';

alter function public.mahjong_commit_transition(
  text,
  uuid,
  text,
  text,
  bigint,
  jsonb,
  jsonb,
  jsonb
) set statement_timeout = '5s';
