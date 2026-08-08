-- Cover the auth.users foreign key for user deletion and receipt cleanup.
create index mahjong_action_receipts_user_id_idx
on private.mahjong_action_receipts (user_id);
