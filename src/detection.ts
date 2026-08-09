import { gameTypeFromSlug, isGameType, type GameType } from "./games/catalog";

// [grokplay:friday-table]        shared lobby; host chooses game and wager
// [grokplay:mahjong:table_12]    legacy form; preselects Mahjong in setup
// [grokplay:poker-night@25]      legacy metadata remains parse-compatible
const CARD_MARKER_PATTERN =
  /\[grokplay:(?:(rps|mahjong|poker):)?([a-z0-9][a-z0-9_-]{0,63})(?:@\$?(\d{1,6}(?:\.\d{1,2})?))?\]/i;
const STATUS_PATH_PATTERN = /^\/([^/]+)\/status\/\d+(?:\/|$)/;
const PROFILE_PATH_PATTERN = /^\/([a-z0-9_]{1,32})\/?$/i;
const RESERVED_X_PATHS = new Set([
  "compose",
  "explore",
  "home",
  "i",
  "messages",
  "notifications",
  "search",
  "settings",
]);

export type XTheme = "light" | "dark";

export type GameReference = { kind: GameType; gameId: string };
export type GameResizeMessage = GameReference & {
  type: "grokplay:resize";
  height: 360 | 560;
};

export interface CardMarker {
  gameId: string;
  gameType: GameType;
  /** Legacy marker metadata. New lobbies choose the wager in the setup card. */
  wagerCents: number | null;
}

export function parseCardMarker(text: string): CardMarker | null {
  const match = text.match(CARD_MARKER_PATTERN);
  const gameId = match?.[2];
  if (!gameId) return null;

  const explicitType = match[1]?.toLowerCase();
  const wager = match[3];

  // The keyword and type segments are matched case insensitively, but the id is
  // the Postgres `slug` primary key and its check constraint preserves case, so
  // keep it verbatim.
  return {
    gameId,
    gameType: isGameType(explicitType) ? explicitType : gameTypeFromSlug(gameId),
    wagerCents: wager === undefined ? null : Math.round(Number(wager) * 100),
  };
}

export function parseGameResizeMessage(value: unknown): GameResizeMessage | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  if (
    candidate.type !== "grokplay:resize" ||
    !isGameType(candidate.kind) ||
    typeof candidate.gameId !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(candidate.gameId) ||
    (candidate.height !== 360 && candidate.height !== 560)
  ) return null;

  return candidate as unknown as GameResizeMessage;
}

export function extractStatusHandle(hrefs: string[]): string | null {
  for (const href of hrefs) {
    let pathname: string;

    try {
      pathname = new URL(href, "https://x.com").pathname;
    } catch {
      continue;
    }

    const handle = pathname.match(STATUS_PATH_PATTERN)?.[1];
    if (handle && handle.toLowerCase() !== "i") {
      return handle;
    }
  }

  return null;
}

export function extractProfileHandle(href: string | null): string | null {
  if (!href) return null;

  try {
    const handle = new URL(href, "https://x.com").pathname.match(PROFILE_PATH_PATTERN)?.[1];
    if (!handle || RESERVED_X_PATHS.has(handle.toLowerCase())) return null;
    return handle;
  } catch {
    return null;
  }
}

export function inferThemeFromColor(color: string): XTheme | null {
  const components = color.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d+(?:\.\d+)?))?\s*\)/i,
  );

  if (!components) return null;

  const alpha = components[4] === undefined ? 1 : Number(components[4]);
  if (alpha === 0) return null;

  const red = Number(components[1]) / 255;
  const green = Number(components[2]) / 255;
  const blue = Number(components[3]) / 255;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

  return luminance < 0.5 ? "dark" : "light";
}
