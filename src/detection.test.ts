import { describe, expect, it } from "vitest";
import {
  extractProfileHandle,
  extractStatusHandle,
  inferThemeFromColor,
  parseGameMarker,
  parseGameResizeMessage,
} from "./detection";

describe("parseGameMarker", () => {
  it("extracts a game id from a marked post", () => {
    expect(parseGameMarker("Who wants to play? [grokplay:demo]")).toEqual({
      kind: "rps",
      gameId: "demo",
    });
  });

  it("is case insensitive while preserving the id", () => {
    expect(parseGameMarker("[GROKPLAY:Rps_12]")).toEqual({
      kind: "rps",
      gameId: "Rps_12",
    });
  });

  it("routes the explicit Mahjong marker separately", () => {
    expect(parseGameMarker("Four seats open [grokplay:mahjong:table_12]")).toEqual({
      kind: "mahjong",
      gameId: "table_12",
    });
  });

  it("rejects malformed and missing markers", () => {
    expect(parseGameMarker("grokplay:demo")).toBeNull();
    expect(parseGameMarker("[grokplay:bad id]")).toBeNull();
    expect(parseGameMarker("ordinary post")).toBeNull();
  });
});

describe("parseGameResizeMessage", () => {
  it("accepts only the two supported game sizes", () => {
    expect(
      parseGameResizeMessage({
        type: "grokplay:resize",
        kind: "mahjong",
        gameId: "table_12",
        height: 560,
      }),
    ).toEqual({
      type: "grokplay:resize",
      kind: "mahjong",
      gameId: "table_12",
      height: 560,
    });
  });

  it("rejects invalid types, ids, kinds, and arbitrary heights", () => {
    expect(parseGameResizeMessage(null)).toBeNull();
    expect(parseGameResizeMessage({ type: "other", kind: "mahjong", gameId: "demo", height: 560 })).toBeNull();
    expect(parseGameResizeMessage({ type: "grokplay:resize", kind: "chess", gameId: "demo", height: 560 })).toBeNull();
    expect(parseGameResizeMessage({ type: "grokplay:resize", kind: "mahjong", gameId: "bad id", height: 560 })).toBeNull();
    expect(parseGameResizeMessage({ type: "grokplay:resize", kind: "mahjong", gameId: "demo", height: 900 })).toBeNull();
  });
});

describe("extractProfileHandle", () => {
  it("extracts the signed-in profile handle", () => {
    expect(extractProfileHandle("/larris")).toBe("larris");
    expect(extractProfileHandle("https://x.com/Profilist/")).toBe("Profilist");
  });

  it("rejects navigation and status paths", () => {
    expect(extractProfileHandle("/home")).toBeNull();
    expect(extractProfileHandle("/larris/status/123")).toBeNull();
    expect(extractProfileHandle(null)).toBeNull();
  });
});

describe("extractStatusHandle", () => {
  it("extracts the author from an X status link", () => {
    expect(
      extractStatusHandle([
        "/home",
        "https://x.com/larris/status/1234567890",
      ]),
    ).toBe("larris");
  });

  it("ignores generic status paths", () => {
    expect(extractStatusHandle(["/i/status/1234567890"])).toBeNull();
  });
});

describe("inferThemeFromColor", () => {
  it("recognizes X dark and light backgrounds", () => {
    expect(inferThemeFromColor("rgb(0, 0, 0)")).toBe("dark");
    expect(inferThemeFromColor("rgb(255, 255, 255)")).toBe("light");
  });

  it("ignores transparent or unknown colors", () => {
    expect(inferThemeFromColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(inferThemeFromColor("transparent")).toBeNull();
  });
});
