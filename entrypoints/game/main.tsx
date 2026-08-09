import React from "react";
import { createRoot } from "react-dom/client";
import type { PreviewMode } from "./GameCard";
import { GameRouter } from "./GameRouter";
import { isGameType, type GameType } from "../../src/games/catalog";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const gameId = params.get("gameId") ?? "demo";
const gameKindParam = params.get("gameKind");
const gameKind: GameType = isGameType(gameKindParam) ? gameKindParam : "rps";
const hostHandle = params.get("hostHandle") ?? "host";
const viewerHandle = params.get("viewerHandle");
const theme = params.get("theme") === "light" ? "light" : "dark";
const preview = import.meta.env.DEV ? params.get("preview") : null;
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
