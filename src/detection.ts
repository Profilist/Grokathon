const GAME_MARKER_PATTERN = /\[grokplay:([a-z0-9][a-z0-9_-]{0,63})\]/i;
const STATUS_PATH_PATTERN = /^\/([^/]+)\/status\/\d+(?:\/|$)/;

export type XTheme = "light" | "dark";

export function parseGameMarker(text: string): string | null {
  return text.match(GAME_MARKER_PATTERN)?.[1] ?? null;
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
