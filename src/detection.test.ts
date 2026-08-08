import { describe, expect, it } from "vitest";
import {
  extractStatusHandle,
  inferThemeFromColor,
  parseGameMarker,
} from "./detection";

describe("parseGameMarker", () => {
  it("extracts a game id from a marked post", () => {
    expect(parseGameMarker("Who wants to play? [grokplay:demo]")).toBe(
      "demo",
    );
  });

  it("is case insensitive while preserving the id", () => {
    expect(parseGameMarker("[GROKPLAY:Rps_12]")).toBe("Rps_12");
  });

  it("rejects malformed and missing markers", () => {
    expect(parseGameMarker("grokplay:demo")).toBeNull();
    expect(parseGameMarker("[grokplay:bad id]")).toBeNull();
    expect(parseGameMarker("ordinary post")).toBeNull();
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
