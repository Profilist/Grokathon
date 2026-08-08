import type { LegalAction } from "../../supabase/functions/_shared/mahjong/sim/actions";
import type { PlayerId, RoundState } from "../../supabase/functions/_shared/mahjong/sim/state";

export type MahjongGameStatus = "open" | "ready" | "playing" | "claiming" | "complete";

export type MahjongGameSummary = {
  slug: string;
  status: MahjongGameStatus;
  round_number: number;
  dealer: PlayerId | null;
  current_player: PlayerId | null;
  deadline_at: string | null;
  state_version: number;
  wall_count: number | null;
  winners: PlayerId[] | null;
  result: unknown;
  last_event_sequence: number;
  created_at: string;
  updated_at: string;
};

export type MahjongSeat = {
  game_slug: string;
  seat: PlayerId;
  handle: string;
  is_bot: boolean;
  joined_at: string;
};

export type MahjongPlayerView = {
  game: MahjongGameSummary;
  seats: MahjongSeat[];
  seat: PlayerId | null;
  canJoin: boolean;
  canStart: boolean;
  canFillBots: boolean;
  round: RoundState | null;
  legalActions: LegalAction[];
  recentEvents: Array<Record<string, unknown> & { type: string }>;
  serverNow: string;
};

export type { LegalAction, PlayerId, RoundState };

export function isMahjongPlayerView(value: unknown): value is MahjongPlayerView {
  if (!value || typeof value !== "object") return false;
  const view = value as Partial<MahjongPlayerView>;
  return Boolean(
    view.game &&
      typeof view.game.slug === "string" &&
      typeof view.game.state_version === "number" &&
      Array.isArray(view.seats) &&
      (view.seat === null || view.seat === 0 || view.seat === 1 || view.seat === 2 || view.seat === 3) &&
      Array.isArray(view.legalActions) &&
      typeof view.canFillBots === "boolean" &&
      typeof view.serverNow === "string",
  );
}
