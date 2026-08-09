import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import type { GameEvent } from "../../supabase/functions/_shared/mahjong/sim/events";
import type { ReplayState } from "../../supabase/functions/_shared/mahjong/sim/replay";
import type { TileInstance } from "../../supabase/functions/_shared/mahjong/sim/tiles";
import { ThreeGameView } from "../../src/mahjong/vendor/three/ThreeGameView";
import { tileAlt, tileImage } from "../../src/mahjong/vendor/tileImages";
import type {
  LegalAction,
  MahjongPlayerView,
  MahjongSeat,
  PlayerId,
  RoundState,
} from "../../src/mahjong/types";
import { useMahjongGame } from "./useMahjongGame";
import { formatCents } from "../../src/games/catalog";
import { ArenaBackdrop } from "./ArenaBackdrop";
import grokAvatar from "../../assets/grok.jpeg";
import arenaSpace3Video from "../../assets/arena-space-3.mp4";

type Props = {
  gameId: string;
  hostHandle: string;
  theme: "light" | "dark";
  viewerHandle: string | null;
  wagerCents: number;
};

const seatWinds = ["East", "South", "West", "North"] as const;

export function MahjongCard({ gameId, hostHandle, theme, viewerHandle, wagerCents }: Props) {
  const state = useMahjongGame({ gameId, hostHandle, viewerHandle });
  const shouldExpand = Boolean(
    state.view &&
      (state.view.round || (state.view.seat !== null && state.view.seats.length > 1)),
  );

  useEffect(() => {
    window.parent.postMessage(
      {
        type: "grokplay:resize",
        kind: "mahjong",
        gameId,
        height: shouldExpand ? 620 : 360,
      },
      "https://x.com",
    );
  }, [gameId, shouldExpand]);

  return (
    <main className="page mahjong-page" data-theme={theme}>
      <section className="game-card mahjong-card" aria-label="Taiwanese Mahjong game">
        <MahjongHeader wagerCents={wagerCents} />

        {state.status === "loading" ? <CenteredState title="Shuffling the table…" /> : null}
        {state.status === "waiting_for_host" ? (
          <CenteredState
            title={`Waiting for @${hostHandle}`}
            detail="The post author creates this table by viewing their post with Grok Play installed."
          />
        ) : null}
        {state.status === "unconfigured" ? (
          <CenteredState title="Supabase setup required" detail="Add the project URL and publishable key, then rebuild the extension." />
        ) : null}
        {state.status === "error" ? (
          <CenteredState title="Couldn’t open the table" detail={state.error ?? undefined}>
            <button type="button" onClick={state.retry}>Try again</button>
          </CenteredState>
        ) : null}

        {state.status === "connected" && state.view ? (
          state.view.round && shouldExpand ? (
            <MahjongTable
              view={state.view}
              busy={state.busy}
              error={state.error}
              onAct={(action) => void state.act(action)}
              onJoin={() => void state.join()}
              onLeave={() => void state.leave()}
              onFillBots={() => void state.fillBots()}
              onStart={() => void state.start()}
            />
          ) : (
            <MahjongLobby
              view={state.view}
              busy={state.busy}
              error={state.error}
              onJoin={() => void state.join()}
              onLeave={() => void state.leave()}
              onFillBots={() => void state.fillBots()}
              onStart={() => void state.start()}
            />
          )
        ) : null}
      </section>
    </main>
  );
}

function MahjongHeader({ wagerCents }: { wagerCents: number }) {
  return (
    <header className="game-card__top mahjong-header">
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
          <h1>Grokjong</h1>
        </div>
      </div>
      <div className="mahjong-header__aside">
        <div className="wager-box" aria-label={`${formatCents(wagerCents)} wager`}>
          <strong>{formatCents(wagerCents).replace(".00", "")}</strong>
          <span>Wager</span>
        </div>
      </div>
    </header>
  );
}

