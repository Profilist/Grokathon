import { describe, expect, it } from "vitest";
import {
  isGameListing,
  normalizeGameListing,
  parseWagerDollars,
  wagerInputFromCents,
} from "./listing";

const listing = {
  slug: "friday-table",
  game_type: "mahjong",
  wager_cents: 2000,
  seat_count: 4,
  host_user_id: "host-id",
  host_handle: "larris",
  status: "open",
  created_at: "2026-08-08T00:00:00Z",
  updated_at: "2026-08-08T00:00:00Z",
};

describe("game listing", () => {
  it("accepts the shared lobby projection", () => {
    expect(isGameListing(listing)).toBe(true);
    expect(normalizeGameListing([listing])).toEqual(listing);
  });

  it("rejects invalid game types and wagers", () => {
    expect(isGameListing({ ...listing, game_type: "chess" })).toBe(false);
    expect(isGameListing({ ...listing, wager_cents: -1 })).toBe(false);
    expect(isGameListing({ ...listing, wager_cents: 19.5 })).toBe(false);
  });

  it("parses user-entered dollar wagers into exact cents", () => {
    expect(parseWagerDollars("25")).toBe(2500);
    expect(parseWagerDollars("12.50")).toBe(1250);
    expect(parseWagerDollars("0.01")).toBe(1);
    expect(wagerInputFromCents(1250)).toBe("12.50");
    expect(wagerInputFromCents(2500)).toBe("25");
  });

  it("rejects empty, zero, over-precision, and oversized wagers", () => {
    expect(parseWagerDollars("")).toBeNull();
    expect(parseWagerDollars("0")).toBeNull();
    expect(parseWagerDollars("1.005")).toBeNull();
    expect(parseWagerDollars("1000000")).toBeNull();
  });
});
