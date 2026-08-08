import { useEffect, useState, type ReactNode } from "react";
import { useGameLobby, type GameLobbyState } from "./useGameLobby";
import { ArenaBackdrop } from "./ArenaBackdrop";
import { RpsArena3D } from "./RpsArena3D";
import { WAGER_STAKE_USD } from "./concept";
import {
  getPlayerHasPlayed,
  getPlayerResult,
  type GameLobby,
  type GameStatus,
  type RpsMove,
} from "../../src/lobby";
import grokAvatar from "../../assets/grok.jpeg";

const WAGER_AMOUNT = WAGER_STAKE_USD;
const MOVES: RpsMove[] = ["rock", "paper", "scissors"];

export type PreviewMode = GameStatus | "full" | "joined";

type UiPhase = "open" | "full" | "wagerConfirm" | "spectating" | "playing" | "complete";

interface GameCardProps {
  gameId: string;
  hostHandle: string;
  preview: PreviewMode | null;
  theme: "light" | "dark";
  viewerHandle: string | null;
}

function previewState(
  gameId: string,
  hostHandle: string,
  viewerHandle: string | null,
  preview: PreviewMode,
  opts: { previewJoined: boolean; isSpectating: boolean },
): GameLobbyState {
  const isOpen = preview === "open" && !opts.previewJoined;
  const isJoinedPreview = preview === "joined" || opts.previewJoined;
  const isFull = preview === "full";
  const lobbyStatus: GameStatus = isOpen
    ? "open"
    : isJoinedPreview || isFull || preview === "ready"
      ? "ready"
      : preview === "playing"
        ? "playing"
        : preview === "complete"
          ? "complete"
          : "ready";

  const hasGuest = !isOpen;
  const resolvedRole =
    isOpen || (isFull && !opts.isSpectating)
      ? "viewer"
      : isFull && opts.isSpectating
        ? "viewer"
        : isJoinedPreview ||
            preview === "ready" ||
            preview === "playing" ||
            preview === "complete"
          ? "guest"
          : "viewer";

  const lobby: GameLobby = {
    slug: gameId,
    host_user_id: "preview-host",
    host_handle: hostHandle,
    guest_user_id: hasGuest ? "preview-guest" : null,
    guest_handle: hasGuest
      ? isFull
        ? "teammate"
        : (viewerHandle ?? "teammate")
      : null,
    host_has_played: preview === "complete",
    guest_has_played: preview === "playing" || preview === "complete",
    host_move: preview === "complete" ? "rock" : null,
    guest_move: preview === "complete" ? "scissors" : null,
    winner: preview === "complete" ? "host" : null,
    status: lobbyStatus,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    canJoin: isOpen,
    canReplay: preview === "complete",
    canSubmitMove:
      resolvedRole === "guest" &&
      (lobbyStatus === "ready" || lobbyStatus === "playing") &&
      preview !== "complete",
    error: null,
    isJoining: false,
    isReplaying: false,
    isSubmittingMove: false,
    isRealtimeConnected: true,
    join: async () => undefined,
    lobby,
    myMove: preview === "playing" ? "paper" : preview === "complete" ? "scissors" : null,
    replay: async () => undefined,
    retry: () => undefined,
    role: resolvedRole,
    status: lobbyStatus,
    submitMove: async () => undefined,
    userId: resolvedRole === "guest" ? "preview-guest" : "preview-viewer",
  };
}

function getPrimaryActionCopy(state: GameLobbyState): string {
  if (state.isJoining) return "Joining…";
  if (state.isReplaying) return "Resetting…";
  if (state.status === "error") return "Try again";
  if (state.canReplay) return "Play again";
  if (state.role === "host") return "Waiting…";
  if (state.canJoin) return "Join Game";
  return "Join Game";
}

function getResultDisplay(state: GameLobbyState) {
  const lobby = state.lobby!;
  const result = getPlayerResult(lobby, state.role);

  if (result === "draw" || lobby.winner === "draw") {
    return { handle: null, text: "It's a draw" };
  }

  if (result === "won") {
    return { handle: null, text: "You won!" };
  }

  if (result === "lost") {
    return { handle: null, text: "You lost" };
  }

  const winningHandle =
    lobby.winner === "host" ? lobby.host_handle : lobby.guest_handle;

  return {
    handle: winningHandle ? `@${winningHandle.replace(/^@/, "")}` : null,
    text: "wins!",
  };
}

