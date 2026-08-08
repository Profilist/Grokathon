import { describe, expect, it } from "vitest";
import {
  MESSAGE_HISTORY_LIMIT,
  avatarHue,
  avatarInitial,
  formatRelativeTime,
  isSpectatorMessage,
  mergeMessages,
  spectatorsFromPresence,
  type SpectatorMessage,
} from "./spectate";

function message(overrides: Partial<SpectatorMessage> = {}): SpectatorMessage {
  return {
    id: 1,
    game_slug: "demo",
    user_id: "user-1",
    handle: "larris",
    body: "lets go",
    created_at: "2026-08-08T20:00:00.000Z",
    ...overrides,
  };
}

describe("isSpectatorMessage", () => {
  it("accepts a well formed row", () => {
    expect(isSpectatorMessage(message())).toBe(true);
  });

  it("rejects malformed rows", () => {
    expect(isSpectatorMessage(null)).toBe(false);
    expect(isSpectatorMessage("nope")).toBe(false);
    expect(isSpectatorMessage({ ...message(), id: "1" })).toBe(false);
    expect(isSpectatorMessage({ ...message(), body: undefined })).toBe(false);
  });
});

describe("mergeMessages", () => {
  it("dedupes realtime redelivery by id", () => {
    const existing = [message({ id: 1 })];
    const merged = mergeMessages(existing, [message({ id: 1, body: "edited" })]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.body).toBe("edited");
  });

  it("orders oldest first and breaks ties by id", () => {
    const merged = mergeMessages(
      [message({ id: 3, created_at: "2026-08-08T20:00:02.000Z" })],
      [
        message({ id: 2, created_at: "2026-08-08T20:00:00.000Z" }),
        message({ id: 1, created_at: "2026-08-08T20:00:00.000Z" }),
      ],
    );

    expect(merged.map((entry) => entry.id)).toEqual([1, 2, 3]);
  });

  it("caps history at the newest messages", () => {
    const many = Array.from({ length: MESSAGE_HISTORY_LIMIT + 20 }, (_, index) =>
      message({ id: index, created_at: new Date(index * 1000).toISOString() }),
    );
    const merged = mergeMessages([], many);

    expect(merged).toHaveLength(MESSAGE_HISTORY_LIMIT);
    expect(merged[merged.length - 1]?.id).toBe(MESSAGE_HISTORY_LIMIT + 19);
  });
});

describe("spectatorsFromPresence", () => {
  it("collapses multiple presence refs for one viewer", () => {
    const spectators = spectatorsFromPresence({
      "ref-a": [{ userId: "user-1", handle: "larris" }],
      "ref-b": [{ userId: "user-1", handle: "larris" }],
      "ref-c": [{ userId: "user-2", handle: "allegra" }],
    });

    expect(spectators).toEqual([
      { userId: "user-1", handle: "larris" },
      { userId: "user-2", handle: "allegra" },
    ]);
  });

  it("ignores presence entries missing identity", () => {
    expect(
      spectatorsFromPresence({
        "ref-a": [{ handle: "larris" }, null, "nope"],
      }),
    ).toEqual([]);
  });
});

describe("avatarHue", () => {
  it("is deterministic and handle-normalized", () => {
    expect(avatarHue("larris")).toBe(avatarHue("@Larris"));
    expect(avatarHue("larris")).not.toBe(avatarHue("allegra"));
    expect(avatarHue("larris")).toBeGreaterThanOrEqual(0);
    expect(avatarHue("larris")).toBeLessThan(360);
  });
});

describe("avatarInitial", () => {
  it("strips the at sign and falls back for empty handles", () => {
    expect(avatarInitial("@larris")).toBe("L");
    expect(avatarInitial("")).toBe("?");
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-08-08T20:00:00.000Z");

  it("formats recent through old timestamps", () => {
    expect(formatRelativeTime("2026-08-08T19:59:58.000Z", now)).toBe("now");
    expect(formatRelativeTime("2026-08-08T19:59:30.000Z", now)).toBe("30s");
    expect(formatRelativeTime("2026-08-08T19:56:00.000Z", now)).toBe("4m");
    expect(formatRelativeTime("2026-08-08T18:00:00.000Z", now)).toBe("2h");
    expect(formatRelativeTime("2026-08-06T20:00:00.000Z", now)).toBe("2d");
  });

  it("returns an empty string for unparseable input", () => {
    expect(formatRelativeTime("not a date", now)).toBe("");
  });
});
