import { createBaselineBot } from "./bots/baselineBot.ts";
import type { LegalAction } from "./sim/actions.ts";
import {
  applyConcealedKong,
  applyMeldClaim,
  applyWinClaims,
} from "./sim/applyActions.ts";
import { botContext, chooseLegalAction } from "./sim/botDecision.ts";
import { claimPriority } from "./sim/claimPriority.ts";
import { eventMeta, type GameEvent } from "./sim/events.ts";
import { legalClaimActions, legalTurnActions } from "./sim/legalActions.ts";
import {
  createPlayers,
  nextPlayer,
  type PlayerId,
  type RoundState,
} from "./sim/state.ts";
import { removeTile } from "./sim/tileCollections.ts";
import {
  isFlower,
  sortTiles,
  type TileInstance,
  type TileKind,
} from "./sim/tiles.ts";
import {
  createShuffledWalls,
  drawLiveTile,
  drawSupplementTile,
} from "./sim/wall.ts";
import { isWinningHand } from "./sim/win.ts";

export const TURN_TIMEOUT_MS = 30_000;
export const CLAIM_TIMEOUT_MS = 10_000;

export type MahjongPhase = "turn" | "claiming" | "complete";
export type ClaimSource = "discard" | "robbingKong";

export type PendingClaim = {
  source: ClaimSource;
  discarder: PlayerId;
  tile: TileInstance;
  eligiblePlayers: PlayerId[];
  responses: Partial<Record<PlayerId, LegalAction>>;
  addedKong?: Extract<LegalAction, { type: "declareKong"; kong: "added" }>;
};

export type MultiplayerMahjongState = {
  seed: string;
  round: RoundState;
  events: GameEvent[];
  phase: MahjongPhase;
  deadlineAt: string | null;
  drawnTileId?: string;
  pendingClaim?: PendingClaim;
};

export type PublicMahjongEvent = Record<string, unknown> & {
  type: GameEvent["type"];
};

export type RedactedRoundState = RoundState;

const hiddenKind: TileKind = {
  category: "suited",
  suit: "bamboo",
  rank: 1,
};

export function createMultiplayerRound(
  seed: string,
  now = Date.now(),
): MultiplayerMahjongState {
  const round: RoundState = {
    players: createPlayers(),
    wall: [],
    deadWall: [],
    currentPlayer: 0,
    needsDiscard: 0,
    discardSource: "draw",
    dealer: 0,
    turn: 0,
    ended: false,
  };
  const { wall, deadWall, wallBreak } = createShuffledWalls(seed, round.dealer);
  round.wall = wall;
  round.deadWall = deadWall;
  const events: GameEvent[] = [];

  for (let packet = 0; packet < 4; packet += 1) {
    for (const player of round.players) {
      drawSetupTiles(round, player.id, 4, events);
    }
  }
  const dealerTile = drawLiveTile(round);
  if (dealerTile) {
    round.players[round.dealer].hand.push(dealerTile);
    events.push({
      ...eventMeta("setup", 0),
      type: "tilesDrawn",
      player: round.dealer,
      tiles: [dealerTile],
      source: "liveWall",
      wallCount: round.wall.length,
      deadWallCount: round.deadWall.length,
    });
  }
  replaceSetupFlowers(round, events);

  for (const player of round.players) {
    player.hand = sortTiles(player.hand);
  }

  events.push({
    ...eventMeta("setup", 0),
    type: "roundStarted",
    seed,
    dealer: round.dealer,
    wallBreak,
    wallCount: round.wall.length,
    deadWallCount: round.deadWall.length,
    handCounts: round.players.map((player) => player.hand.length) as [
      number,
      number,
      number,
      number,
    ],
  });

  const state: MultiplayerMahjongState = {
    seed,
    round,
    events,
    phase: round.ended ? "complete" : "turn",
    deadlineAt: round.ended ? null : deadline(now, TURN_TIMEOUT_MS),
    drawnTileId: dealerTile?.id,
  };

  if (!round.ended && isWinningHand(round.players[round.dealer].hand)) {
    state.drawnTileId = dealerTile?.id ?? round.players[round.dealer].hand.at(-1)?.id;
  }
  return state;
}

