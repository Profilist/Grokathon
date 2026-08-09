import { describe, expect, it } from "vitest";
import { formatCents } from "./catalog";

describe("game catalog", () => {
  it("adds thousands separators to wager amounts", () => {
    expect(formatCents(99_900)).toBe("$999.00");
    expect(formatCents(100_000)).toBe("$1,000.00");
    expect(formatCents(10_000_000)).toBe("$100,000.00");
    expect(formatCents(100_050)).toBe("$1,000.50");
  });
});
