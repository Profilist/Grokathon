# Grok Play Feed Demo

A Chrome extension prototype that attaches a static Rock Paper Scissors lobby to marked posts in the X feed.

## Run it

```bash
pnpm install
pnpm dev
```

WXT opens a development Chrome profile with the extension installed. Sign in to X in that profile, or build the extension and load it into your regular Chrome profile:

```bash
pnpm build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select:

```text
.output/chrome-mv3
```

## Trigger the card

Publish or view an X post containing this exact marker:

```text
[grokplay:demo]
```

For example:

```text
Does anyone want to play Rock Paper Scissors for $5?

[grokplay:demo]
```

The extension detects the marker and inserts the Grok Play lobby immediately above X's native reply, repost, and like controls. The current version is deliberately static: the Join button is disabled, no network request is made, and no money is moved.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm build
```

The extension reads only visible post markup needed to find the marker, theme, and post author. It does not read X cookies, use the X API, or store account data.
