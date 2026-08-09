import type {
  FreeformAnchor,
  FreeformAssetProgram,
  FreeformPart,
  FreeformShapeNode,
  FreeformShapeOp,
  Vec2,
  Vec3,
} from "./freeformAssetProgram";

const centerAnchor: FreeformAnchor = { kind: "center", direction: [0, 1, 0] };

function node(id: string, op: FreeformShapeOp, overrides: Partial<FreeformShapeNode> = {}): FreeformShapeNode {
  return {
    id,
    op,
    inputs: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    size: [1, 1, 1],
    radius: 0.5,
    radiusTop: 0.2,
    radiusBottom: 0.5,
    tube: 0.12,
    height: 1,
    roundness: 0.08,
    smoothness: 0.12,
    amount: 0.1,
    frequency: 5,
    points: [],
    radii: [],
    polygon: [],
    profile: [],
    ...overrides,
  };
}

function attachment(
  parentPartId = "",
  options: {
    offset?: Vec3;
    parentAnchor?: FreeformAnchor;
    rotation?: Vec3;
    scale?: Vec3;
    selfAnchor?: FreeformAnchor;
  } = {},
) {
  return {
    parentPartId,
    parentAnchor: options.parentAnchor ?? centerAnchor,
    selfAnchor: options.selfAnchor ?? centerAnchor,
    offset: options.offset ?? ([0, 0, 0] as Vec3),
    rotation: options.rotation ?? ([0, 0, 0] as Vec3),
    scale: options.scale ?? ([1, 1, 1] as Vec3),
  };
}

function part(
  id: string,
  name: string,
  materialIndex: number,
  rootNodeId: string,
  nodes: FreeformShapeNode[],
  partAttachment = attachment(),
): FreeformPart {
  return { id, name, materialIndex, rootNodeId, nodes, attachment: partAttachment };
}

const commonPresentation = { rotation: [0.08, -0.2, 0] as Vec3, scale: 1 };

export const freeformMeteor: FreeformAssetProgram = {
  version: 3,
  name: "Voidglass Bloom Meteor",
  move: "rock",
  summary: "A cratered smooth-union meteor with surface-anchored crystal growths and a luminous front core.",
  surfaceDetailMode: "geometry",
  materials: [
    {
      name: "voidglass",
      color: "#21183f",
      emissive: "#09031c",
      emissiveIntensity: 0.35,
      flatShading: false,
      metalness: 0.45,
      opacity: 1,
      roughness: 0.32,
    },
    {
      name: "cyan crystal",
      color: "#65eaff",
      emissive: "#1fbfff",
      emissiveIntensity: 1.8,
      flatShading: true,
      metalness: 0.15,
      opacity: 0.94,
      roughness: 0.18,
    },
    {
      name: "molten core",
      color: "#ff59d6",
      emissive: "#ff1ebd",
      emissiveIntensity: 2.4,
      flatShading: false,
      metalness: 0.1,
      opacity: 1,
      roughness: 0.22,
    },
  ],
  parts: [
    part("body", "Cratered meteor body", 0, "weathered", [
      node("bodySphere", "sphere", { radius: 0.82, scale: [1.08, 0.9, 1] }),
      node("lowerLobe", "sphere", { radius: 0.48, position: [-0.35, -0.28, 0.08] }),
      node("mass", "smoothUnion", { inputs: ["bodySphere", "lowerLobe"], smoothness: 0.24 }),
      node("crater", "sphere", { radius: 0.34, position: [0.3, 0.2, 0.68], scale: [1.1, 0.8, 0.5] }),
      node("carved", "subtract", { inputs: ["mass", "crater"] }),
      node("weathered", "noise", { inputs: ["carved"], amount: 0.24, frequency: 7 }),
    ]),
    part(
      "crown",
      "Crystal crown",
      1,
      "crownUnion",
      [
        node("spine", "cone", { height: 0.78, radiusBottom: 0.22, radiusTop: 0.01 }),
        node("sideSpine", "cone", {
          height: 0.52,
          radiusBottom: 0.16,
          radiusTop: 0.01,
          position: [0.2, -0.08, 0],
          rotation: [0, 0, -0.45],
        }),
        node("crownUnion", "smoothUnion", { inputs: ["spine", "sideSpine"], smoothness: 0.08 }),
      ],
      attachment("body", {
        parentAnchor: { kind: "surface", direction: [0.35, 0.95, 0.08] },
        selfAnchor: { kind: "bottom", direction: [0, -1, 0] },
        rotation: [0.05, 0, -0.18],
      }),
    ),
    part(
      "core",
      "Luminous crater core",
      2,
      "coreShape",
      [
        node("coreShape", "sphere", { radius: 0.24, scale: [1.05, 0.8, 0.35] }),
      ],
      attachment("body", {
        parentAnchor: { kind: "surface", direction: [0.28, 0.18, 1] },
        selfAnchor: { kind: "back", direction: [0, 0, -1] },
        offset: [0, 0, -0.02],
      }),
    ),
  ],
  quality: { resolution: 22 },
  presentation: commonPresentation,
  textureMaterialIndex: 0,
  texturePrompt:
    "Seamless dark violet volcanic glass with tiny cyan mineral veins and sparse magenta heat cracks, flat albedo, no objects or lighting",
};

