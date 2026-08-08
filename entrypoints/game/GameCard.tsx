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

const WAGER_AMOUNT = WAGER_STAKE_USD;
const MOVES: RpsMove[] = ["rock", "paper", "scissors"];

interface GameCardProps {
  gameId: string;
  hostHandle: string;
  preview: GameStatus | null;
  theme: "light" | "dark";
  viewerHandle: string | null;
}

function previewState(
  gameId: string,
  hostHandle: string,
  viewerHandle: string | null,
  preview: GameStatus,
): GameLobbyState {
  const hasGuest = preview !== "open";
  const lobby: GameLobby = {
    slug: gameId,
    host_user_id: "preview-host",
    host_handle: hostHandle,
    guest_user_id: hasGuest ? "preview-guest" : null,
    guest_handle: hasGuest ? viewerHandle ?? "teammate" : null,
    host_has_played: preview === "complete",
    guest_has_played: preview === "playing" || preview === "complete",
    host_move: preview === "complete" ? "rock" : null,
    guest_move: preview === "complete" ? "scissors" : null,
    winner: preview === "complete" ? "host" : null,
    status: preview,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    canJoin: preview === "open",
    canReplay: preview === "complete" && hasGuest,
    canSubmitMove: preview === "ready" || preview === "playing",
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
    role: hasGuest ? "guest" : "viewer",
    status: preview,
    submitMove: async () => undefined,
    userId: hasGuest ? "preview-guest" : "preview-viewer",
  };
}

function getStatusCopy(state: GameLobbyState, hostHandle: string): string {
  if (state.status === "unconfigured") return "Supabase setup required";
  if (state.status === "loading") return "Connecting…";
  if (state.status === "waiting_for_host") return `Waiting for @${hostHandle}`;
  if (state.status === "ready") return "Choose your move";
  if (state.status === "playing") return "Round in progress";
  if (state.status === "complete") return "Round complete";
  if (state.status === "error") return "Connection error";
  return "Lobby open";
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
}: {
  host: string;
  guest: string | null;
}) {
  return (
    <div className="rps-arena rps-arena--lobby">
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
    </div>
  );
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
  });
  const state = preview ? previewState(gameId, hostHandle, viewerHandle, preview) : liveState;
  const displayedHost = state.lobby?.host_handle ?? hostHandle;
  const displayedGuest = state.lobby?.guest_handle ?? null;
  const roundStarted =
    state.lobby?.status === "ready" ||
    state.lobby?.status === "playing" ||
    state.lobby?.status === "complete";
  const isPlayer = state.role === "host" || state.role === "guest";
  const hasPlayed = getPlayerHasPlayed(state.lobby, state.role);
  const arenaPhase =
    state.lobby?.status === "complete"
      ? "complete"
      : !isPlayer
        ? "spectating"
        : hasPlayed
          ? "waiting"
          : "selecting";
  const primaryEnabled =
    state.canJoin || state.status === "error" || state.canReplay;
  const moveEnabled = state.canSubmitMove && !state.isSubmittingMove;
  const result = state.lobby?.status === "complete" ? getResultDisplay(state) : null;

  const handlePrimaryClick = () => {
    if (state.status === "error") state.retry();
    else if (state.canReplay) void state.replay();
    else void state.join();
  };

  return (
    <main className="page" data-theme={theme}>
      <section className="game-card" aria-label="Grock Paper Scissors game">
        <header className="game-card__top">
          <div className="brand-col">
            <div className="brand">
              <span className="brand__mark" aria-hidden />
              <span className="brand__name">Grok Play</span>
            </div>
            <div className="title-block">
              <p className="eyebrow">Head - To - Head</p>
              <h1>Grock Paper Scissors</h1>
              <p className="status-line" aria-live="polite">
                {getStatusCopy(state, displayedHost)}
              </p>
            </div>
          </div>
          <div className="wager-box" aria-label={`$${WAGER_AMOUNT} wager`}>
            <strong>${WAGER_AMOUNT}</strong>
            <span>Wager</span>
          </div>
        </header>
        {roundStarted && state.lobby ? (
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
          <LobbyArena host={displayedHost} guest={displayedGuest} />
        )}

        <footer className="action-bar">
          {MOVES.map((move) => {
            const active = state.myMove === move;
            const label = move.charAt(0).toUpperCase() + move.slice(1);
            return (
              <button
                key={move}
                type="button"
                className={`move-btn${active ? " move-btn--active" : ""}`}
                disabled={!moveEnabled}
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

        {state.error ? (
          <p className="prototype-note prototype-note--error">{state.error}</p>
        ) : null}
      </section>
    </main>
  );
}
