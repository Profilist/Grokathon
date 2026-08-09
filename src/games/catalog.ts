export type GameType = "rps" | "mahjong" | "poker";

export interface GameTypeSpec {
  /** Stable key, also the slug prefix that selects this game. */
  type: GameType;
  title: string;
  shortTitle: string;
  emoji: string;
  /** Seats that must be filled before the game leaves `open`. */
  seats: number;
  /** Stake per seat when the marker does not carry an explicit wager. */
  defaultWagerCents: number;
  /** Poker is scaffolding only: seats fill, but there is no round to play. */
  playable: boolean;
}

export const GAME_CATALOG: Record<GameType, GameTypeSpec> = {
  rps: {
    type: "rps",
    title: "Rock Paper Scissors",
    shortTitle: "RPS",
    emoji: "🪨",
    seats: 2,
    defaultWagerCents: 500,
    playable: true,
  },
  mahjong: {
    type: "mahjong",
    title: "Taiwanese Mahjong",
    shortTitle: "Mahjong",
    emoji: "🀄",
    seats: 4,
    defaultWagerCents: 2000,
    playable: true,
  },
  poker: {
    type: "poker",
    title: "Poker",
    shortTitle: "Poker",
    emoji: "🃏",
    seats: 8,
    defaultWagerCents: 1000,
    playable: false,
  },
};

export const GAME_TYPES = Object.keys(GAME_CATALOG) as GameType[];

export function isGameType(value: unknown): value is GameType {
  return typeof value === "string" && value in GAME_CATALOG;
}

/**
 * The slug carries the game type as a prefix, so `[grokplay:mahjong-friday]`
 * needs no lookup to know what to render. Unprefixed slugs stay Rock Paper
 * Scissors, which is what every marker meant before other games existed.
 */
export function gameTypeFromSlug(slug: string): GameType {
  const prefix = slug.toLowerCase().split("-")[0];
  return isGameType(prefix) ? prefix : "rps";
}

export function gameSpecForSlug(slug: string): GameTypeSpec {
  return GAME_CATALOG[gameTypeFromSlug(slug)];
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