export const freeformPaperDragon: FreeformAssetProgram = {
  version: 3,
  name: "Holographic Ribbon Drake",
  move: "paper",
  summary: "A swept serpentine paper body smoothly joined to two extruded origami wings and a luminous eye.",
  surfaceDetailMode: "geometry",
  materials: [
    {
      name: "holographic paper",
      color: "#a8fff1",
      emissive: "#2dd9ff",
      emissiveIntensity: 0.6,
      flatShading: true,
      metalness: 0.3,
      opacity: 0.95,
      roughness: 0.28,
    },
    {
      name: "neon ink",
      color: "#ff4ec8",
      emissive: "#ff20b9",
      emissiveIntensity: 2.2,
      flatShading: false,
      metalness: 0.05,
      opacity: 1,
      roughness: 0.2,
    },
  ],
  parts: [
    part("sheet", "Folded dragon sheet", 0, "sheetUnion", [
      node("bodyRibbon", "sweep", {
        points: [
          [0, -1.12, 0],
          [-0.08, -0.55, 0],
          [0, 0.02, 0],
          [0.08, 0.48, 0],
          [0.38, 0.78, 0],
        ],
        radii: [0.035, 0.1, 0.23, 0.14, 0.17],
      }),
      node("leftWing", "extrude", {
        polygon: [
          [-0.08, 0.18],
          [-1.08, 0.82],
          [-0.72, -0.16],
          [-0.05, -0.24],
        ],
        height: 0.09,
      }),
      node("rightWing", "extrude", {
        polygon: [
          [0.08, 0.18],
          [1.04, 0.72],
          [0.72, -0.18],
          [0.04, -0.24],
        ],
        height: 0.09,
      }),
      node("sheetUnion", "smoothUnion", {
        inputs: ["bodyRibbon", "leftWing", "rightWing"],
        smoothness: 0.075,
      }),
    ]),
    part(
      "eye",
      "Neon eye",
      1,
      "eyeOrb",
      [node("eyeOrb", "sphere", { radius: 0.07, scale: [1, 0.7, 0.3] })],
      attachment("sheet", {
        parentAnchor: { kind: "top", direction: [0, 1, 0] },
        selfAnchor: { kind: "back", direction: [0, 0, -1] },
        offset: [0.35, -0.12, 0],
      }),
    ),
  ],
  quality: { resolution: 24 },
  presentation: { rotation: [0.02, -0.08, -0.02], scale: 1 },
  textureMaterialIndex: 0,
  texturePrompt:
    "Seamless pale holographic foil with fine cyan circuit folds, subtle pink iridescence, flat albedo, no object, no lighting",
};

function bladePolygon(mirrored: boolean): Vec2[] {
  const sign = mirrored ? -1 : 1;
  return [
    [-0.1 * sign, -0.1],
    [0.12 * sign, -0.1],
    [0.2 * sign, 0.95],
    [0.05 * sign, 1.55],
    [-0.03 * sign, 0.96],
  ];
}