function MahjongLobby({
  view,
  busy,
  error,
  onJoin,
  onLeave,
  onFillBots,
  onStart,
}: LobbyActions & { view: MahjongPlayerView }) {
  return (
    <div className="mahjong-lobby">
      <div className="mahjong-title-row">
        <div>
          <p className="eyebrow">Taiwanese · 16 Tile</p>
          <h1>{view.game.status === "complete" ? "Next hand is filling" : "Four-player Mahjong"}</h1>
        </div>
        <span className={`lobby-status lobby-status--${view.game.status}`}>
          <span className="lobby-status__dot" />
          {lobbyStatus(view)}
        </span>
      </div>
      <SeatGrid seats={displaySeats(view)} activeSeat={null} viewerSeat={view.seat} />
      <div className="mahjong-lobby__footer">
        <p>{view.game.status === "complete" ? "The previous result stays visible until the next hand starts." : view.canFillBots ? "Fill the open seats with bots for a quick solo game." : "Any seated player can deal once all four seats are filled."}</p>
        <LobbyButtons view={view} busy={busy} onJoin={onJoin} onLeave={onLeave} onFillBots={onFillBots} onStart={onStart} />
      </div>
      {error ? <p className="mahjong-error">{error}</p> : null}
    </div>
  );
}

function MahjongTable({
  view,
  busy,
  error,
  onAct,
  onJoin,
  onLeave,
  onFillBots,
  onStart,
}: LobbyActions & { view: MahjongPlayerView; onAct: (action: LegalAction) => void }) {
  const replay = useMemo(() => roundToReplay(view.round!, view.game.last_event_sequence), [view]);
  const previousReplayRef = useRef<ReplayState | undefined>(undefined);
  const previousReplay = previousReplayRef.current;
  useEffect(() => {
    previousReplayRef.current = replay;
  }, [replay]);
  const currentEvent = useMemo(() => latestRenderableEvent(view.recentEvents), [view.recentEvents]);
  const reducedMotion = useReducedMotion();
  const webGlAvailable = useMemo(supportsWebGl, []);

  return (
    <div className="mahjong-table-shell">
      <div className="mahjong-stage">
        <ArenaBackdrop src={arenaSpace3Video} className="mahjong-stage__backdrop" />
        {webGlAvailable ? (
          <ThreeErrorBoundary fallback={<DomTable round={view.round!} />}>
            <ThreeGameView
              replay={replay}
              previousReplay={previousReplay}
              currentEvent={currentEvent}
              nextEvent={undefined}
              eventIndex={view.game.last_event_sequence}
              roundKey={`${view.game.slug}:${view.game.round_number}`}
              loading={false}
              cameraAutoRotate={false}
              pointerControlsEnabled
              audioEnabled={false}
              renderPaused={reducedMotion}
              allowInitialRenderWhilePaused
              transparentBackground
              shadowsEnabled={false}
              renderDpr={[1, 1.25]}
              viewSeat={view.seat ?? 0}
            />
          </ThreeErrorBoundary>
        ) : (
          <DomTable round={view.round!} />
        )}
        <SeatLabels
          seats={displaySeats(view)}
          activeSeat={view.game.status === "complete" ? null : view.game.current_player}
          viewerSeat={view.seat}
        />
        <TurnPill view={view} />
      </div>

      <ActionBar view={view} busy={busy} onAct={onAct} />
      <div className="mahjong-table-footer">
        <LobbyButtons view={view} busy={busy} onJoin={onJoin} onLeave={onLeave} onFillBots={onFillBots} onStart={onStart} />
      </div>
      {error ? <p className="mahjong-error">{error}</p> : null}
    </div>
  );
}