export function legalActionsForPlayer(
  state: MultiplayerMahjongState,
  player: PlayerId,
): LegalAction[] {
  if (state.phase === "complete" || state.round.ended) return [];

  if (state.phase === "claiming") {
    const pending = state.pendingClaim;
    if (!pending || !pending.eligiblePlayers.includes(player) || pending.responses[player]) {
      return [];
    }
    if (pending.source === "robbingKong") {
      return [
        { type: "pass" },
        { type: "claim", claim: "win", tileId: pending.tile.id },
      ];
    }
    return legalClaimActions(
      state.round,
      player,
      pending.discarder,
      pending.tile,
    );
  }

  if (state.round.currentPlayer !== player) return [];
  const actions = legalTurnActions(
    state.round.players[player],
    state.round.discardSource !== "claim",
  );
  if (isWinningHand(state.round.players[player].hand, state.round.players[player].melds)) {
    const winningTileId =
      state.drawnTileId ?? state.round.players[player].hand.at(-1)?.id;
    if (winningTileId) {
      actions.unshift({ type: "claim", claim: "win", tileId: winningTileId });
    }
  }
  return actions;
}

export function applyPlayerAction(
  current: MultiplayerMahjongState,
  player: PlayerId,
  action: LegalAction,
  now = Date.now(),
): MultiplayerMahjongState {
  const state = cloneMultiplayerState(current);
  const legalActions = legalActionsForPlayer(state, player);
  const legalAction = legalActions.find((candidate) => actionsEqual(candidate, action));
  if (!legalAction) throw new Error("That Mahjong action is no longer legal.");

  if (state.phase === "claiming") {
    state.pendingClaim!.responses[player] = legalAction;
    if (allClaimsAnswered(state.pendingClaim!)) resolvePendingClaims(state, now);
    return state;
  }

  if (legalAction.type === "claim" && legalAction.claim === "win") {
    applySelfDrawWin(state, player, legalAction.tileId);
    return state;
  }

  if (legalAction.type === "declareKong") {
    if (legalAction.kong === "concealed") {
      applyConcealedKong(state.round, player, legalAction, state.events);
      beginCurrentTurn(state, now, true);
      return state;
    }
    beginAddedKongClaim(state, player, legalAction, now);
    return state;
  }

  if (legalAction.type !== "discard") {
    throw new Error("A pass is only valid during a claim window.");
  }

  discardTile(state, player, legalAction.tileId, now);
  return state;
}

export function advanceExpiredState(
  current: MultiplayerMahjongState,
  now = Date.now(),
): { state: MultiplayerMahjongState; advanced: boolean } {
  if (!current.deadlineAt || now < Date.parse(current.deadlineAt) || current.phase === "complete") {
    return { state: current, advanced: false };
  }

  const state = cloneMultiplayerState(current);
  if (state.phase === "claiming" && state.pendingClaim) {
    for (const player of state.pendingClaim.eligiblePlayers) {
      state.pendingClaim.responses[player] ??= { type: "pass" };
    }
    resolvePendingClaims(state, now);
    return { state, advanced: true };
  }

  const player = state.round.currentPlayer;
  const legalActions = legalActionsForPlayer(state, player);
  if (legalActions.length === 0) {
    finishDraw(state, "exhaustiveDraw");
    return { state, advanced: true };
  }
  const action = chooseLegalAction(
    createBaselineBot(`Seat ${player + 1} timeout`),
    botContext(state.round, player, legalActions),
  );
  return { state: applyPlayerAction(state, player, action, now), advanced: true };
}

export function advanceAutomatedPlayers(
  current: MultiplayerMahjongState,
  botPlayers: readonly PlayerId[],
  now = Date.now(),
  maxActions = 256,
): MultiplayerMahjongState {
  const bots = new Set(botPlayers);
  let state = current;

  for (let step = 0; step < maxActions; step += 1) {
    if (state.phase === "complete" || state.round.ended) return state;

    if (state.phase === "claiming" && state.pendingClaim) {
      let acted = false;
      for (const player of state.pendingClaim.eligiblePlayers) {
        if (state.pendingClaim.responses[player]) continue;
        const legalActions = legalActionsForPlayer(state, player);
        const forcedPass =
          bots.size > 0 &&
          legalActions.length === 1 &&
          legalActions[0]?.type === "pass";
        if (!bots.has(player) && !forcedPass) continue;

        const action = forcedPass
          ? legalActions[0]!
          : chooseLegalAction(
              createBaselineBot(`Seat ${player + 1} demo bot`),
              botContext(state.round, player, legalActions),
            );
        state = applyPlayerAction(state, player, action, now);
        acted = true;
        break;
      }
      if (acted) continue;
      return state;
    }

    const player = state.round.currentPlayer;
    if (!bots.has(player)) return state;
    const legalActions = legalActionsForPlayer(state, player);
    if (legalActions.length === 0) {
      state = cloneMultiplayerState(state);
      finishDraw(state, "exhaustiveDraw");
      return state;
    }
    const action = chooseLegalAction(
      createBaselineBot(`Seat ${player + 1} demo bot`),
      botContext(state.round, player, legalActions),
    );
    state = applyPlayerAction(state, player, action, now);
  }

  throw new Error("Mahjong demo bots exceeded the automatic action limit.");
}

