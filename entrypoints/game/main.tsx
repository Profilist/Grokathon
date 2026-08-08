import React from "react";
import { createRoot } from "react-dom/client";
import { GameCard } from "./GameCard";
import type { GameStatus } from "../../src/lobby";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const gameId = params.get("gameId") ?? "demo";
const hostHandle = params.get("hostHandle") ?? "host";
const viewerHandle = params.get("viewerHandle");
const theme = params.get("theme") === "light" ? "light" : "dark";
const preview = params.get("preview");
const root = document.getElementById("root");

if (!root) throw new Error("Grok Play root element is missing");

const previewStatus: GameStatus | null =
  preview === "open" ||
  preview === "ready" ||
  preview === "playing" ||
  preview === "complete"
    ? preview
    : null;

createRoot(root).render(
  <React.StrictMode>
    <GameCard
      gameId={gameId}
      hostHandle={hostHandle}
      preview={previewStatus}
      theme={theme}
      viewerHandle={viewerHandle}
    />
  </React.StrictMode>,
);
