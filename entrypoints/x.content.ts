import { browser } from "wxt/browser";
import {
  extractProfileHandle,
  extractStatusHandle,
  extractStatusId,
  getGameMountKey,
  inferThemeFromColor,
  parseCardTrigger,
  parseGameResizeMessage,
  type XTheme,
} from "../src/detection";
import { GAME_CATALOG, type GameType } from "../src/games/catalog";

const POST_SELECTOR = 'article[data-testid="tweet"]';
const HOST_ATTRIBUTE = "data-grokplay-host";
const MOUNT_KEY_ATTRIBUTE = "data-grokplay-mount-key";
const EXTENSION_ORIGIN = new URL(browser.runtime.getURL("/")).origin;

function findPostTheme(post: HTMLElement): XTheme {
  let element: HTMLElement | null = post;

  while (element) {
    const theme = inferThemeFromColor(getComputedStyle(element).backgroundColor);
    if (theme) return theme;
    element = element.parentElement;
  }

  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function findStatusHrefs(post: HTMLElement): string[] {
  const anchors = Array.from(post.querySelectorAll<HTMLAnchorElement>("a[href]"));
  const orderedAnchors = [
    ...anchors.filter((anchor) => anchor.querySelector("time")),
    ...anchors.filter((anchor) => !anchor.querySelector("time")),
  ];

  return orderedAnchors
    .map((anchor) => anchor.getAttribute("href"))
    .filter((href): href is string => href !== null);
}

function findPostText(post: HTMLElement): string {
  return post.querySelector<HTMLElement>('[data-testid="tweetText"]')?.innerText ?? post.innerText;
}

function findViewerHandle(): string | null {
  const profileLink = document.querySelector<HTMLAnchorElement>(
    'a[data-testid="AppTabBar_Profile_Link"]',
  );
  const profileHandle = extractProfileHandle(profileLink?.getAttribute("href") ?? null);
  if (profileHandle) return profileHandle;

  const accountSwitcher = document.querySelector<HTMLElement>(
    '[data-testid="SideNav_AccountSwitcher_Button"]',
  );
  return accountSwitcher?.innerText.match(/@([a-z0-9_]{1,32})/i)?.[1] ?? null;
}

function findActionBar(post: HTMLElement): HTMLElement | null {
  return (
    Array.from(post.querySelectorAll<HTMLElement>('[role="group"]')).find(
      (group) =>
        group.querySelector('[data-testid="reply"]') &&
        group.querySelector('[data-testid="like"]'),
    ) ?? null
  );
}

interface GameContext {
  gameId: string;
  gameType: GameType;
  hostHandle: string | null;
  viewerHandle: string | null;
  theme: XTheme;
}

function createGameHost(context: GameContext): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute(HOST_ATTRIBUTE, context.gameId);
  host.dataset.grokplayKind = context.gameType;
  host.setAttribute(
    MOUNT_KEY_ATTRIBUTE,
    getGameMountKey({ kind: context.gameType, gameId: context.gameId }),
  );
  host.style.cssText = [
    "display:block",
    "width:100%",
    "height:420px",
    "margin:12px 0 4px",
    "overflow:hidden",
    "border-radius:18px",
    "background:transparent",
  ].join(";");

  const iframeUrl = new URL(browser.runtime.getURL("/game.html"));
  iframeUrl.searchParams.set("gameId", context.gameId);
  iframeUrl.searchParams.set("gameKind", context.gameType);
  iframeUrl.searchParams.set("theme", context.theme);

  if (context.hostHandle) iframeUrl.searchParams.set("hostHandle", context.hostHandle);
  if (context.viewerHandle) iframeUrl.searchParams.set("viewerHandle", context.viewerHandle);

  const iframe = document.createElement("iframe");
  iframe.src = iframeUrl.toString();
  const gameLabel = GAME_CATALOG[context.gameType].shortTitle;
  iframe.title = `Grok Play ${gameLabel} game ${context.gameId}`;
  iframe.setAttribute("scrolling", "no");
  iframe.style.cssText = [
    "display:block",
    "width:100%",
    "height:100%",
    "border:0",
    "background:transparent",
  ].join(";");

  host.append(iframe);
  return host;
}

function syncPost(post: HTMLElement): void {
  const statusHrefs = findStatusHrefs(post);
  const marker = parseCardTrigger(findPostText(post), extractStatusId(statusHrefs));
  const existingHost = post.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`);

  if (!marker) {
    existingHost?.remove();
    return;
  }

  const context: GameContext = {
    gameId: marker.gameId,
    gameType: marker.gameType,
    hostHandle: extractStatusHandle(statusHrefs),
    viewerHandle: findViewerHandle(),
    theme: findPostTheme(post),
  };

  const mountKey = getGameMountKey({ kind: context.gameType, gameId: context.gameId });
  if (existingHost?.getAttribute(MOUNT_KEY_ATTRIBUTE) === mountKey) return;
  existingHost?.remove();

  const host = createGameHost(context);
  const actionBar = findActionBar(post);

  if (actionBar?.parentElement) {
    actionBar.parentElement.insertBefore(host, actionBar);
  } else {
    post.append(host);
  }
}

export default defineContentScript({
  matches: ["https://x.com/*"],

  main(ctx) {
    let scanQueued = false;

    const scan = () => {
      scanQueued = false;
      if (ctx.isInvalid) return;

      document
        .querySelectorAll<HTMLElement>(POST_SELECTOR)
        .forEach((post) => syncPost(post));
    };

    const scheduleScan = () => {
      if (scanQueued || ctx.isInvalid) return;
      scanQueued = true;
      ctx.requestAnimationFrame(scan);
    };

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });

    ctx.addEventListener(window, "wxt:locationchange", scheduleScan);
    ctx.addEventListener(window, "message", (event) => {
      if (event.origin !== EXTENSION_ORIGIN) return;
      const data = parseGameResizeMessage(event.data);
      if (!data) return;

      const host = Array.from(
        document.querySelectorAll<HTMLElement>(`[${HOST_ATTRIBUTE}]`),
      ).find(
        (candidate) =>
          candidate.getAttribute(HOST_ATTRIBUTE) === data.gameId &&
          candidate.dataset.grokplayKind === data.kind &&
          candidate.querySelector("iframe")?.contentWindow === event.source,
      );
      if (host) host.style.height = `${data.height}px`;
    });
    ctx.onInvalidated(() => {
      observer.disconnect();
      document
        .querySelectorAll<HTMLElement>(`[${HOST_ATTRIBUTE}]`)
        .forEach((host) => host.remove());
    });

    scan();
  },
});