export function redactRoundForPlayer(
  state: MultiplayerMahjongState,
  player: PlayerId | null,
): RedactedRoundState {
  const revealAll = state.phase === "complete";
  return {
    ...state.round,
    players: state.round.players.map((roundPlayer) => ({
      ...roundPlayer,
      hand:
        revealAll || roundPlayer.id === player
          ? cloneTiles(roundPlayer.hand)
          : hiddenTiles(roundPlayer.hand.length, `hidden:hand:${roundPlayer.id}`),
      flowers: cloneTiles(roundPlayer.flowers),
      discards: cloneTiles(roundPlayer.discards),
      melds: roundPlayer.melds.map((meld, meldIndex) => ({
        ...meld,
        tiles:
          revealAll || roundPlayer.id === player || !meld.concealed
            ? cloneTiles(meld.tiles)
            : hiddenTiles(meld.tiles.length, `hidden:meld:${roundPlayer.id}:${meldIndex}`),
      })),
      winningTile:
        roundPlayer.winningTile && (revealAll || roundPlayer.id === player)
          ? cloneTile(roundPlayer.winningTile)
          : undefined,
    })) as RoundState["players"],
    wall: hiddenTiles(state.round.wall.length, "hidden:wall"),
    deadWall: hiddenTiles(state.round.deadWall.length, "hidden:dead-wall"),
  };
}

export function sanitizeEvents(events: readonly GameEvent[]): PublicMahjongEvent[] {
  return events.map((event) => {
    switch (event.type) {
      case "roundStarted":
        return {
          type: event.type,
          phase: event.phase,
          groupId: event.groupId,
          turn: event.turn,
          dealer: event.dealer,
          wallCount: event.wallCount,
          deadWallCount: event.deadWallCount,
          handCounts: event.handCounts,
        };
      case "tileDrawn":
        return {
          type: event.type,
          phase: event.phase,
          groupId: event.groupId,
          turn: event.turn,
          player: event.player,
          replacement: event.replacement,
          source: event.source,
          wallCount: event.wallCount,
          deadWallCount: event.deadWallCount,
        };
      case "tilesDrawn":
        return {
          type: event.type,
          phase: event.phase,
          groupId: event.groupId,
          turn: event.turn,
          player: event.player,
          count: event.tiles.length,
          replacement: event.replacement ?? false,
          source: event.source,
          wallCount: event.wallCount,
          deadWallCount: event.deadWallCount,
        };
      case "kongDeclared":
        if (event.kong === "concealed") {
          return {
            type: event.type,
            phase: event.phase,
            groupId: event.groupId,
            turn: event.turn,
            player: event.player,
            kong: event.kong,
            tileCount: event.tiles.length,
          };
        }
        return structuredClone(event) as unknown as PublicMahjongEvent;
      default:
        return structuredClone(event) as unknown as PublicMahjongEvent;
    }
  });
}

export function actionsEqual(left: LegalAction, right: LegalAction): boolean {
  return actionKey(left) === actionKey(right);
}

function actionKey(action: LegalAction): string {
  if (action.type === "discard") return `discard:${action.tileId}`;
  if (action.type === "pass") return "pass";
  if (action.type === "claim") {
    return `claim:${action.claim}:${action.tileId}:${action.consumedTileIds?.join(",") ?? ""}`;
  }
  return action.kong === "concealed"
    ? `kong:concealed:${action.tileIds.join(",")}`
    : `kong:added:${action.meldIndex}:${action.tileId}`;
}

