import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { GameCard, type PreviewMode } from "./GameCard";
import { SpectateCard } from "./SpectateCard";
import type { GameStatus } from "../../src/lobby";
import { isGameType, type GameType } from "../../src/games/catalog";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const gameId = params.get("gameId") ?? "demo";
const gameKindParam = params.get("gameKind");
const gameKind: GameType = isGameType(gameKindParam) ? gameKindParam : "rps";
const hostHandle = params.get("hostHandle") ?? "host";
const hostAvatar = params.get("hostAvatar");
const viewerHandle = params.get("viewerHandle");
const theme = params.get("theme") === "light" ? "light" : "dark";
const card = params.get("card") === "watch" ? "watch" : "play";
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
const spectatePreviewModes: GameStatus[] = ["open", "ready", "playing", "complete"];
const spectatePreviewStatus: GameStatus | null = spectatePreviewModes.includes(
  preview as GameStatus,
)
  ? (preview as GameStatus)
  : null;

const MahjongCard = lazy(() =>
  import("./MahjongCard").then((module) => ({ default: module.MahjongCard })),
);

createRoot(root).render(
  <React.StrictMode>
    {card === "watch" ? (
      <SpectateCard
        authorAvatar={hostAvatar}
        authorHandle={hostHandle}
        gameId={gameId}
        gameType={gameKind}
        preview={spectatePreviewStatus}
        theme={theme}
        viewerHandle={viewerHandle}
      />
    ) : gameKind === "mahjong" ? (
      <Suspense fallback={<main className="page" data-theme={theme} />}>
        <MahjongCard
          gameId={gameId}
          hostHandle={hostHandle}
          theme={theme}
          viewerHandle={viewerHandle}
        />
      </Suspense>
    ) : (
      <GameCard
        gameId={gameId}
        hostHandle={hostHandle}
        preview={previewStatus}
        theme={theme}
        viewerHandle={viewerHandle}
      />
    )}
  </React.StrictMode>,
);
