import React from "react";
import { createRoot } from "react-dom/client";
import { GameCard } from "./GameCard";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const gameId = params.get("gameId") ?? "demo";
const hostHandle = params.get("hostHandle") ?? "host";
const theme = params.get("theme") === "light" ? "light" : "dark";
const root = document.getElementById("root");

if (!root) throw new Error("Grok Play root element is missing");

createRoot(root).render(
  <React.StrictMode>
    <GameCard gameId={gameId} hostHandle={hostHandle} theme={theme} />
  </React.StrictMode>,
);