export const freeformRelicScissors: FreeformAssetProgram = {
  version: 3,
  name: "Relic Raven Shears",
  move: "scissors",
  summary: "Extruded opposing blades and swept bone handles assembled around a shared ruby pivot.",
  surfaceDetailMode: "geometry",
  materials: [
    {
      name: "relic gold",
      color: "#d8a62c",
      emissive: "#2b1700",
      emissiveIntensity: 0.2,
      flatShading: false,
      metalness: 0.88,
      opacity: 1,
      roughness: 0.28,
    },
    {
      name: "carved bone",
      color: "#f4e7c7",
      emissive: "#110b04",
      emissiveIntensity: 0.08,
      flatShading: false,
      metalness: 0.05,
      opacity: 1,
      roughness: 0.58,
    },
    {
      name: "ruby",
      color: "#c91549",
      emissive: "#ff174f",
      emissiveIntensity: 1.5,
      flatShading: true,
      metalness: 0.22,
      opacity: 1,
      roughness: 0.2,
    },
  ],
  parts: [
    part("pivot", "Gold pivot plate", 0, "pivotDisk", [
      node("pivotDisk", "cylinder", { radius: 0.19, height: 0.12, rotation: [Math.PI / 2, 0, 0] }),
    ]),
    part(
      "leftBlade",
      "Left raven blade",
      0,
      "leftBladeShape",
      [node("leftBladeShape", "extrude", { polygon: bladePolygon(false), height: 0.09 })],
      attachment("pivot", {
        parentAnchor: centerAnchor,
        selfAnchor: { kind: "bottom", direction: [0, -1, 0] },
        offset: [-0.1, 0.02, 0],
        rotation: [0, 0, 0.43],
      }),
    ),
    part(
      "rightBlade",
      "Right raven blade",
      0,
      "rightBladeShape",
      [node("rightBladeShape", "extrude", { polygon: bladePolygon(true), height: 0.09 })],
      attachment("pivot", {
        parentAnchor: centerAnchor,
        selfAnchor: { kind: "bottom", direction: [0, -1, 0] },
        offset: [0.1, 0.02, 0],
        rotation: [0, 0, -0.43],
      }),
    ),
    part(
      "leftHandle",
      "Left bone handle",
      1,
      "leftHandleShape",
      [
        node("leftRing", "torus", { radius: 0.32, tube: 0.075, position: [-0.12, -0.36, 0], rotation: [Math.PI / 2, 0, 0] }),
        node("leftBridge", "sweep", {
          points: [
            [0, 0.12, 0],
            [-0.08, -0.18, 0],
          ],
          radii: [0.085, 0.075],
        }),
        node("leftHandleShape", "smoothUnion", { inputs: ["leftRing", "leftBridge"], smoothness: 0.08 }),
      ],
      attachment("pivot", {
        parentAnchor: centerAnchor,
        selfAnchor: { kind: "top", direction: [0, 1, 0] },
        offset: [-0.17, -0.04, 0],
        rotation: [0, 0, 0.16],
      }),
    ),
    part(
      "rightHandle",
      "Right bone handle",
      1,
      "rightHandleShape",
      [
        node("rightRing", "torus", { radius: 0.32, tube: 0.075, position: [0.12, -0.36, 0], rotation: [Math.PI / 2, 0, 0] }),
        node("rightBridge", "sweep", {
          points: [
            [0, 0.12, 0],
            [0.08, -0.18, 0],
          ],
          radii: [0.085, 0.075],
        }),
        node("rightHandleShape", "smoothUnion", { inputs: ["rightRing", "rightBridge"], smoothness: 0.08 }),
      ],
      attachment("pivot", {
        parentAnchor: centerAnchor,
        selfAnchor: { kind: "top", direction: [0, 1, 0] },
        offset: [0.17, -0.04, 0],
        rotation: [0, 0, -0.16],
      }),
    ),
    part(
      "ruby",
      "Ruby pivot gem",
      2,
      "rubyGem",
      [node("rubyGem", "sphere", { radius: 0.115, scale: [1, 1, 0.55] })],
      attachment("pivot", {
        parentAnchor: { kind: "front", direction: [0, 0, 1] },
        selfAnchor: { kind: "back", direction: [0, 0, -1] },
      }),
    ),
  ],
  quality: { resolution: 22 },
  presentation: { rotation: [0.04, -0.08, 0], scale: 1 },
  textureMaterialIndex: 0,
  texturePrompt:
    "Seamless aged ivory bone and antique gold filigree with tiny ruby chips, flat albedo, no object, no lighting",
};

export const freeformFixtures = [freeformMeteor, freeformPaperDragon, freeformRelicScissors];