function LobbyArena({
  host,
  guest,
  mode,
  wagerAmount,
}: {
  host: string;
  guest: string | null;
  mode: "open" | "full" | "wagerConfirm" | "spectating";
  wagerAmount: number;
}) {
  return (
    <div className={`rps-arena rps-arena--lobby rps-arena--${mode}`}>
      <ArenaBackdrop />
      <div className="arena-scoreboard">
        <span>@{host.replace(/^@/, "")}</span>
        <b>vs</b>
        <span>{guest ? `@${guest.replace(/^@/, "")}` : "Waiting…"}</span>
      </div>
      <div className="arena-stage" aria-hidden>
        <div className="arena-stage__dome" />
        <div className="arena-stage__pad" />
        <div className="arena-stage__ring" />
      </div>

      {mode === "open" ? (
        <div className="arena-lobby-overlay" aria-live="polite">
          <small>Seat open</small>
          <strong className="arena-lobby-overlay__headline">
            Challenge @{host.replace(/^@/, "")}
          </strong>
          <span className="arena-lobby-overlay__detail">
            Join to lock your ${wagerAmount} wager
          </span>
        </div>
      ) : null}

      {mode === "full" ? (
        <div className="arena-lobby-overlay" aria-live="polite">
          <small>Game full</small>
          <strong className="arena-lobby-overlay__headline">Spectate only</strong>
          <span className="arena-lobby-overlay__detail">Both seats are taken</span>
        </div>
      ) : null}

      {mode === "spectating" ? (
        <div className="arena-lobby-overlay" aria-live="polite">
          <small>Spectating</small>
          <strong className="arena-lobby-overlay__headline">Waiting for players</strong>
          <span className="arena-lobby-overlay__detail">Moves reveal together</span>
        </div>
      ) : null}

      {mode === "wagerConfirm" ? (
        <div className="arena-money-overlay" aria-live="polite">
          <small className="arena-money-overlay__brand">X Money</small>
          <strong className="arena-money-overlay__title">Wager secured</strong>
          <span className="arena-money-overlay__amount">-${wagerAmount}</span>
          <span className="arena-money-overlay__detail">
            Deducted from your X Money balance
          </span>
        </div>
      ) : null}
    </div>
  );
}

function deriveUiPhase({
  preview,
  state,
  isSpectating,
  showWagerConfirm,
}: {
  preview: PreviewMode | null;
  state: GameLobbyState;
  isSpectating: boolean;
  showWagerConfirm: boolean;
}): UiPhase {
  if (showWagerConfirm) return "wagerConfirm";
  if (state.lobby?.status === "complete" || preview === "complete") return "complete";

  const seatOpen = state.lobby?.status === "open";
  const seatTaken = Boolean(state.lobby?.guest_user_id);
  const isViewer = state.role === "viewer";
  const roundActive =
    state.lobby?.status === "ready" || state.lobby?.status === "playing";

  if (isSpectating) {
    if (seatTaken && roundActive) return "playing";
    return "spectating";
  }

  if (seatOpen && isViewer) return "open";
  if (isViewer && seatTaken) return "full";
  if (roundActive || state.role === "host" || state.role === "guest") return "playing";
  return "open";
}

