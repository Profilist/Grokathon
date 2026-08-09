import { useEffect, useState } from "react";
import { ArenaBackdrop } from "./ArenaBackdrop";
import type { GameListingState } from "./useGameListing";
import { GAME_CATALOG, formatCents, type GameType } from "../../src/games/catalog";
import { WAGER_PRESETS_CENTS } from "../../src/games/listing";
import grokAvatar from "../../assets/grok.jpeg";

const SELECTABLE_GAMES: GameType[] = ["rps", "mahjong"];

type Props = {
  gameId: string;
  hostHandle: string;
  initialGameType: GameType;
  state: GameListingState;
  theme: "light" | "dark";
};

export function GameSetupCard({
  gameId,
  hostHandle,
  initialGameType,
  state,
  theme,
}: Props) {
  const safeInitialType = initialGameType === "mahjong" ? "mahjong" : "rps";
  const [gameType, setGameType] = useState<GameType>(safeInitialType);
  const [wagerCents, setWagerCents] = useState(
    GAME_CATALOG[safeInitialType].defaultWagerCents,
  );

  useEffect(() => {
    setGameType(safeInitialType);
    setWagerCents(GAME_CATALOG[safeInitialType].defaultWagerCents);
  }, [gameId, safeInitialType]);

  const chooseGame = (nextType: GameType) => {
    setGameType(nextType);
    setWagerCents(GAME_CATALOG[nextType].defaultWagerCents);
  };

  const unavailable =
    state.status === "loading" ||
    state.status === "unconfigured" ||
    state.status === "error";

  return (
    <main className="page" data-theme={theme}>
      <section className="game-card game-setup-card" aria-label="Create a Grok Play game">
        <header className="game-card__top">
          <div className="brand-col">
            <div className="brand">
              <img className="brand__mark" src={grokAvatar} alt="" width={28} height={28} aria-hidden />
              <span className="brand__name">Grok Play</span>
            </div>
            <div className="title-block">
              <p className="eyebrow">CHOOSE YOUR CHALLENGE</p>
              <h1>Create a game</h1>
            </div>
          </div>
          <div className="wager-box" aria-label={`${formatCents(wagerCents)} wager`}>
            <strong>{formatCents(wagerCents).replace(".00", "")}</strong>
            <span>Wager</span>
          </div>
        </header>

        <div className="game-setup-stage">
          <ArenaBackdrop />
          {state.canConfigure ? (
            <div className="game-setup-panel">
              <div className="game-picker" role="radiogroup" aria-label="Choose a game">
                {SELECTABLE_GAMES.map((type) => {
                  const spec = GAME_CATALOG[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={gameType === type}
                      className={`game-picker__option${gameType === type ? " is-selected" : ""}`}
                      onClick={() => chooseGame(type)}
                    >
                      <span className="game-picker__emoji" aria-hidden>{spec.emoji}</span>
                      <span><strong>{spec.shortTitle}</strong><small>{spec.seats} players</small></span>
                    </button>
                  );
                })}
              </div>

              <div className="wager-picker">
                <span>Choose wager</span>
                <div role="radiogroup" aria-label="Choose wager amount">
                  {WAGER_PRESETS_CENTS.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      role="radio"
                      aria-checked={wagerCents === amount}
                      className={wagerCents === amount ? "is-selected" : ""}
                      onClick={() => setWagerCents(amount)}
                    >
                      {formatCents(amount).replace(".00", "")}
                    </button>
                  ))}
                </div>
              </div>
              <p className="game-setup-note">Concept wager only · no money is moved</p>
            </div>
          ) : (
            <div className="game-setup-waiting" aria-live="polite">
              <small>Lobby #{gameId}</small>
              <strong>Waiting for @{hostHandle.replace(/^@/, "")}</strong>
              <span>The post author is choosing the game and wager.</span>
            </div>
          )}
        </div>

        <footer className="action-bar action-bar--confirm">
          {state.canConfigure ? (
            <button
              type="button"
              className="primary-btn"
              disabled={state.isCreating || unavailable}
              onClick={() => void state.createGame(gameType, wagerCents)}
            >
              {state.isCreating ? "Creating…" : `Create ${GAME_CATALOG[gameType].shortTitle} Game`}
            </button>
          ) : (
            <button type="button" className="primary-btn" disabled aria-disabled>
              Waiting for host
            </button>
          )}
        </footer>

        {unavailable ? (
          <p className="prototype-note prototype-note--error">
            {state.status === "unconfigured" ? "Supabase setup required" : state.error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
