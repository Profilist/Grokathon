import { describe, expect, it } from "vitest";
import { freeformMeteor } from "./freeformAssetFixtures";
import {
  parseGeneratedAssetJob,
  parseRenderableRpsAsset,
  parseRevealedRpsAssets,
} from "./generatedRpsAssets";

const assetId = "85f15d58-cbd9-4eaf-bd5d-9ffed6f903d2";

describe("generated RPS assets", () => {
  it("accepts a valid generation job", () => {
    expect(parseGeneratedAssetJob({ assetId, status: "generating" })).toEqual({
      assetId,
      status: "generating",
    });
  });

  it("validates a renderable asset program", () => {
    const asset = parseRenderableRpsAsset({
      id: assetId,
      move: "rock",
      name: "Meteor",
      program: freeformMeteor,
      textureUrl: null,
    });
    expect(asset.program.name).toBe(freeformMeteor.name);
  });

  it("rejects an asset whose program changes the move", () => {
    expect(() =>
      parseRenderableRpsAsset({
        id: assetId,
        move: "paper",
        program: freeformMeteor,
        textureUrl: null,
      }),
    ).toThrow(/does not match/);
  });

  it("accepts missing custom assets in a revealed round", () => {
    expect(parseRevealedRpsAssets({ host: null, guest: null })).toEqual({
      host: null,
      guest: null,
    });
  });
});
