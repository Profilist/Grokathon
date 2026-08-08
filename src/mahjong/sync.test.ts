import { describe, expect, it } from "vitest";
import type { MahjongPlayerView } from "./types";
import {
  mahjongTickDelay,
  mahjongTickIdempotencyKey,
} from "./sync";

function playerView(overrides: Partial<MahjongPlayerView> = {}): MahjongPlayerView {
  return {
    game: {
      slug: "friday-table",
      status: "playing",
      round_number: 1,
      dealer: 0,
      current_player: 0,
      deadline_at: "2026-08-08T22:30:00.000Z",
      state_version: 16,
      wall_count: 47,
      winners: null,
      result: null,
      last_event_sequence: 66,
      created_at: "2026-08-08T22:00:00.000Z",
      updated_at: "2026-08-08T22:29:30.000Z",
    },
    seats: [
      { game_slug: "friday-table", seat: 0, handle: "host", is_bot: false, joined_at: "2026-08-08T22:00:00.000Z" },
      { game_slug: "friday-table", seat: 1, handle: "guest", is_bot: false, joined_at: "2026-08-08T22:00:01.000Z" },
      { game_slug: "friday-table", seat: 2, handle: "bot-west", is_bot: true, joined_at: "2026-08-08T22:00:02.000Z" },
      { game_slug: "friday-table", seat: 3, handle: "bot-north", is_bot: true, joined_at: "2026-08-08T22:00:03.000Z" },
    ],
    seat: 0,
    canJoin: false,
    canStart: false,
    canFillBots: false,
    round: null,
    legalActions: [],
    recentEvents: [],
    serverNow: "2026-08-08T22:30:01.000Z",
    ...overrides,
  };
}

describe("Mahjong tick coordination", () => {
  it("uses one stable idempotency key for a game version", () => {
    expect(mahjongTickIdempotencyKey("friday-table", 16)).toBe("tick:friday-table:16");
    expect(mahjongTickIdempotencyKey("friday-table", 16)).toBe("tick:friday-table:16");
    expect(mahjongTickIdempotencyKey("friday-table", 17)).toBe("tick:friday-table:17");
  });

  it("lets human seats take over expired ticks in a staggered order", () => {
    const hostDelay = mahjongTickDelay(playerView());
    const guestDelay = mahjongTickDelay(playerView({ seat: 1 }));

    expect(hostDelay).toBe(50);
    expect(guestDelay).toBe(900);
  });

  it("delays hidden tabs and excludes spectators from ticking", () => {
    expect(mahjongTickDelay(playerView(), "hidden")).toBe(1_550);
    expect(mahjongTickDelay(playerView({ seat: null }))).toBeNull();
  });
});
