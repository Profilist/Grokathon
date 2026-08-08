import React from "react";
import { createRoot } from "react-dom/client";
import { GameCard, type PreviewMode } from "./GameCard";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const gameId = params.get("gameId") ?? "demo";
const hostHandle = params.get("hostHandle") ?? "host";
const viewerHandle = params.get("viewerHandle");
const theme = params.get("theme") === "light" ? "light" : "dark";
const preview = params.get("preview");
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
    <GameCard
      gameId={gameId}
      hostHandle={hostHandle}
      preview={previewStatus}
      theme={theme}
      viewerHandle={viewerHandle}
    />
  </React.StrictMode>,
);
