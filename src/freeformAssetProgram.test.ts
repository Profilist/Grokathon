import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  freeformFixtures,
  freeformMeteor,
  freeformPaperDragon,
  freeformRelicScissors,
} from "./freeformAssetFixtures";
import {
  MAX_FREEFORM_TRIANGLES,
  buildFreeformAsset,
  disposeFreeformAsset,
  validateFreeformAssetProgram,
} from "./freeformAssetProgram";

describe("freeform asset programs", () => {
  it.each(freeformFixtures.map((program) => [program.name, program] as const))(
    "validates and meshes %s",
    (_name, input) => {
      const program = validateFreeformAssetProgram(input);
      const built = buildFreeformAsset(program);
      try {
        expect(built.group.children).toHaveLength(program.parts.length);
        expect(built.triangles).toBeGreaterThan(100);
        expect(built.triangles).toBeLessThanOrEqual(MAX_FREEFORM_TRIANGLES);
        const position = built.group.children[0]!.position;
        expect([position.x, position.y, position.z].every(Number.isFinite)).toBe(true);
      } finally {
        disposeFreeformAsset(built.group);
      }
    },
    20_000,
  );

  it("rejects cyclic shape graphs", () => {
    const invalid = structuredClone(freeformMeteor);
    invalid.parts[0]!.nodes[0]!.op = "union";
    invalid.parts[0]!.nodes[0]!.inputs = ["weathered", "lowerLobe"];
    expect(() => validateFreeformAssetProgram(invalid)).toThrow(/cycle/);
  });

  it("rejects self-overlapping toruses", () => {
    const invalid = structuredClone(freeformRelicScissors);
    const ring = invalid.parts[3]!.nodes.find(({ op }) => op === "torus")!;
    ring.tube = ring.radius;
    expect(() => validateFreeformAssetProgram(invalid)).toThrow(/torus tube/);
  });

  it("rejects attachment cycles", () => {
    const invalid = structuredClone(freeformMeteor);
    invalid.parts[0]!.attachment.parentPartId = "crown";
    invalid.parts[2]!.attachment.parentPartId = "";
    expect(() => validateFreeformAssetProgram(invalid)).toThrow(/attachment graph contains a cycle/);
  });

  it("rejects self-intersecting extrusion outlines", () => {
    const invalid = structuredClone(freeformPaperDragon);
    const extrusion = invalid.parts[0]!.nodes.find(({ op }) => op === "extrude")!;
    extrusion.polygon = [
      [-1, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
    ];
    expect(() => validateFreeformAssetProgram(invalid)).toThrow(/polygon self-intersects/);
  });

  it("rejects parts whose CSG result is visibly disconnected", () => {
    const invalid = structuredClone(freeformMeteor);
    invalid.parts[0]!.nodes.find(({ id }) => id === "lowerLobe")!.position = [2.5, 2.5, 2.5];
    expect(() => buildFreeformAsset(invalid)).toThrow(/disconnected geometry/);
  });

  it("rejects a texture material outside the declared palette", () => {
    const invalid = structuredClone(freeformMeteor);
    invalid.textureMaterialIndex = invalid.materials.length;
    expect(() => validateFreeformAssetProgram(invalid)).toThrow(/texture material index/);
  });

  it("requires texture-driven surface detail to use one geometry part", () => {
    const invalid = structuredClone(freeformMeteor);
    invalid.surfaceDetailMode = "texture";
    expect(() => validateFreeformAssetProgram(invalid)).toThrow(/exactly one geometry part/);
  });

  it("generates seam-safe spherical UVs for a sphere-derived textured solid", () => {
    const ball = structuredClone(freeformMeteor);
    ball.surfaceDetailMode = "texture";
    const body = ball.parts[0]!;
    const sphere = body.nodes.find(({ id }) => id === "bodySphere")!;
    body.nodes = [sphere];
    body.rootNodeId = sphere.id;
    ball.parts = [body];
    ball.quality.resolution = 16;
    const built = buildFreeformAsset(ball);
    try {
      const geometry = (built.group.children[0] as THREE.Mesh).geometry;
      const positions = geometry.getAttribute("position");
      const uv = geometry.getAttribute("uv");
      expect(geometry.index).toBeNull();
      expect(uv.count).toBe(positions.count);
      const values = Array.from(
        { length: uv.count },
        (_, index) => [uv.getX(index), uv.getY(index)] as [number, number],
      );
      expect(Math.min(...values.map(([u]) => u))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...values.map(([u]) => u))).toBeLessThanOrEqual(2);
      expect(Math.min(...values.map(([, v]) => v))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...values.map(([, v]) => v))).toBeLessThanOrEqual(1);
    } finally {
      disposeFreeformAsset(built.group);
    }
  });

  it("only accepts simple surface-attached extrusions as decals", () => {
    const invalid = structuredClone(freeformMeteor);
    invalid.surfaceDetailMode = "decal";
    expect(() => validateFreeformAssetProgram(invalid)).toThrow(/Decal part/);
  });
});
