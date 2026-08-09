import React from "react";
import { createRoot } from "react-dom/client";
import type { PreviewMode } from "./GameCard";
import { GameRouter } from "./GameRouter";
import { isGameType, type GameType } from "../../src/games/catalog";
import "./styles.css";

// Prefer search params; fall back to hash (Glass open_resource double-encodes `?` queries).
const params = new URLSearchParams(window.location.search);
const hashParams = new URLSearchParams(
  window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash,
);
const param = (key: string) => params.get(key) ?? hashParams.get(key);
const gameId = param("gameId") ?? "demo";
const gameKindParam = param("gameKind");
const gameKind: GameType = isGameType(gameKindParam) ? gameKindParam : "rps";
const hostHandle = param("hostHandle") ?? "host";
const viewerHandle = param("viewerHandle");
const theme = param("theme") === "light" ? "light" : "dark";
// Allow local static previews (production build via http.server) as well as DEV.
const preview = param("preview");
const root = document.getElementById("root");

if (!root) throw new Error("Grok Play root element is missing");

const previewModes: PreviewMode[] = [
  "open",
  "full",
  "joined",
  "ready",
  "playing",
  "complete",
];
const previewStatus: PreviewMode | null = previewModes.includes(preview as PreviewMode)
  ? (preview as PreviewMode)
  : null;

createRoot(root).render(
  <React.StrictMode>
    <GameRouter
      gameId={gameId}
      hostHandle={hostHandle}
      initialGameType={gameKind}
      preview={previewStatus}
      theme={theme}
      viewerHandle={viewerHandle}
    />
  </React.StrictMode>,
);
