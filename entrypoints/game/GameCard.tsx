import { useGameLobby, type GameLobbyState } from "./useGameLobby";
import { RpsArena3D } from "./RpsArena3D";
import {
  GAME_TITLE,
  WAGER_POT_USD,
  WAGER_STAKE_USD,
  formatUsd,
} from "./concept";
import {
  getPlayerHasPlayed,
  getPlayerResult,
  type GameLobby,
  type GameStatus,
} from "../../src/lobby";

interface GameCardProps {
  gameId: string;
  hostHandle: string;
  preview: GameStatus | null;
  theme: "light" | "dark";
  viewerHandle: string | null;
}

function Avatar({ label, waiting = false }: { label: string; waiting?: boolean }) {
  return (
    <div className={`avatar${waiting ? " avatar--waiting" : ""}`} aria-hidden>
      {waiting ? "?" : label.slice(0, 1).toUpperCase()}
    </div>
  );
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

function getButtonCopy(state: GameLobbyState): string {
  if (state.isJoining) return "Joining…";
  if (state.status === "error") return "Try again";
  if (state.role === "host") return "Waiting for player";
  if (state.canJoin) return "Join game";
  return "Join unavailable";
}

function LobbyPlayers({ host, guest }: { host: string; guest: string | null }) {
  return (
    <div className="players">
      <div className="player">
        <Avatar label={host} />
        <strong>@{host.replace(/^@/, "")}</strong>
        <span>Host</span>
      </div>

      <div className="versus" aria-label="versus">
        VS
      </div>

      <div className={`player${guest ? "" : " player--waiting"}`}>
        <Avatar label={guest ?? ""} waiting={!guest} />
        <strong>{guest ? `@${guest.replace(/^@/, "")}` : "Waiting…"}</strong>
        <span>{guest ? "Challenger" : "1 seat open"}</span>
      </div>
    </div>
  );
}

function getResultHeadline(state: GameLobbyState) {
  const lobby = state.lobby!;
  const result = getPlayerResult(lobby, state.role);
  const winningHandle = lobby.winner === "host" ? lobby.host_handle : lobby.guest_handle;
  return (
    result === "won"
      ? "You won!"
      : result === "lost"
        ? "You lost"
        : result === "draw"
          ? "It's a draw"
          : lobby.winner === "draw"
            ? "It's a draw"
            : `@${winningHandle ?? "player"} wins!`
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
  const buttonEnabled = state.canJoin || state.status === "error";

  const handleButtonClick = () => {
    if (state.status === "error") state.retry();
    else void state.join();
  };

  return (
    <main className="page" data-theme={theme}>
      <section className="game-card" aria-label="Rock Paper Scissors game">
        <header className="game-card__header">
          <div className="brand">
            <span className="brand__mark" aria-hidden>
              ✦
            </span>
            <div>
              <div className="brand__name">Grok Play</div>
              <div className="brand__meta">Game #{gameId}</div>
            </div>
          </div>
          <span className="wager-badge">Concept · {formatUsd(WAGER_STAKE_USD)} wager</span>
        </header>

        <div className="title-row">
          <div>
            <p className="eyebrow">HEAD-TO-HEAD</p>
            <h1>{GAME_TITLE}</h1>
          </div>
          <div className={`lobby-status lobby-status--${state.status}`} aria-live="polite">
            <span className="lobby-status__dot" />
            {getStatusCopy(state, displayedHost)}
          </div>
        </div>

        {roundStarted && state.lobby ? (
          <RpsArena3D
            canChoose={state.canSubmitMove}
            guestHandle={state.lobby.guest_handle ?? "challenger"}
            guestLocked={state.lobby.guest_has_played}
            guestMove={state.lobby.guest_move}
            hostHandle={state.lobby.host_handle}
            hostLocked={state.lobby.host_has_played}
            hostMove={state.lobby.host_move}
            canReplay={state.canReplay}
            isReplaying={state.isReplaying}
            isSubmitting={state.isSubmittingMove}
            onChoose={(move) => void state.submitMove(move)}
            onReplay={() => void state.replay()}
            phase={arenaPhase}
            resultHeadline={state.lobby.status === "complete" ? getResultHeadline(state) : null}
            selectedMove={state.myMove}
            winner={state.lobby.winner}
          />
        ) : (
          <>
            <LobbyPlayers host={displayedHost} guest={displayedGuest} />
            <footer className="game-card__footer">
              <div className="rules">
                <span>One-round demo</span>
                <span>Winner takes {formatUsd(WAGER_POT_USD)}</span>
              </div>
              <button
                type="button"
                disabled={!buttonEnabled || state.isJoining}
                aria-disabled={!buttonEnabled || state.isJoining}
                onClick={handleButtonClick}
              >
                {getButtonCopy(state)}
              </button>
            </footer>
          </>
        )}

        <p className={`prototype-note${state.error ? " prototype-note--error" : ""}`}>
          {state.error ??
            (state.isRealtimeConnected
              ? "Live through Supabase Realtime · Concept only, no money is moved"
              : "Connecting to Supabase Realtime · Concept only, no money is moved")}
        </p>
      </section>
    </main>
  );
}
