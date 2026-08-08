import { useEffect, useRef, useState } from "react";
import { RpsArena3D } from "./RpsArena3D";
import { useGameLobby } from "./useGameLobby";
import { useSpectate, type SpectateState } from "./useSpectate";
import { WAGER_POT_USD, WAGER_STAKE_USD, formatUsd } from "./concept";
import { GAME_CATALOG, type GameType } from "../../src/games/catalog";
import { handlesMatch, type GameLobby, type GameStatus } from "../../src/lobby";
import {
  MESSAGE_BODY_LIMIT,
  avatarHue,
  avatarInitial,
  formatRelativeTime,
  type SpectatorMessage,
} from "../../src/spectate";

interface SpectateCardProps {
  /** Author of the `[grokwatch:…]` post, which need not be a player. */
  authorHandle: string;
  authorAvatar: string | null;
  gameId: string;
  gameType: GameType;
  preview: GameStatus | null;
  theme: "light" | "dark";
  viewerHandle: string | null;
}

const WATCHER_FACE_LIMIT = 4;

function HandleAvatar({
  handle,
  photo,
  waiting = false,
  size = "md",
}: {
  handle: string | null;
  photo?: string | null;
  waiting?: boolean;
  size?: "sm" | "md";
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const usablePhoto = photo && !photoFailed ? photo : null;

  if (waiting || !handle) {
    return (
      <span className={`face face--${size} face--waiting`} aria-hidden>
        ?
      </span>
    );
  }

  if (usablePhoto) {
    return (
      <img
        className={`face face--${size}`}
        src={usablePhoto}
        alt=""
        aria-hidden
        onError={() => setPhotoFailed(true)}
      />
    );
  }

  return (
    <span
      className={`face face--${size}`}
      style={{ background: `hsl(${avatarHue(handle)} 72% 46%)` }}
      aria-hidden
    >
      {avatarInitial(handle)}
    </span>
  );
}

/** Decorative accent mirroring the reference card, not a verification claim. */
function CheckMark() {
  return (
    <span className="spectate-check" aria-hidden>
      ✔
    </span>
  );
}

interface LivePill {
  label: string;
  tone: "live" | "final" | "open" | "idle";
}

function getLivePill(lobby: GameLobby | null, authorHandle: string): LivePill {
  if (!lobby) return { label: `Waiting for @${authorHandle}`, tone: "idle" };
  if (lobby.status === "ready" || lobby.status === "playing") {
    return { label: "LIVE", tone: "live" };
  }
  if (lobby.status === "complete") return { label: "FINAL", tone: "final" };
  return { label: "OPEN", tone: "open" };
}

function getSpectatorHeadline(lobby: GameLobby): string {
  if (lobby.winner === "draw") return "It's a draw";
  const winner = lobby.winner === "host" ? lobby.host_handle : lobby.guest_handle;
  return `@${winner ?? "player"} wins!`;
}

function WatcherStrip({ state }: { state: SpectateState }) {
  const faces = state.spectators.slice(0, WATCHER_FACE_LIMIT);
  const overflow = state.spectatorCount - faces.length;

  return (
    <div className="spectate-strip">
      <div className="spectate-watchers">
        {faces.map((spectator) => (
          <HandleAvatar key={spectator.userId} handle={spectator.handle} size="sm" />
        ))}
        {overflow > 0 ? (
          <span className="face face--sm face--overflow" aria-hidden>
            +{overflow}
          </span>
        ) : null}
        {state.spectatorCount === 0 ? (
          <span className="face face--sm face--waiting" aria-hidden>
            ?
          </span>
        ) : null}
      </div>
      <span className="spectate-watchers__label">
        {state.spectatorCount === 1 ? "1 watching now" : `${state.spectatorCount} watching now`}
      </span>
    </div>
  );
}

function ChatRow({ message, now }: { message: SpectatorMessage; now: number }) {
  return (
    <li className="chat-row">
      <HandleAvatar handle={message.handle} size="sm" />
      <div className="chat-row__body">
        <p className="chat-row__meta">
          <strong>@{message.handle}</strong>
          <span>{formatRelativeTime(message.created_at, now)}</span>
        </p>
        <p className="chat-row__text">{message.body}</p>
      </div>
    </li>
  );
}

function SpectateChat({ state }: { state: SpectateState }) {
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [state.messages.length]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    void state.sendMessage(body);
  };

  return (
    <div className="spectate-chat">
      <p className="spectate-chat__title">
        Replies
        <span>{state.isRealtimeConnected ? "live" : "connecting…"}</span>
      </p>

      {state.messages.length === 0 ? (
        <p className="spectate-chat__empty">No replies yet. Say something.</p>
      ) : (
        <ul className="spectate-chat__list" ref={listRef}>
          {state.messages.map((message) => (
            <ChatRow key={message.id} message={message} now={now} />
          ))}
        </ul>
      )}

      <form className="chat-composer" onSubmit={submit}>
        <input
          type="text"
          value={draft}
          maxLength={MESSAGE_BODY_LIMIT}
          placeholder={state.handle ? `Reply as @${state.handle}` : "Reply"}
          aria-label="Send a reply to the spectate room"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={state.isSending || !draft.trim()}>
          {state.isSending ? "…" : "Reply"}
        </button>
      </form>
    </div>
  );
}

