import type { MahjongPlayerView } from "./types";

export const MAHJONG_REQUEST_TIMEOUT_MS = 12_000;

const tickGraceMs = 120;
const tickFailoverStepMs = 850;
const hiddenTabDelayMs = 1_500;

export function mahjongTickIdempotencyKey(gameId: string, stateVersion: number): string {
  return `tick:${gameId}:${stateVersion}`;
}

export function mahjongTickDelay(
  view: MahjongPlayerView,
  visibility: DocumentVisibilityState = "visible",
): number | null {
  if (
    !view.game.deadline_at ||
    (view.game.status !== "playing" && view.game.status !== "claiming") ||
    view.seat === null
  ) {
    return null;
  }

  const humanSeats = view.seats
    .filter((seat) => !seat.is_bot)
    .map((seat) => seat.seat)
    .sort((left, right) => left - right);
  const failoverIndex = humanSeats.indexOf(view.seat);
  if (failoverIndex === -1) return null;

  const deadlineDelay = Math.max(
    50,
    Date.parse(view.game.deadline_at) - Date.parse(view.serverNow) + tickGraceMs,
  );
  return (
    deadlineDelay +
    failoverIndex * tickFailoverStepMs +
    (visibility === "visible" ? 0 : hiddenTabDelayMs)
  );
}