export function GameCard({
  gameId,
  hostHandle,
  preview,
  theme,
  viewerHandle,
}: GameCardProps) {
  const liveState = useGameLobby({
    enabled: preview === null,
    gameId,
    hostHandle,
    viewerHandle,
    wagerCents: WAGER_AMOUNT * 100,
  });
  const [isSpectating, setIsSpectating] = useState(false);
  const [showWagerConfirm, setShowWagerConfirm] = useState(preview === "joined");
  const [previewJoined, setPreviewJoined] = useState(false);
  const [joinedPendingConfirm, setJoinedPendingConfirm] = useState(false);

  const state = preview
    ? previewState(gameId, hostHandle, viewerHandle, preview, {
        previewJoined,
        isSpectating,
      })
    : liveState;

  useEffect(() => {
    setIsSpectating(false);
    setShowWagerConfirm(preview === "joined");
    setPreviewJoined(false);
    setJoinedPendingConfirm(false);
  }, [preview, gameId]);

  useEffect(() => {
    if (preview !== null || !joinedPendingConfirm) return;
    if (state.role === "guest") {
      setShowWagerConfirm(true);
      setJoinedPendingConfirm(false);
    }
  }, [joinedPendingConfirm, preview, state.role]);

  const displayedHost = state.lobby?.host_handle ?? hostHandle;
  const displayedGuest = state.lobby?.guest_handle ?? null;
  const uiPhase = deriveUiPhase({ preview, state, isSpectating, showWagerConfirm });
  const isPlayer = state.role === "host" || state.role === "guest";
  const hasPlayed = getPlayerHasPlayed(state.lobby, state.role);
  const movesUnlocked =
    !showWagerConfirm && isPlayer && state.canSubmitMove && !state.isSubmittingMove;
  const arenaPhase =
    state.lobby?.status === "complete"
      ? "complete"
      : !isPlayer
        ? "spectating"
        : hasPlayed
          ? "waiting"
          : "selecting";
  const result = state.lobby?.status === "complete" ? getResultDisplay(state) : null;
  const showPlayArena =
    (uiPhase === "playing" || uiPhase === "complete") &&
    Boolean(
      state.lobby &&
        (state.lobby.status === "ready" ||
          state.lobby.status === "playing" ||
          state.lobby.status === "complete"),
    );

  const handleJoin = async () => {
    if (preview === "open") {
      setPreviewJoined(true);
      setShowWagerConfirm(true);
      return;
    }
    setJoinedPendingConfirm(true);
    await state.join();
  };

  const handleSpectate = () => {
    setIsSpectating(true);
  };

  const handleContinue = () => {
    setShowWagerConfirm(false);
  };

  const handlePrimaryClick = () => {
    if (state.status === "error") state.retry();
    else if (state.canReplay) void state.replay();
    else void handleJoin();
  };

  let actionBar: ReactNode;
  if (uiPhase === "open") {
    actionBar = (
      <footer className="action-bar action-bar--lobby">
        <button type="button" className="move-btn" onClick={handleSpectate}>
          Spectate
        </button>
        <button
          type="button"
          className="primary-btn"
          disabled={state.isJoining}
          aria-disabled={state.isJoining}
          onClick={() => void handleJoin()}
        >
          {state.isJoining ? "Joining…" : "Join Game"}
        </button>
      </footer>
    );
  } else if (uiPhase === "full") {
    actionBar = (
      <footer className="action-bar action-bar--confirm">
        <button type="button" className="primary-btn" onClick={handleSpectate}>
          Spectate
        </button>
      </footer>
    );
  } else if (uiPhase === "wagerConfirm") {
    actionBar = (
      <footer className="action-bar action-bar--confirm">
        <button type="button" className="primary-btn" onClick={handleContinue}>
          Continue
        </button>
      </footer>
    );
  } else if (uiPhase === "spectating" && !showPlayArena) {
    actionBar = (
      <footer className="action-bar action-bar--confirm">
        <button type="button" className="primary-btn" disabled aria-disabled>
          Spectating
        </button>
      </footer>
    );
  } else {
    const primaryEnabled =
      state.canJoin || state.status === "error" || state.canReplay;
    actionBar = (
      <footer className="action-bar">
        {MOVES.map((move) => {
          const active = state.myMove === move;
          const label = move.charAt(0).toUpperCase() + move.slice(1);
          return (
            <button
              key={move}
              type="button"
              className={`move-btn${active ? " move-btn--active" : ""}`}
              disabled={!movesUnlocked}
              aria-pressed={active}
              onClick={() => void state.submitMove(move)}
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          className="primary-btn"
          disabled={!primaryEnabled || state.isJoining || state.isReplaying}
          aria-disabled={!primaryEnabled || state.isJoining || state.isReplaying}
          onClick={handlePrimaryClick}
        >
          {getPrimaryActionCopy(state)}
        </button>
      </footer>
    );
  }

  const lobbyMode: "open" | "full" | "wagerConfirm" | "spectating" =
    uiPhase === "wagerConfirm"
      ? "wagerConfirm"
      : uiPhase === "full"
        ? "full"
        : uiPhase === "spectating"
          ? "spectating"
          : "open";

  const lobbyGuest =
    lobbyMode === "open"
      ? null
      : lobbyMode === "wagerConfirm"
        ? (displayedGuest ?? viewerHandle ?? "you")
        : displayedGuest;

  return (
    <main className="page" data-theme={theme}>
      <section className="game-card" aria-label="Grock Paper Scissors game">
        <header className="game-card__top">
          <div className="brand-col">
            <div className="brand">
              <img
                className="brand__mark"
                src={grokAvatar}
                alt=""
                width={28}
                height={28}
                aria-hidden
              />
              <span className="brand__name">Grok Play</span>
            </div>
            <div className="title-block">
              <p className="eyebrow">Head - To - Head</p>
              <h1>Grock Paper Scissors</h1>
            </div>
          </div>
          <div className="wager-box" aria-label={`$${WAGER_AMOUNT} wager`}>
            <strong>${WAGER_AMOUNT}</strong>
            <span>Wager</span>
          </div>
        </header>
        {showPlayArena && state.lobby ? (
          <RpsArena3D
            guestHandle={state.lobby.guest_handle ?? "challenger"}
            guestLocked={state.lobby.guest_has_played}
            guestMove={state.lobby.guest_move}
            hostHandle={state.lobby.host_handle}
            hostLocked={state.lobby.host_has_played}
            hostMove={state.lobby.host_move}
            isSubmitting={state.isSubmittingMove}
            phase={arenaPhase}
            result={result}
            selectedMove={state.myMove}
            wagerAmount={WAGER_AMOUNT}
            winner={state.lobby.winner}
          />
        ) : (
          <LobbyArena
            host={displayedHost}
            guest={lobbyGuest}
            mode={lobbyMode}
            wagerAmount={WAGER_AMOUNT}
          />
        )}

        {actionBar}
      </section>
    </main>
  );
}
