import { describe, expect, it } from "vitest";
import { isGameListing, normalizeGameListing } from "./listing";

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
});
