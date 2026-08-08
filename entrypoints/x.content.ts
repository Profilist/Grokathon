import { browser } from "wxt/browser";
import {
  extractStatusHandle,
  inferThemeFromColor,
  parseGameMarker,
  type XTheme,
} from "../src/detection";

const POST_SELECTOR = 'article[data-testid="tweet"]';
const HOST_ATTRIBUTE = "data-grokplay-host";

function findPostTheme(post: HTMLElement): XTheme {
  let element: HTMLElement | null = post;

  while (element) {
    const theme = inferThemeFromColor(getComputedStyle(element).backgroundColor);
    if (theme) return theme;
    element = element.parentElement;
  }

  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function findAuthorHandle(post: HTMLElement): string | null {
  const hrefs = Array.from(post.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .map((anchor) => anchor.getAttribute("href"))
    .filter((href): href is string => href !== null);

  return extractStatusHandle(hrefs);
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

function createGameHost(post: HTMLElement, gameId: string): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute(HOST_ATTRIBUTE, gameId);
  host.style.cssText = [
    "display:block",
    "width:100%",
    "height:360px",
    "margin:12px 0 4px",
    "overflow:hidden",
    "border-radius:16px",
    "background:transparent",
  ].join(";");

  const iframeUrl = new URL(browser.runtime.getURL("/game.html"));
  iframeUrl.searchParams.set("gameId", gameId);
  iframeUrl.searchParams.set("theme", findPostTheme(post));

  const hostHandle = findAuthorHandle(post);
  if (hostHandle) iframeUrl.searchParams.set("hostHandle", hostHandle);

  const iframe = document.createElement("iframe");
  iframe.src = iframeUrl.toString();
  iframe.title = `Grok Play game ${gameId}`;
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
  const gameId = parseGameMarker(post.innerText);
  const existingHost = post.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`);

  if (!gameId) {
    existingHost?.remove();
    return;
  }

  if (existingHost?.getAttribute(HOST_ATTRIBUTE) === gameId) return;
  existingHost?.remove();

  const host = createGameHost(post, gameId);
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
    ctx.onInvalidated(() => {
      observer.disconnect();
      document
        .querySelectorAll<HTMLElement>(`[${HOST_ATTRIBUTE}]`)
        .forEach((host) => host.remove());
    });

    scan();
  },
});
