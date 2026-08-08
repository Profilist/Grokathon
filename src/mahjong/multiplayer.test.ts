import { describe, expect, it } from "vitest";
import {
  advanceAutomatedPlayers,
  advanceExpiredState,
  applyPlayerAction,
  createMultiplayerRound,
  legalActionsForPlayer,
  redactRoundForPlayer,
  sanitizeEvents,
  type MultiplayerMahjongState,
} from "../../supabase/functions/_shared/mahjong/multiplayer";
import { createPlayers } from "../../supabase/functions/_shared/mahjong/sim/state";
import { createTileSet, type TileInstance } from "../../supabase/functions/_shared/mahjong/sim/tiles";

describe("authoritative multiplayer Mahjong", () => {
  it("deals a deterministic Taiwanese 16-tile round and waits for East", () => {
    const first = createMultiplayerRound("table-seed", 1_000);
    const second = createMultiplayerRound("table-seed", 1_000);

    expect(first).toEqual(second);
    expect(first.round.players.map((player) => player.hand.length)).toEqual([17, 16, 16, 16]);
    expect(first.round.currentPlayer).toBe(0);
    expect(first.deadlineAt).toBe(new Date(31_000).toISOString());
    expect(legalActionsForPlayer(first, 0).some((action) => action.type === "discard")).toBe(true);
    expect(legalActionsForPlayer(first, 1)).toEqual([]);
    expect(tileCount(first)).toBe(144);
  });

  it("never exposes opponent hands, the live wall, or private draw events", () => {
    const state = createMultiplayerRound("private-table", 1_000);
    const east = redactRoundForPlayer(state, 0);

    expect(east.players[0].hand[0]?.id.startsWith("hidden:")).toBe(false);
    expect(east.players[1].hand.every((tile) => tile.id.startsWith("hidden:"))).toBe(true);
    expect(east.wall.every((tile) => tile.id.startsWith("hidden:"))).toBe(true);

    const publicEvents = sanitizeEvents(state.events);
    const draws = publicEvents.filter((event) => event.type === "tilesDrawn");
    expect(draws.length).toBeGreaterThan(0);
    expect(draws.every((event) => !("tiles" in event))).toBe(true);
    expect(publicEvents.every((event) => !("seed" in event))).toBe(true);

    const complete = structuredClone(state);
    complete.phase = "complete";
    complete.round.ended = true;
    const reveal = redactRoundForPlayer(complete, null);
    expect(reveal.players[1].hand.some((tile) => tile.id.startsWith("hidden:"))).toBe(false);
  });

  it("rejects an out-of-turn action", () => {
    const state = createMultiplayerRound("turn-guard", 1_000);
    const tileId = state.round.players[1].hand[0]!.id;
    expect(() => applyPlayerAction(state, 1, { type: "discard", tileId }, 2_000)).toThrow(
      "no longer legal",
    );
  });

  it("uses the baseline bot for an expired turn", () => {
    const state = createMultiplayerRound("timeout-turn", 1_000);
    state.deadlineAt = new Date(2_000).toISOString();
    const result = advanceExpiredState(state, 2_001);

    expect(result.advanced).toBe(true);
    expect(result.state.events.length).toBeGreaterThan(state.events.length);
    expect(
      result.state.round.ended || result.state.events.some((event) => event.type === "tileDiscarded"),
    ).toBe(true);
    expect(advanceExpiredState(result.state, 2_001).advanced).toBe(false);
  });

  it("declares a draw when an expired turn has no legal action", () => {
    const state = scenarioState();
    state.round.players[0].hand = [];
    state.round.wall = [];
    state.deadlineAt = new Date(2_000).toISOString();

    const result = advanceExpiredState(state, 2_001);
    expect(result.advanced).toBe(true);
    expect(result.state.phase).toBe("complete");
    expect(result.state.events.at(-1)).toMatchObject({
      type: "drawDeclared",
      reason: "exhaustiveDraw",
    });
  });

  it("runs demo bots immediately until the human has a real decision", () => {
    let state = createMultiplayerRound("solo-demo", 1_000);
    const firstDiscard = legalActionsForPlayer(state, 0).find(
      (action) => action.type === "discard",
    );
    expect(firstDiscard).toBeDefined();

    state = applyPlayerAction(state, 0, firstDiscard!, 2_000);
    const eventCountBeforeBots = state.events.length;
    state = advanceAutomatedPlayers(state, [1, 2, 3], 2_000);

    expect(state.events.length).toBeGreaterThan(eventCountBeforeBots);
    expect(state.events.some((event) => event.type === "rulesError")).toBe(false);
    if (state.phase === "turn") {
      expect(state.round.currentPlayer).toBe(0);
      expect(legalActionsForPlayer(state, 0).length).toBeGreaterThan(0);
    } else if (state.phase === "claiming") {
      expect(
        legalActionsForPlayer(state, 0).some((action) => action.type !== "pass"),
      ).toBe(true);
    } else {
      expect(state.round.ended).toBe(true);
    }
  });

  it("does not play on behalf of a human who has a claim choice", () => {
    let state = scenarioState();
    const discarded = tile("c3", 3);
    state.round.players[3].hand = [discarded];
    state.round.players[0].hand = [tile("c1", 0), tile("c2", 0)];
    state.round.currentPlayer = 3;
    state.round.needsDiscard = 3;

    state = applyPlayerAction(state, 3, { type: "discard", tileId: discarded.id }, 1_000);
    state = advanceAutomatedPlayers(state, [1, 2, 3], 1_000);

    expect(state.phase).toBe("claiming");
    expect(state.pendingClaim?.responses[0]).toBeUndefined();
    expect(legalActionsForPlayer(state, 0).some((action) => action.type === "claim")).toBe(true);
  });

  it("resolves simultaneous discard wins for multiple players", () => {
    let state = scenarioState();
    const discarded = tile("wind-east", 2);
    state.round.players[0].hand = [discarded];
    state.round.players[1].hand = waitingHand(0);
    state.round.players[2].hand = waitingHand(1);

    state = applyPlayerAction(state, 0, { type: "discard", tileId: discarded.id }, 1_000);
    expect(state.phase).toBe("claiming");
    state = applyPlayerAction(state, 1, { type: "claim", claim: "win", tileId: discarded.id }, 2_000);
    expect(state.phase).toBe("claiming");
    state = applyPlayerAction(state, 2, { type: "claim", claim: "win", tileId: discarded.id }, 2_500);

    expect(state.phase).toBe("complete");
    expect(state.round.winners).toEqual([1, 2]);
    expect(state.events.filter((event) => event.type === "winDeclared")).toHaveLength(2);
  });

  it("gives pong priority over chow", () => {
    let state = scenarioState();
    const discarded = tile("c3", 3);
    state.round.players[0].hand = [discarded];
    state.round.players[1].hand = [tile("c1", 0), tile("c2", 0)];
    state.round.players[2].hand = [tile("c3", 0), tile("c3", 1)];

    state = applyPlayerAction(state, 0, { type: "discard", tileId: discarded.id }, 1_000);
    state = applyPlayerAction(state, 1, {
      type: "claim",
      claim: "chow",
      tileId: discarded.id,
      consumedTileIds: [tile("c1", 0).id, tile("c2", 0).id],
    }, 2_000);
    state = applyPlayerAction(state, 2, {
      type: "claim",
      claim: "pong",
      tileId: discarded.id,
    }, 2_100);

    expect(state.phase).toBe("turn");
    expect(state.round.currentPlayer).toBe(2);
    expect(state.round.players[2].melds[0]?.type).toBe("pong");
    expect(state.round.players[1].melds).toEqual([]);
  });

  it("turns unanswered claims into passes after ten seconds", () => {
    let state = scenarioState();
    const discarded = tile("c3", 3);
    state.round.players[0].hand = [discarded];
    state.round.players[1].hand = [tile("c1", 0), tile("c2", 0)];
    state = applyPlayerAction(state, 0, { type: "discard", tileId: discarded.id }, 1_000);
    state.deadlineAt = new Date(11_000).toISOString();

    const result = advanceExpiredState(state, 11_001);
    expect(result.advanced).toBe(true);
    expect(result.state.phase).toBe("turn");
    expect(result.state.round.currentPlayer).toBe(1);
    expect(result.state.round.players[1].melds).toEqual([]);
  });

  it("draws a supplement tile after a concealed kong", () => {
    let state = scenarioState();
    state.round.wall = [tile("d9", 0)];
    state.round.deadWall = [tile("b9", 0)];
    state.round.players[0].hand = [
      tile("dragon-red", 0),
      tile("dragon-red", 1),
      tile("dragon-red", 2),
      tile("dragon-red", 3),
    ];
    const kong = legalActionsForPlayer(state, 0).find(
      (action) => action.type === "declareKong" && action.kong === "concealed",
    );
    expect(kong).toBeDefined();

    state = applyPlayerAction(state, 0, kong!, 1_000);
    expect(state.round.players[0].melds[0]).toMatchObject({ type: "kong", concealed: true });
    expect(state.round.players[0].hand.map((candidate) => candidate.id)).toContain("b9-0");
    expect(state.events.some((event) => event.type === "kongDeclared")).toBe(true);
  });

  it("opens a robbing-kong window and awards the added tile to the winner", () => {
    let state = scenarioState();
    state.round.players[0].melds = [{
      type: "pong",
      tiles: [tile("c5", 0), tile("c5", 1), tile("c5", 2)],
      claimedFrom: 3,
    }];
    state.round.players[0].hand = [tile("c5", 3)];
    state.round.players[1].hand = waitingOnC5();
    const addedKong = legalActionsForPlayer(state, 0).find(
      (action) => action.type === "declareKong" && action.kong === "added",
    );
    expect(addedKong).toBeDefined();

    state = applyPlayerAction(state, 0, addedKong!, 1_000);
    expect(state.phase).toBe("claiming");
    expect(state.pendingClaim?.source).toBe("robbingKong");
    state = applyPlayerAction(state, 1, {
      type: "claim",
      claim: "win",
      tileId: "c5-3",
    }, 2_000);

    expect(state.phase).toBe("complete");
    expect(state.round.winners).toEqual([1]);
    expect(state.round.players[1].winningTile?.id).toBe("c5-3");
    expect(state.round.players[0].melds[0]?.type).toBe("pong");
  });
});