function discardTile(
  state: MultiplayerMahjongState,
  player: PlayerId,
  tileId: string,
  now: number,
): void {
  const tile = removeTile(state.round.players[player].hand, tileId);
  if (!tile) throw new Error("The selected tile is not in this hand.");

  state.round.players[player].discards.push(tile);
  state.events.push({
    ...eventMeta("turn", state.round.turn),
    type: "tileDiscarded",
    player,
    tile,
    handCount: state.round.players[player].hand.length,
  });
  state.drawnTileId = undefined;

  const eligiblePlayers = claimOrder(player).filter(
    (candidate) => legalClaimActions(state.round, candidate, player, tile).length > 1,
  );
  if (eligiblePlayers.length === 0) {
    state.round.turn += 1;
    state.round.currentPlayer = nextPlayer(player);
    state.round.needsDiscard = undefined;
    state.round.discardSource = undefined;
    beginCurrentTurn(state, now, false);
    return;
  }

  state.phase = "claiming";
  state.pendingClaim = {
    source: "discard",
    discarder: player,
    tile,
    eligiblePlayers,
    responses: {},
  };
  state.deadlineAt = deadline(now, CLAIM_TIMEOUT_MS);
}

function beginAddedKongClaim(
  state: MultiplayerMahjongState,
  player: PlayerId,
  action: Extract<LegalAction, { type: "declareKong"; kong: "added" }>,
  now: number,
): void {
  const meld = state.round.players[player].melds[action.meldIndex];
  const tile = state.round.players[player].hand.find((candidate) => candidate.id === action.tileId);
  if (!meld || meld.type !== "pong" || !tile) {
    throw new Error("The added kong is no longer available.");
  }
  const eligiblePlayers = claimOrder(player).filter((candidate) =>
    isWinningHand(
      [...state.round.players[candidate].hand, tile],
      state.round.players[candidate].melds,
    ),
  );
  state.events.push({
    ...eventMeta("turn", state.round.turn),
    type: "addedKongDeclared",
    player,
    tiles: sortTiles([...meld.tiles, tile]),
    addedTile: tile,
  });

  if (eligiblePlayers.length === 0) {
    finalizeAddedKong(state, player, action, now);
    return;
  }
  state.phase = "claiming";
  state.pendingClaim = {
    source: "robbingKong",
    discarder: player,
    tile,
    eligiblePlayers,
    responses: {},
    addedKong: action,
  };
  state.deadlineAt = deadline(now, CLAIM_TIMEOUT_MS);
}

function resolvePendingClaims(state: MultiplayerMahjongState, now: number): void {
  const pending = state.pendingClaim;
  if (!pending) throw new Error("No claim window is active.");
  const wins = pending.eligiblePlayers.filter((player) => {
    const response = pending.responses[player];
    return response?.type === "claim" && response.claim === "win";
  });

  if (wins.length > 0) {
    if (pending.source === "discard") {
      applyWinClaims(state.round, pending.discarder, pending.tile, wins, state.events);
    } else {
      removeTile(state.round.players[pending.discarder].hand, pending.tile.id);
      state.round.winner = wins[0];
      state.round.winners = wins;
      for (const winner of wins) {
        state.round.players[winner].winningTile = pending.tile;
        state.events.push({
          ...eventMeta("turn", state.round.turn),
          type: "winDeclared",
          player: winner,
          from: pending.discarder,
          tile: pending.tile,
        });
      }
      state.round.ended = true;
    }
    finishWin(state);
    return;
  }

  if (pending.source === "robbingKong") {
    finalizeAddedKong(state, pending.discarder, pending.addedKong!, now);
    return;
  }

  const contenders = claimOrder(pending.discarder);
  const meldClaims = pending.eligiblePlayers
    .flatMap((player) => {
      const response = pending.responses[player];
      return response?.type === "claim" && response.claim !== "win"
        ? [{ player, action: response }]
        : [];
    })
    .sort(
      (left, right) =>
        claimPriority(right.action.claim) - claimPriority(left.action.claim) ||
        contenders.indexOf(left.player) - contenders.indexOf(right.player),
    );
  const resolved = meldClaims[0];
  state.pendingClaim = undefined;
  state.round.turn += 1;

  if (!resolved) {
    state.round.currentPlayer = nextPlayer(pending.discarder);
    state.round.needsDiscard = undefined;
    state.round.discardSource = undefined;
    beginCurrentTurn(state, now, false);
    return;
  }

  applyMeldClaim(state.round, resolved.player, resolved.action, pending.tile, state.events);
  beginCurrentTurn(state, now, resolved.action.claim === "kong");
}

