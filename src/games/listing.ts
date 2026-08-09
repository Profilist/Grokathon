import type { GameStatus } from "../lobby";
import { isGameType, type GameType } from "./catalog";

export interface GameListing {
  slug: string;
  game_type: GameType;
  wager_cents: number;
  seat_count: number;
  host_user_id: string;
  host_handle: string;
  status: GameStatus;
  created_at: string;
  updated_at: string;
}

export const MAX_WAGER_CENTS = 99_999_999;

export function parseWagerDollars(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d{1,6}(?:\.\d{0,2})?$/.test(normalized)) return null;

  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_WAGER_CENTS) {
    return null;
  }
  return cents;
}

export function wagerInputFromCents(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

export function isGameListing(value: unknown): value is GameListing {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<GameListing>;
  return Boolean(
    typeof row.slug === "string" &&
      isGameType(row.game_type) &&
      typeof row.wager_cents === "number" &&
      row.wager_cents >= 0 &&
      Number.isInteger(row.wager_cents) &&
      typeof row.seat_count === "number" &&
      Number.isInteger(row.seat_count) &&
      typeof row.host_user_id === "string" &&
      typeof row.host_handle === "string" &&
      (row.status === "open" ||
        row.status === "ready" ||
        row.status === "playing" ||
        row.status === "complete") &&
      typeof row.created_at === "string" &&
      typeof row.updated_at === "string",
  );
}

export function normalizeGameListing(value: unknown): GameListing | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isGameListing(candidate) ? candidate : null;
}