function scenarioState(): MultiplayerMahjongState {
  return {
    seed: "scenario",
    round: {
      players: createPlayers(),
      wall: [tile("b9", 2)],
      deadWall: [],
      currentPlayer: 0,
      needsDiscard: 0,
      discardSource: "draw",
      dealer: 0,
      turn: 0,
      ended: false,
    },
    events: [],
    phase: "turn",
    deadlineAt: new Date(30_000).toISOString(),
  };
}

function waitingHand(copy: number): TileInstance[] {
  return [
    tile("c1", copy), tile("c2", copy), tile("c3", copy),
    tile("c4", copy), tile("c5", copy), tile("c6", copy),
    tile("c7", copy), tile("c8", copy), tile("c9", copy),
    tile("d1", copy), tile("d2", copy), tile("d3", copy),
    tile("b1", copy), tile("b2", copy), tile("b3", copy),
    tile("wind-east", copy),
  ];
}

function waitingOnC5(): TileInstance[] {
  return [
    tile("c3", 0), tile("c4", 0),
    tile("c6", 0), tile("c7", 0), tile("c8", 0),
    tile("d1", 0), tile("d2", 0), tile("d3", 0),
    tile("b1", 0), tile("b2", 0), tile("b3", 0),
    tile("wind-east", 0), tile("wind-east", 1), tile("wind-east", 2),
    tile("dragon-red", 0), tile("dragon-red", 1),
  ];
}

function tile(key: string, copy: number): TileInstance {
  const found = createTileSet().find((candidate) => candidate.id === `${key}-${copy}`);
  if (!found) throw new Error(`Missing test tile ${key}-${copy}`);
  return found;
}

function tileCount(state: MultiplayerMahjongState): number {
  return (
    state.round.wall.length +
    state.round.deadWall.length +
    state.round.players.reduce(
      (total, player) =>
        total +
        player.hand.length +
        player.flowers.length +
        player.discards.length +
        player.melds.reduce((meldTotal, meld) => meldTotal + meld.tiles.length, 0) +
        (player.winningTile ? 1 : 0),
      0,
    )
  );
}