function finalizeAddedKong(
  state: MultiplayerMahjongState,
  player: PlayerId,
  action: Extract<LegalAction, { type: "declareKong"; kong: "added" }>,
  now: number,
): void {
  const roundPlayer = state.round.players[player];
  const meld = roundPlayer.melds[action.meldIndex];
  const tile = removeTile(roundPlayer.hand, action.tileId);
  if (!meld || meld.type !== "pong" || !tile) {
    throw new Error("The added kong could not be completed.");
  }
  const tiles = sortTiles([...meld.tiles, tile]);
  roundPlayer.melds[action.meldIndex] = { ...meld, type: "kong", tiles };
  state.events.push({
    ...eventMeta("turn", state.round.turn),
    type: "kongDeclared",
    player,
    kong: "added",
    tiles,
    addedTile: tile,
  });
  state.pendingClaim = undefined;
  beginCurrentTurn(state, now, true);
}

function beginCurrentTurn(
  state: MultiplayerMahjongState,
  now: number,
  replacement: boolean,
): void {
  const player = state.round.currentPlayer;
  state.phase = "turn";
  state.pendingClaim = undefined;
  state.round.needsReplacementDraw = undefined;

  const mustDiscardWithoutDraw =
    !replacement && state.round.needsDiscard === player && state.round.discardSource === "claim";
  if (!mustDiscardWithoutDraw) {
    const drawn = drawUntilPlayable(state, player, replacement);
    if (!drawn) {
      if (!state.round.ended) finishDraw(state, "exhaustiveDraw");
      return;
    }
    state.drawnTileId = drawn.id;
  }
  state.round.needsDiscard = player;
  state.round.discardSource = mustDiscardWithoutDraw ? "claim" : "draw";
  state.deadlineAt = deadline(now, TURN_TIMEOUT_MS);
}

function drawUntilPlayable(
  state: MultiplayerMahjongState,
  player: PlayerId,
  replacement: boolean,
): TileInstance | undefined {
  let fromDeadWall = replacement;
  while (fromDeadWall ? state.round.deadWall.length > 0 : state.round.wall.length > 0) {
    const tile = fromDeadWall ? drawSupplementTile(state.round) : drawLiveTile(state.round);
    if (!tile) return undefined;
    state.events.push({
      ...eventMeta("turn", state.round.turn),
      type: "tileDrawn",
      player,
      tile,
      replacement: fromDeadWall,
      source: fromDeadWall ? "deadWall" : "liveWall",
      wallCount: state.round.wall.length,
      deadWallCount: state.round.deadWall.length,
    });
    if (isFlower(tile)) {
      state.round.players[player].flowers.push(tile);
      state.events.push({
        ...eventMeta("turn", state.round.turn),
        type: "flowerExposed",
        player,
        tile,
        tiles: [tile],
      });
      applyFlowerWinIfAny(state.round, player, [tile], state.events, "turn");
      if (state.round.ended) {
        finishWin(state);
        return undefined;
      }
      fromDeadWall = true;
      continue;
    }
    state.round.players[player].hand = sortTiles([
      ...state.round.players[player].hand,
      tile,
    ]);
    return tile;
  }
  return undefined;
}

function applySelfDrawWin(
  state: MultiplayerMahjongState,
  player: PlayerId,
  tileId: string,
): void {
  const tile = removeTile(state.round.players[player].hand, tileId);
  if (!tile) throw new Error("The winning tile is no longer in this hand.");
  state.round.players[player].winningTile = tile;
  state.round.winner = player;
  state.round.winners = [player];
  state.round.ended = true;
  state.events.push({
    ...eventMeta("turn", state.round.turn),
    type: "winDeclared",
    player,
    tile,
  });
  finishWin(state);
}

function finishWin(state: MultiplayerMahjongState): void {
  state.phase = "complete";
  state.deadlineAt = null;
  state.pendingClaim = undefined;
  state.drawnTileId = undefined;
}