function previewSpectateState(viewerHandle: string | null): SpectateState {
  const base = Date.parse("2026-08-08T20:00:00.000Z");
  return {
    error: null,
    handle: viewerHandle ?? "you",
    isRealtimeConnected: true,
    isSending: false,
    isSpectating: false,
    messages: [
      {
        id: 1,
        game_slug: "preview",
        user_id: "preview-1",
        handle: "allegra",
        body: "no way he goes rock again",
        created_at: new Date(base - 90000).toISOString(),
      },
      {
        id: 2,
        game_slug: "preview",
        user_id: "preview-2",
        handle: "marco",
        body: "he absolutely goes rock again 🪨",
        created_at: new Date(base - 20000).toISOString(),
      },
    ],
    retry: () => undefined,
    sendMessage: async () => undefined,
    spectatorCount: 13,
    spectators: [
      { userId: "preview-1", handle: "allegra" },
      { userId: "preview-2", handle: "marco" },
      { userId: "preview-3", handle: "june" },
      { userId: "preview-4", handle: "tomas" },
    ],
    startSpectating: () => undefined,
    status: "ready",
    stopSpectating: () => undefined,
    userId: "preview-viewer",
  };
}

function previewLobby(gameId: string, preview: GameStatus): GameLobby {
  const hasGuest = preview !== "open";
  return {
    slug: gameId,
    host_user_id: "preview-host",
    host_handle: "nico",
    guest_user_id: hasGuest ? "preview-guest" : null,
    guest_handle: hasGuest ? "allegra" : null,
    host_has_played: preview === "complete",
    guest_has_played: preview === "playing" || preview === "complete",
    host_move: preview === "complete" ? "rock" : null,
    guest_move: preview === "complete" ? "scissors" : null,
    winner: preview === "complete" ? "host" : null,
    status: preview,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function SpectateCard({
  authorAvatar,
  authorHandle,
  gameId,
  gameType,
  preview,
  theme,
  viewerHandle,
}: SpectateCardProps) {
  const spec = GAME_CATALOG[gameType];
  const lobbyState = useGameLobby({
    createIfMissing: false,
    enabled: preview === null,
    gameId,
    hostHandle: authorHandle,
    viewerHandle,
  });
  const liveSpectate = useSpectate({
    enabled: preview === null,
    gameId,
    viewerHandle,
  });
  const [previewSpectating, setPreviewSpectating] = useState(false);

  const previewState = preview ? previewSpectateState(viewerHandle) : null;
  const spectate: SpectateState = previewState
    ? {
        ...previewState,
        isSpectating: previewSpectating,
        startSpectating: () => setPreviewSpectating(true),
        stopSpectating: () => setPreviewSpectating(false),
      }
    : liveSpectate;

  const lobby = preview ? previewLobby(gameId, preview) : lobbyState.lobby;
  const hostHandle = lobby?.host_handle ?? null;
  const guestHandle = lobby?.guest_handle ?? null;
  const pill = getLivePill(lobby, authorHandle);
  const error = lobbyState.error ?? spectate.error;

  // The post author is often a third party, so only lend their photo to a
  // player when the handles actually match.
  const hostPhoto = handlesMatch(authorHandle, hostHandle) ? authorAvatar : null;
  const guestPhoto = handlesMatch(authorHandle, guestHandle) ? authorAvatar : null;

  const players = (
    <span className="spectate-versus">
      <strong>@{hostHandle ?? authorHandle}</strong>
      <CheckMark />
      <em>vs</em>
      {guestHandle ? (
        <>
          <strong>@{guestHandle}</strong>
          <CheckMark />
        </>
      ) : (
        <strong className="spectate-versus--waiting">Waiting…</strong>
      )}
    </span>
  );

  const faces = (
    <span className="spectate-avatars">
      <HandleAvatar handle={hostHandle ?? authorHandle} photo={hostPhoto} />
      <HandleAvatar handle={guestHandle} photo={guestPhoto} waiting={!guestHandle} />
    </span>
  );

  const livePill = <span className={`live-pill live-pill--${pill.tone}`}>{pill.label}</span>;

  if (!spectate.isSpectating) {
    return (
      <main className="page" data-theme={theme}>
        <section className="spectate-card" aria-label={`Spectate ${spec.title}`}>
          <div className="spectate-top">
            <p className="spectate-hero">{formatUsd(WAGER_POT_USD)}</p>
            {faces}
          </div>

          {players}
          <p className="spectate-quote">
            “{spec.title} {spec.emoji}”
          </p>

          <div className="spectate-meta">
            <WatcherStrip state={spectate} />
            {livePill}
          </div>

          <button
            type="button"
            className="spectate-button"
            disabled={spectate.status === "loading" || spectate.status === "unconfigured"}
            onClick={spectate.startSpectating}
          >
            Spectate
          </button>

          <p className={`prototype-note${error ? " prototype-note--error" : ""}`}>
            {error ??
              `${formatUsd(WAGER_STAKE_USD)} each · Concept only, no money is moved`}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="page" data-theme={theme}>
      <section className="spectate-card spectate-card--session" aria-label="Spectating">
        <header className="spectate-bar">
          <button type="button" className="spectate-back" onClick={spectate.stopSpectating}>
            ‹ Back
          </button>
          <span className="spectate-bar__stake">{formatUsd(WAGER_POT_USD)}</span>
          {players}
          {livePill}
        </header>

        <div className="spectate-session">
          {lobby ? (
            <RpsArena3D
              canChoose={false}
              canReplay={false}
              guestHandle={lobby.guest_handle ?? "challenger"}
              guestLocked={lobby.guest_has_played}
              guestMove={lobby.guest_move}
              hostHandle={lobby.host_handle}
              hostLocked={lobby.host_has_played}
              hostMove={lobby.host_move}
              isReplaying={false}
              isSubmitting={false}
              onChoose={() => undefined}
              onReplay={() => undefined}
              phase={lobby.status === "complete" ? "complete" : "spectating"}
              resultHeadline={
                lobby.status === "complete" ? getSpectatorHeadline(lobby) : null
              }
              selectedMove={null}
              winner={lobby.winner}
            />
          ) : (
            <div className="spectate-empty-arena">
              <strong>No match yet</strong>
              <span>Waiting for @{authorHandle} to open the lobby</span>
            </div>
          )}

          <SpectateChat state={spectate} />
        </div>

        {error ? <p className="prototype-note prototype-note--error">{error}</p> : null}
      </section>
    </main>
  );
}
