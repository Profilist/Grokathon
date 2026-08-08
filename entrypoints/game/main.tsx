import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { GameCard } from "./GameCard";
import type { GameStatus } from "../../src/lobby";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const gameId = params.get("gameId") ?? "demo";
const gameKind = params.get("gameKind") === "mahjong" ? "mahjong" : "rps";
const hostHandle = params.get("hostHandle") ?? "host";
const viewerHandle = params.get("viewerHandle");
const theme = params.get("theme") === "light" ? "light" : "dark";
const preview = import.meta.env.DEV ? params.get("preview") : null;
const root = document.getElementById("root");

if (!root) throw new Error("Grok Play root element is missing");

const previewStatus: GameStatus | null =
  preview === "open" ||
  preview === "ready" ||
  preview === "playing" ||
  preview === "complete"
    ? preview
    : null;

const MahjongCard = lazy(() =>
  import("./MahjongCard").then((module) => ({ default: module.MahjongCard })),
);

createRoot(root).render(
  <React.StrictMode>
    {gameKind === "mahjong" ? (
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