function finishDraw(
  state: MultiplayerMahjongState,
  reason: "exhaustiveDraw" | "turnLimit",
): void {
  state.round.ended = true;
  state.events.push({
    ...eventMeta("turn", state.round.turn),
    type: "drawDeclared",
    reason,
    wallCount: state.round.wall.length,
    deadWallCount: state.round.deadWall.length,
    turn: state.round.turn,
  });
  state.phase = "complete";
  state.deadlineAt = null;
  state.pendingClaim = undefined;
  state.drawnTileId = undefined;
}

function drawSetupTiles(
  round: RoundState,
  player: PlayerId,
  count: number,
  events: GameEvent[],
): void {
  const tiles: TileInstance[] = [];
  for (let index = 0; index < count; index += 1) {
    const tile = drawLiveTile(round);
    if (!tile) break;
    round.players[player].hand.push(tile);
    tiles.push(tile);
  }
  if (tiles.length > 0) {
    events.push({
      ...eventMeta("setup", 0),
      type: "tilesDrawn",
      player,
      tiles,
      source: "liveWall",
      wallCount: round.wall.length,
      deadWallCount: round.deadWall.length,
    });
  }
}

function replaceSetupFlowers(round: RoundState, events: GameEvent[]): void {
  let replaced = true;
  while (replaced && !round.ended) {
    replaced = false;
    for (const player of round.players) {
      const flowers = player.hand.filter(isFlower);
      if (flowers.length === 0) continue;
      replaced = true;
      for (const flower of flowers) {
        removeTile(player.hand, flower.id);
        player.flowers.push(flower);
      }
      events.push({
        ...eventMeta("setup", 0),
        type: "flowerExposed",
        player: player.id,
        tile: flowers[0],
        tiles: flowers,
      });
      applyFlowerWinIfAny(round, player.id, flowers, events, "setup");
      if (round.ended) return;
      const replacements: TileInstance[] = [];
      for (let index = 0; index < flowers.length; index += 1) {
        const replacement = drawSupplementTile(round);
        if (replacement) {
          player.hand.push(replacement);
          replacements.push(replacement);
        }
      }
      if (replacements.length > 0) {
        events.push({
          ...eventMeta("setup", 0),
          type: "tilesDrawn",
          player: player.id,
          tiles: replacements,
          replacement: true,
          source: "deadWall",
          wallCount: round.wall.length,
          deadWallCount: round.deadWall.length,
        });
      }
    }
  }
}

function applyFlowerWinIfAny(
  round: RoundState,
  exposingPlayer: PlayerId,
  exposedFlowers: readonly TileInstance[],
  events: GameEvent[],
  phase: "setup" | "turn",
): void {
  const robber = round.players.find(
    (player) => player.id !== exposingPlayer && player.flowers.length === 7,
  );
  const winner = robber?.id ?? (round.players[exposingPlayer].flowers.length >= 8 ? exposingPlayer : undefined);
  if (winner === undefined) return;
  const tile = exposedFlowers[0];
  if (!tile) return;
  removeTile(round.players[exposingPlayer].flowers, tile.id);
  round.winner = winner;
  round.winners = [winner];
  round.players[winner].winningTile = tile;
  round.ended = true;
  events.push({
    ...eventMeta(phase, round.turn),
    type: "winDeclared",
    player: winner,
    from: exposingPlayer,
    tile,
  });
}

function allClaimsAnswered(pending: PendingClaim): boolean {
  return pending.eligiblePlayers.every((player) => pending.responses[player]);
}

function claimOrder(discarder: PlayerId): PlayerId[] {
  return [
    nextPlayer(discarder),
    nextPlayer(nextPlayer(discarder)),
    nextPlayer(nextPlayer(nextPlayer(discarder))),
  ];
}

function cloneMultiplayerState(state: MultiplayerMahjongState): MultiplayerMahjongState {
  return structuredClone(state);
}

function cloneTile(tile: TileInstance): TileInstance {
  return { id: tile.id, kind: structuredClone(tile.kind) };
}

function cloneTiles(tiles: readonly TileInstance[]): TileInstance[] {
  return tiles.map(cloneTile);
}

function hiddenTiles(count: number, prefix: string): TileInstance[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}:${index}`,
    kind: hiddenKind,
  }));
}

function deadline(now: number, timeout: number): string {
  return new Date(now + timeout).toISOString();
}
