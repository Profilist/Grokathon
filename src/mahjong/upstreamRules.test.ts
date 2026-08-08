// Adapted from elh/mahjong-3d src/sim/sim.test.ts at 9632189 (MIT).
import { describe, expect, it } from "vitest";
import { createBaselineBot } from "../../supabase/functions/_shared/mahjong/bots/baselineBot";
import { createMultiplayerRound } from "../../supabase/functions/_shared/mahjong/multiplayer";
import { claimPriority } from "../../supabase/functions/_shared/mahjong/sim/claimPriority";
import { analyzeHand, evaluateDiscard } from "../../supabase/functions/_shared/mahjong/sim/handAnalysis";
import { validateBetweenTurns } from "../../supabase/functions/_shared/mahjong/sim/invariants";
import { replayEvents } from "../../supabase/functions/_shared/mahjong/sim/replay";
import { createSeededRng, shuffle } from "../../supabase/functions/_shared/mahjong/sim/rng";
import { createTileSet, isFlower, type TileInstance, tileKey } from "../../supabase/functions/_shared/mahjong/sim/tiles";
import {
  createShuffledWalls,
  createWallBreak,
  physicalWallSlotMap,
  wallSideStacks,
  wallStackCount,
} from "../../supabase/functions/_shared/mahjong/sim/wall";
import { isWinningHand } from "../../supabase/functions/_shared/mahjong/sim/win";

describe("vendored Mahjong rules", () => {
  it("generates the complete Taiwanese wall with unique tiles", () => {
    const tiles = createTileSet();
    expect(tiles).toHaveLength(144);
    expect(new Set(tiles.map((tile) => tile.id)).size).toBe(144);
    expect(tiles.filter((tile) => tile.kind.category === "flower")).toHaveLength(8);
  });

  it("shuffles deterministically for a fixed seed", () => {
    const tiles = createTileSet();
    const left = shuffle(tiles, createSeededRng("fixed-seed")).map((tile) => tile.id);
    const right = shuffle(tiles, createSeededRng("fixed-seed")).map((tile) => tile.id);
    expect(left).toEqual(right);
  });

  it("derives the wall break from the three dice and draws left of the cut", () => {
    const seed = "wall-cut-order";
    const expectedBreak = createWallBreak(seed, 0, [1, 2, 3]);
    expect(expectedBreak).toEqual({
      dice: [1, 2, 3],
      diceTotal: 6,
      wallOwner: 1,
      cutStack: wallSideStacks + 6,
    });

    const { wall, deadWall, wallBreak } = createShuffledWalls(seed, 0, [1, 2, 3]);
    const slots = physicalWallSlotMap(seed);
    const previousCutStack = (wallBreak.cutStack + wallStackCount - 1) % wallStackCount;
    expect(slots.get(wall[0]!.id)).toBe(previousCutStack + wallStackCount);
    expect(slots.get(deadWall[0]!.id)).toBe(wallBreak.cutStack + wallStackCount);
  });

  it("deals 17 tiles to East, 16 to the other seats, and keeps valid counts", () => {
    const state = createMultiplayerRound("deal-test", 1_000);
    expect(state.round.players.map((player) => player.hand.length)).toEqual([17, 16, 16, 16]);
    expect(validateBetweenTurns(state.round)).toEqual([]);
    expect(state.round.deadWall).toHaveLength(16);
    expect(state.round.wall.length).toBeGreaterThan(40);
    expect(state.round.wall.length).toBeLessThanOrEqual(63);
  });

  it("exposes setup flowers and replaces them from the dead wall", () => {
    const state = createMultiplayerRound("stable-log", 1_000);
    const exposedFlowers = state.round.players.flatMap((player) => player.flowers);
    expect(exposedFlowers.length).toBeGreaterThan(0);
    expect(state.round.players.every((player) => player.hand.every((tile) => !isFlower(tile)))).toBe(true);
    expect(
      state.events.some(
        (event) => event.type === "tilesDrawn" && event.phase === "setup" && event.source === "deadWall",
      ),
    ).toBe(true);
  });

  it("replays the deterministic setup into the same visible hands and walls", () => {
    const state = createMultiplayerRound("replay-setup", 1_000);
    const replay = replayEvents(state.events);
    expect(replay.wall.map((tile) => tile.id)).toEqual(state.round.wall.map((tile) => tile.id));
    expect(replay.deadWall.map((tile) => tile.id)).toEqual(state.round.deadWall.map((tile) => tile.id));
    for (const player of state.round.players) {
      expect(replay.players[player.id].hand.map((tile) => tile.id).sort()).toEqual(
        player.hand.map((tile) => tile.id).sort(),
      );
      expect(replay.players[player.id].flowers.map((tile) => tile.id).sort()).toEqual(
        player.flowers.map((tile) => tile.id).sort(),
      );
    }
  });

  it("keeps the upstream claim order: win, kong, pong, then chow", () => {
    expect(
      (["win", "kong", "pong", "chow"] as const).map((claim) => claimPriority(claim)),
    ).toEqual([4, 3, 2, 1]);
  });

  it("recognizes Taiwanese seven pairs plus a triplet as a winning hand", () => {
    const hand = tilesByKinds([
      ["c1", 2], ["c2", 2], ["c3", 2], ["d4", 2],
      ["d5", 2], ["b6", 2], ["b7", 2], ["dragon-red", 3],
    ]);
    expect(isWinningHand(hand)).toBe(true);
  });

  it("counts live waits after an improving discard", () => {
    const hand = tilesByKinds([
      ["c1", 1], ["c2", 1], ["c3", 1], ["c4", 1], ["c5", 1], ["c6", 1],
      ["d1", 1], ["d2", 1], ["d3", 1], ["b1", 1], ["b2", 1], ["b3", 1],
      ["c7", 1], ["c8", 1], ["dragon-red", 2], ["wind-east", 1],
    ]);
    const wind = hand.find((tile) => tileKey(tile.kind) === "wind-east");
    if (!wind) throw new Error("Missing wind tile");
    const analysis = evaluateDiscard(hand, [], [], wind);
    expect(analysis).toMatchObject({
      shanten: 0,
      waitKeys: ["c3", "c6", "c9"],
      liveWaits: 10,
    });
    expect(analyzeHand(hand, [], []).shanten).toBeGreaterThanOrEqual(analysis.shanten);
  });

  it("has the baseline bot return one of the legal discards", () => {
    const state = createMultiplayerRound("bot-test", 1_000);
    const player = state.round.players[0];
    const legalActions = player.hand.map((tile) => ({ type: "discard" as const, tileId: tile.id }));
    const action = createBaselineBot().chooseAction({
      player: 0,
      legalActions,
      visibleTiles: [],
      hand: player.hand,
      melds: player.melds,
      wallCount: state.round.wall.length,
      turn: 0,
    });
    expect(action.type).toBe("discard");
    expect(legalActions).toContainEqual(action);
  });
});

function tilesByKinds(requested: [string, number][]): TileInstance[] {
  const tiles = createTileSet();
  return requested.flatMap(([key, count]) =>
    tiles.filter((tile) => tileKey(tile.kind) === key).slice(0, count),
  );
}