function ActionBar({
  view,
  busy,
  onAct,
}: {
  view: MahjongPlayerView;
  busy: string | null;
  onAct: (action: LegalAction) => void;
}) {
  const discards = view.legalActions.filter(
    (action): action is Extract<LegalAction, { type: "discard" }> => action.type === "discard",
  );
  const specialActions = view.legalActions.filter((action) => action.type !== "discard");
  const ownHand = view.seat === null ? [] : view.round?.players[view.seat].hand ?? [];
  const legalDiscardIds = new Set(discards.map((action) => action.tileId));

  if (view.game.status === "complete") {
    const winners = view.game.winners ?? [];
    return (
      <div className="mahjong-result-bar">
        <div><small>HAND COMPLETE</small><strong>{winners.length ? `${winners.map((seat) => seatWinds[seat]).join(" & ")} wins` : "Exhaustive draw"}</strong></div>
        <span>All hands revealed · guest seats reopened</span>
      </div>
    );
  }

  if (view.seat === null) {
    return <div className="mahjong-wait-bar">Join an open seat to play this hand.</div>;
  }

  if (view.legalActions.length === 0) {
    return (
      <div className="mahjong-wait-bar">
        {view.game.status === "claiming"
          ? "Waiting for the other players to claim or pass…"
          : `Waiting for ${activeHandle(view)} to act…`}
      </div>
    );
  }

  return (
    <div className="mahjong-controls">
      {discards.length > 0 ? (
        <div className="mahjong-hand" aria-label="Your hand">
          {ownHand.map((tile) => (
            <button
              key={tile.id}
              type="button"
              disabled={busy !== null || !legalDiscardIds.has(tile.id)}
              title={`Discard ${tileAlt(tile)}`}
              onClick={() => onAct({ type: "discard", tileId: tile.id })}
            >
              <img src={tileImage(tile)} alt={tileAlt(tile)} />
            </button>
          ))}
        </div>
      ) : null}
      {specialActions.length > 0 ? (
        <div className="mahjong-special-actions">
          {specialActions.map((action) => (
            <button
              key={actionKey(action)}
              type="button"
              disabled={busy !== null}
              className={action.type === "claim" && action.claim === "win" ? "is-win" : ""}
              onClick={() => onAct(action)}
            >
              {actionLabel(action)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SeatGrid({ seats, activeSeat, viewerSeat }: {
  seats: MahjongSeat[];
  activeSeat: PlayerId | null;
  viewerSeat: PlayerId | null;
}) {
  return (
    <div className="mahjong-seat-grid">
      {([0, 1, 2, 3] as PlayerId[]).map((seat) => {
        const player = seats.find((candidate) => candidate.seat === seat);
        return (
          <div key={seat} className={`mahjong-seat${activeSeat === seat ? " is-active" : ""}${viewerSeat === seat ? " is-you" : ""}`}>
            <span className="mahjong-seat__wind">{seatWinds[seat][0]}</span>
            <div><strong>{player ? `@${player.handle}` : "Open seat"}</strong><small>{seatWinds[seat]}{viewerSeat === seat ? " · You" : player?.is_bot ? " · Bot" : ""}</small></div>
          </div>
        );
      })}
    </div>
  );
}

function SeatLabels({ seats, activeSeat, viewerSeat }: {
  seats: MahjongSeat[];
  activeSeat: PlayerId | null;
  viewerSeat: PlayerId | null;
}) {
  const origin = viewerSeat ?? 0;
  return (
    <div className="mahjong-seat-labels" aria-hidden>
      {seats.map((seat) => {
        const relative = (seat.seat - origin + 4) % 4;
        const position = ["bottom", "left", "top", "right"][relative];
        return (
          <span key={seat.seat} className={`is-${position}${activeSeat === seat.seat ? " is-active" : ""}`}>
            {seatWinds[seat.seat][0]} · @{seat.handle}
          </span>
        );
      })}
    </div>
  );
}

function LobbyButtons({
  view,
  busy,
  onJoin,
  onLeave,
  onFillBots,
  onStart,
}: Omit<LobbyActions, "error"> & { view: MahjongPlayerView }) {
  return (
    <div className="mahjong-lobby-buttons">
      {view.canJoin ? (
        <button className="primary-btn" type="button" disabled={busy !== null} onClick={onJoin}>
          {busy === "join" ? "Joining…" : "Join table"}
        </button>
      ) : null}
      {view.canFillBots ? <button className="is-bot" type="button" disabled={busy !== null} onClick={onFillBots}>{busy === "fillBots" ? "Filling…" : "Fill with bots"}</button> : null}
      {view.canStart ? (
        <button className="primary-btn" type="button" disabled={busy !== null} onClick={onStart}>
          {busy === "start" ? "Dealing…" : view.game.round_number ? "Start next hand" : "Deal tiles"}
        </button>
      ) : null}
      {view.seat !== null && !view.canStart ? <button className="is-quiet" type="button" disabled={busy !== null} onClick={onLeave}>{busy === "leave" ? "Leaving…" : "Leave"}</button> : null}
    </div>
  );
}

function TurnPill({ view }: { view: MahjongPlayerView }) {
  const seconds = useCountdown(view.game.deadline_at);
  if (view.game.status === "complete") return <div className="mahjong-turn-pill is-complete">Hands revealed</div>;
  return (
    <div className={`mahjong-turn-pill${view.game.status === "claiming" ? " is-claim" : ""}`}>
      {view.game.status === "claiming" ? "Claim window" : `${activeHandle(view)}’s turn`}
      {seconds !== null ? <strong>{seconds}s</strong> : null}
    </div>
  );
}

function DomTable({ round }: { round: RoundState }) {
  return (
    <div className="mahjong-dom-table">
      <div className="mahjong-dom-table__center">麻<small>{round.wall.length} tiles</small></div>
      {round.players.map((player) => (
        <div key={player.id} className={`mahjong-dom-hand seat-${player.id}`}>
          {player.hand.slice(0, 17).map((tile) =>
            tile.id.startsWith("hidden:") ? <span key={tile.id} /> : <img key={tile.id} src={tileImage(tile)} alt="" />,
          )}
        </div>
      ))}
    </div>
  );
}

function CenteredState({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return <div className="mahjong-centered"><div className="mahjong-loader" aria-hidden>麻</div><h1>{title}</h1>{detail ? <p>{detail}</p> : null}{children}</div>;
}

type LobbyActions = {
  busy: string | null;
  error: string | null;
  onJoin: () => void;
  onLeave: () => void;
  onFillBots: () => void;
  onStart: () => void;
};

function roundToReplay(round: RoundState, eventIndex: number): ReplayState {
  return {
    players: round.players,
    wall: round.wall,
    deadWall: round.deadWall,
    wallCount: round.wall.length,
    deadWallCount: round.deadWall.length,
    dealer: round.dealer,
    eventIndex,
    ended: round.ended,
    winner: round.winner,
    winners: round.winners,
    rulesErrors: [],
  };
}

function latestRenderableEvent(events: MahjongPlayerView["recentEvents"]): GameEvent | undefined {
  return [...events].reverse().find((event) => {
    if (event.type === "tileDiscarded" || event.type === "claimMade" || event.type === "addedKongDeclared" || event.type === "winDeclared") {
      return isTile((event as { tile?: unknown }).tile ?? (event as { addedTile?: unknown }).addedTile);
    }
    if (event.type === "flowerExposed" || event.type === "kongDeclared") {
      return Array.isArray((event as { tiles?: unknown }).tiles);
    }
    return event.type === "drawDeclared";
  }) as GameEvent | undefined;
}

function isTile(value: unknown): value is TileInstance {
  return Boolean(value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string");
}

function displaySeats(view: MahjongPlayerView): MahjongSeat[] {
  if (view.game.status !== "complete" || !view.game.result || typeof view.game.result !== "object") return view.seats;
  const resultSeats = (view.game.result as { seats?: unknown }).seats;
  return Array.isArray(resultSeats) ? resultSeats.filter(isSeat) : view.seats;
}

function isSeat(value: unknown): value is MahjongSeat {
  return Boolean(value && typeof value === "object" && typeof (value as MahjongSeat).handle === "string" && [0, 1, 2, 3].includes((value as MahjongSeat).seat));
}

function lobbyStatus(view: MahjongPlayerView): string {
  if (view.game.status === "complete") return `${view.seats.length}/4 next hand`;
  if (view.seats.length === 4) return "Ready to deal";
  return `${4 - view.seats.length} seat${4 - view.seats.length === 1 ? "" : "s"} open`;
}

function activeHandle(view: MahjongPlayerView): string {
  const seat = view.game.current_player;
  const player = seat === null ? null : displaySeats(view).find((candidate) => candidate.seat === seat);
  return player ? `@${player.handle}` : seat === null ? "Player" : (seatWinds[seat] ?? "Player");
}

function actionLabel(action: LegalAction): string {
  if (action.type === "pass") return "Pass";
  if (action.type === "claim") return action.claim === "win" ? "Mahjong!" : action.claim.charAt(0).toUpperCase() + action.claim.slice(1);
  if (action.type === "declareKong") return action.kong === "added" ? "Add Kong" : "Concealed Kong";
  return "Discard";
}

function actionKey(action: LegalAction): string {
  return JSON.stringify(action);
}

function useCountdown(deadline: string | null): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!deadline) {
      setSeconds(null);
      return;
    }
    const update = () => setSeconds(Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return seconds;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function supportsWebGl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

class ThreeErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error, info: ErrorInfo) { console.error("Mahjong WebGL renderer failed", error, info); }
  override render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
