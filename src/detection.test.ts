import { describe, expect, it } from "vitest";
import {
  extractProfileHandle,
  extractStatusHandle,
  inferThemeFromColor,
  parseCardMarker,
  parseGameResizeMessage,
} from "./detection";

describe("parseCardMarker", () => {
  it("extracts a game id from a marked post", () => {
    expect(parseCardMarker("Who wants to play? [grokplay:demo]")).toEqual({
      card: "play",
      gameId: "demo",
      gameType: "rps",
      wagerCents: null,
    });
  });

  it("recognizes the spectate marker", () => {
    expect(parseCardMarker("Come watch this one [grokwatch:demo]")).toEqual({
      card: "watch",
      gameId: "demo",
      gameType: "rps",
      wagerCents: null,
    });
  });

  it("reads the game type from the slug prefix", () => {
    expect(parseCardMarker("[grokplay:mahjong-friday]")?.gameType).toBe("mahjong");
    expect(parseCardMarker("[grokplay:poker-night]")?.gameType).toBe("poker");
    expect(parseCardMarker("[grokplay:rps-demo]")?.gameType).toBe("rps");
  });

  it("still routes the explicit game type segment", () => {
    expect(parseCardMarker("Four seats open [grokplay:mahjong:table_12]")).toEqual({
      card: "play",
      gameId: "table_12",
      gameType: "mahjong",
      wagerCents: null,
    });
    expect(parseCardMarker("[grokwatch:mahjong:table_12]")?.card).toBe("watch");
  });

  it("falls back to rock paper scissors for unprefixed slugs", () => {
    expect(parseCardMarker("[grokplay:demo]")?.gameType).toBe("rps");
    expect(parseCardMarker("[grokplay:chess-club]")?.gameType).toBe("rps");
  });

  it("reads an optional wager suffix", () => {
    expect(parseCardMarker("[grokplay:mahjong-friday@25]")).toEqual({
      card: "play",
      gameId: "mahjong-friday",
      gameType: "mahjong",
      wagerCents: 2500,
    });
    expect(parseCardMarker("[grokwatch:rps-demo@18.75]")?.wagerCents).toBe(1875);
    expect(parseCardMarker("[grokplay:rps-demo@$5]")?.wagerCents).toBe(500);
    expect(parseCardMarker("[grokplay:mahjong:table_12@40]")?.wagerCents).toBe(4000);
  });

  it("is case insensitive while preserving the id", () => {
    expect(parseCardMarker("[GROKPLAY:Rps_12]")).toEqual({
      card: "play",
      gameId: "Rps_12",
      gameType: "rps",
      wagerCents: null,
    });
    expect(parseCardMarker("[GrokWatch:Rps_12]")?.card).toBe("watch");
    expect(parseCardMarker("[grokplay:MAHJONG:Table_12]")?.gameType).toBe("mahjong");
  });

  it("rejects malformed and missing markers", () => {
    expect(parseCardMarker("grokplay:demo")).toBeNull();
    expect(parseCardMarker("[grokplay:bad id]")).toBeNull();
    expect(parseCardMarker("[grokwatch:-leading-hyphen]")).toBeNull();
    expect(parseCardMarker("[grokstream:demo]")).toBeNull();
    expect(parseCardMarker("ordinary post")).toBeNull();
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
