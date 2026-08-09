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
  type FreeformAssetProgram,
  validateFreeformAssetProgram,
} from "./freeformAssetProgram";

function silhouetteProgram(): FreeformAssetProgram {
  const program = structuredClone(freeformMeteor);
  const source = program.parts[0]!.nodes[0]!;
  const silhouette = {
    ...source,
    id: "outline",
    op: "silhouette" as const,
    inputs: [],
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    height: 0.16,
    roundness: 0.025,
    polygon: [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as Array<[number, number]>,
    holes: [[
      [-0.35, -0.35],
      [-0.35, 0.35],
      [0.35, 0.35],
      [0.35, -0.35],
    ]] as Array<Array<[number, number]>>,
  };
  program.name = "Silhouette test";
  program.parts = [{
    ...program.parts[0]!,
    rootNodeId: silhouette.id,
    nodes: [silhouette],
    attachment: {
      ...program.parts[0]!.attachment,
      offset: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  }];
  program.presentation = { rotation: [0, 0, 0], scale: 1 };
  return program;
}

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

  it("accepts useful multi-part attachment offsets and rejects oversized ones", () => {
    const valid = structuredClone(freeformMeteor);
    valid.parts[1]!.attachment.offset = [1.25, -0.8, 0.65];
    expect(() => validateFreeformAssetProgram(valid)).not.toThrow();

    valid.parts[1]!.attachment.offset = [2.01, 0, 0];
    expect(() => validateFreeformAssetProgram(valid)).toThrow(/attachment is invalid/);
  });

  it("accepts non-unit anchor directions that the renderer normalizes", () => {
    const valid = structuredClone(freeformMeteor);
    valid.parts[1]!.attachment.parentAnchor.direction = [-1.85, 0.35, 0.25];
    expect(() => validateFreeformAssetProgram(valid)).not.toThrow();

    valid.parts[1]!.attachment.parentAnchor.direction = [-3.01, 0, 0];
    expect(() => validateFreeformAssetProgram(valid)).toThrow(/anchor direction is invalid/);
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

  it("meshes thin multi-component parts returned by Grok", () => {
    const generated = structuredClone(freeformMeteor);
    const part = generated.parts[0]!;
    const template = structuredClone(part.nodes[0]!);
    const primitive = (
      id: string,
      position: [number, number, number],
    ) => ({
      ...structuredClone(template),
      id,
      op: "box" as const,
      inputs: [],
      position,
      rotation: [0, 0, 0.12] as [number, number, number],
      size: [0.95, 0.14, 0.045] as [number, number, number],
    });
    const combine = (id: string, inputs: string[], smoothness: number) => ({
      ...structuredClone(template),
      id,
      op: "smoothUnion" as const,
      inputs,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      smoothness,
    });

    part.id = "arm1";
    part.nodes = [
      primitive("blade", [0.42, 0.06, 0]),
      primitive("shank", [-1.15, -1.08, 0]),
      primitive("loop", [-1.52, -1.28, 0]),
      primitive("pivot", [0, 0, 0]),
      combine("join1", ["blade", "shank"], 0.08),
      combine("join2", ["join1", "loop"], 0.07),
      combine("armUnion", ["join2", "pivot"], 0.05),
    ];
    part.rootNodeId = "armUnion";
    generated.parts = [part];
    generated.surfaceDetailMode = "geometry";
    generated.quality.resolution = 22;

    const built = buildFreeformAsset(generated);
    try {
      expect(built.triangles).toBeGreaterThan(0);
    } finally {
      disposeFreeformAsset(built.group);
    }
  });

  it("directly extrudes a crisp silhouette while preserving holes", () => {
    const built = buildFreeformAsset(silhouetteProgram());
    try {
      expect(built.triangles).toBeGreaterThan(20);
      const mesh = built.group.children[0] as THREE.Mesh;
      built.group.updateMatrixWorld(true);
      const raycaster = new THREE.Raycaster();
      raycaster.set(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
      expect(raycaster.intersectObject(mesh)).toHaveLength(0);
      raycaster.set(new THREE.Vector3(0.8, 0, 5), new THREE.Vector3(0, 0, -1));
      expect(raycaster.intersectObject(mesh).length).toBeGreaterThan(0);
    } finally {
      disposeFreeformAsset(built.group);
    }
  });

  it("builds a guaranteed-open extruded ring for handles and eyelets", () => {
    const program = silhouetteProgram();
    const node = program.parts[0]!.nodes[0]!;
    node.op = "ring";
    node.radius = 0.8;
    node.tube = 0.2;
    node.polygon = [];
    node.holes = [];
    const built = buildFreeformAsset(program);
    try {
      const mesh = built.group.children[0] as THREE.Mesh;
      built.group.updateMatrixWorld(true);
      const raycaster = new THREE.Raycaster();
      raycaster.set(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
      expect(raycaster.intersectObject(mesh)).toHaveLength(0);
      raycaster.set(new THREE.Vector3(1.05, 0, 5), new THREE.Vector3(0, 0, -1));
      expect(raycaster.intersectObject(mesh).length).toBeGreaterThan(0);
    } finally {
      disposeFreeformAsset(built.group);
    }
  });

  it("builds a sharp elongated wedge without SDF blurring", () => {
    const program = silhouetteProgram();
    const node = program.parts[0]!.nodes[0]!;
    node.op = "wedge";
    node.size = [0.35, 2.4, 0.1];
    node.amount = 0.4;
    node.polygon = [];
    node.holes = [];
    const built = buildFreeformAsset(program);
    try {
      const geometry = (built.group.children[0] as THREE.Mesh).geometry;
      const size = geometry.boundingBox!.getSize(new THREE.Vector3());
      expect(size.y / size.x).toBeGreaterThan(5);
      expect(size.z).toBeGreaterThanOrEqual(0.1);
      expect(size.z).toBeLessThan(0.2);
    } finally {
      disposeFreeformAsset(built.group);
    }
  });

  it("deterministically untangles crossed silhouette point ordering", () => {
    const crossed = silhouetteProgram();
    crossed.parts[0]!.nodes[0]!.polygon = [[-1, -1], [1, 1], [-1, 1], [1, -1]];
    expect(() => validateFreeformAssetProgram(crossed)).not.toThrow();
    const built = buildFreeformAsset(crossed);
    try {
      expect(built.triangles).toBeGreaterThan(20);
    } finally {
      disposeFreeformAsset(built.group);
    }
  });

  it("rejects silhouette holes outside the outline", () => {
    const invalid = silhouetteProgram();
    invalid.parts[0]!.nodes[0]!.holes = [[[1.2, 1.2], [1.4, 1.2], [1.4, 1.4], [1.2, 1.4]]];
    expect(() => validateFreeformAssetProgram(invalid)).toThrow(/strictly inside/);
  });

  it("keeps silhouette geometry isolated from SDF graph nodes", () => {
    const invalid = silhouetteProgram();
    invalid.parts[0]!.nodes.push({ ...invalid.parts[0]!.nodes[0]!, id: "extra", op: "sphere" });
    expect(() => validateFreeformAssetProgram(invalid)).toThrow(/only root node/);
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
