export const MAX_FREEFORM_PARTS = 12;
export const MAX_FREEFORM_MATERIALS = 6;
export const MAX_FREEFORM_NODES = 80;
export const MAX_FREEFORM_TRIANGLES = 48_000;
export const MAX_FREEFORM_ATTACHMENT_OFFSET = 2;

export type FreeformMove = "rock" | "paper" | "scissors";
export type FreeformSurfaceDetailMode = "texture" | "decal" | "geometry";
export type FreeformShapeOp =
  | "sphere"
  | "box"
  | "capsule"
  | "torus"
  | "ring"
  | "wedge"
  | "cylinder"
  | "cone"
  | "sweep"
  | "extrude"
  | "silhouette"
  | "lathe"
  | "union"
  | "smoothUnion"
  | "subtract"
  | "intersect"
  | "twist"
  | "bend"
  | "noise";
export type FreeformAnchorKind =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "front"
  | "back"
  | "surface";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export interface FreeformMaterial {
  name: string;
  color: string;
  emissive: string;
  emissiveIntensity: number;
  flatShading: boolean;
  metalness: number;
  opacity: number;
  roughness: number;
}

export interface FreeformShapeNode {
  id: string;
  op: FreeformShapeOp;
  inputs: string[];
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  size: Vec3;
  radius: number;
  radiusTop: number;
  radiusBottom: number;
  tube: number;
  height: number;
  roundness: number;
  smoothness: number;
  amount: number;
  frequency: number;
  points: Vec3[];
  radii: number[];
  polygon: Vec2[];
  holes?: Vec2[][];
  profile: Vec2[];
}

export interface FreeformAnchor {
  kind: FreeformAnchorKind;
  direction: Vec3;
}

export interface FreeformAttachment {
  parentPartId: string;
  parentAnchor: FreeformAnchor;
  selfAnchor: FreeformAnchor;
  offset: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface FreeformPart {
  id: string;
  name: string;
  materialIndex: number;
  rootNodeId: string;
  nodes: FreeformShapeNode[];
  attachment: FreeformAttachment;
}

export interface FreeformAssetProgram {
  version: 3;
  name: string;
  move: FreeformMove;
  summary: string;
  surfaceDetailMode: FreeformSurfaceDetailMode;
  materials: FreeformMaterial[];
  parts: FreeformPart[];
  quality: {
    resolution: number;
  };
  presentation: {
    rotation: Vec3;
    scale: number;
  };
  textureMaterialIndex: number;
  texturePrompt: string;
}

const numberVectorSchema = (minimum: number, maximum: number) => ({
  type: "array",
  minItems: 3,
  maxItems: 3,
  items: { type: "number", minimum, maximum },
});

const point2Schema = {
  type: "array",
  minItems: 2,
  maxItems: 2,
  items: { type: "number", minimum: -3, maximum: 3 },
};

const anchorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "direction"],
  properties: {
    kind: {
      type: "string",
      enum: ["center", "top", "bottom", "left", "right", "front", "back", "surface"],
    },
    direction: numberVectorSchema(-3, 3),
  },
};

export const FREEFORM_ASSET_PROGRAM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "name",
    "move",
    "summary",
    "surfaceDetailMode",
    "materials",
    "parts",
    "quality",
    "presentation",
    "textureMaterialIndex",
    "texturePrompt",
  ],
  properties: {
    version: { type: "integer", enum: [3] },
    name: { type: "string", minLength: 1, maxLength: 64 },
    move: { type: "string", enum: ["rock", "paper", "scissors"] },
    summary: { type: "string", minLength: 1, maxLength: 280 },
    surfaceDetailMode: { type: "string", enum: ["texture", "decal", "geometry"] },
    materials: {
      type: "array",
      minItems: 1,
      maxItems: MAX_FREEFORM_MATERIALS,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "color",
          "emissive",
          "emissiveIntensity",
          "flatShading",
          "metalness",
          "opacity",
          "roughness",
        ],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 32 },
          color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          emissive: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          emissiveIntensity: { type: "number", minimum: 0, maximum: 3 },
          flatShading: { type: "boolean" },
          metalness: { type: "number", minimum: 0, maximum: 1 },
          opacity: { type: "number", minimum: 0.25, maximum: 1 },
          roughness: { type: "number", minimum: 0.05, maximum: 1 },
        },
      },
    },
    parts: {
      type: "array",
      minItems: 1,
      maxItems: MAX_FREEFORM_PARTS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "materialIndex", "rootNodeId", "nodes", "attachment"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 32, pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
          name: { type: "string", minLength: 1, maxLength: 48 },
          materialIndex: { type: "integer", minimum: 0, maximum: MAX_FREEFORM_MATERIALS - 1 },
          rootNodeId: { type: "string", minLength: 1, maxLength: 32 },
          nodes: {
            type: "array",
            minItems: 1,
            maxItems: 32,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "op",
                "inputs",
                "position",
                "rotation",
                "scale",
                "size",
                "radius",
                "radiusTop",
                "radiusBottom",
                "tube",
                "height",
                "roundness",
                "smoothness",
                "amount",
                "frequency",
                "points",
                "radii",
                "polygon",
                "holes",
                "profile",
              ],
              properties: {
                id: { type: "string", minLength: 1, maxLength: 32, pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
                op: {
                  type: "string",
                  enum: [
                    "sphere",
                    "box",
                    "capsule",
                    "torus",
                    "ring",
                    "wedge",
                    "cylinder",
                    "cone",
                    "sweep",
                    "extrude",
                    "silhouette",
                    "lathe",
                    "union",
                    "smoothUnion",
                    "subtract",
                    "intersect",
                    "twist",
                    "bend",
                    "noise",
                  ],
                },
                inputs: {
                  type: "array",
                  minItems: 0,
                  maxItems: 8,
                  items: { type: "string", minLength: 1, maxLength: 32 },
                },
                position: numberVectorSchema(-3, 3),
                rotation: numberVectorSchema(-6.3, 6.3),
                scale: numberVectorSchema(0.05, 4),
                size: numberVectorSchema(0.02, 4),
                radius: { type: "number", minimum: 0.02, maximum: 2 },
                radiusTop: { type: "number", minimum: 0, maximum: 2 },
                radiusBottom: { type: "number", minimum: 0, maximum: 2 },
                tube: { type: "number", minimum: 0.01, maximum: 0.8 },
                height: { type: "number", minimum: 0.02, maximum: 4 },
                roundness: { type: "number", minimum: 0, maximum: 0.5 },
                smoothness: { type: "number", minimum: 0.01, maximum: 1 },
                amount: { type: "number", minimum: -3.15, maximum: 3.15 },
                frequency: { type: "number", minimum: 0.1, maximum: 20 },
                points: {
                  type: "array",
                  minItems: 0,
                  maxItems: 16,
                  items: numberVectorSchema(-3, 3),
                },
                radii: {
                  type: "array",
                  minItems: 0,
                  maxItems: 16,
                  items: { type: "number", minimum: 0.01, maximum: 1.5 },
                },
                polygon: {
                  type: "array",
                  minItems: 0,
                  maxItems: 32,
                  items: point2Schema,
                },
                holes: {
                  type: "array",
                  minItems: 0,
                  maxItems: 6,
                  items: {
                    type: "array",
                    minItems: 3,
                    maxItems: 24,
                    items: point2Schema,
                  },
                },
                profile: {
                  type: "array",
                  minItems: 0,
                  maxItems: 20,
                  items: point2Schema,
                },
              },
            },
          },
          attachment: {
            type: "object",
            additionalProperties: false,
            required: ["parentPartId", "parentAnchor", "selfAnchor", "offset", "rotation", "scale"],
            properties: {
              parentPartId: { type: "string", minLength: 0, maxLength: 32 },
              parentAnchor: anchorSchema,
              selfAnchor: anchorSchema,
              offset: numberVectorSchema(
                -MAX_FREEFORM_ATTACHMENT_OFFSET,
                MAX_FREEFORM_ATTACHMENT_OFFSET,
              ),
              rotation: numberVectorSchema(-6.3, 6.3),
              scale: numberVectorSchema(0.05, 4),
            },
          },
        },
      },
    },
    quality: {
      type: "object",
      additionalProperties: false,
      required: ["resolution"],
      properties: {
        resolution: { type: "integer", minimum: 12, maximum: 28 },
      },
    },
    presentation: {
      type: "object",
      additionalProperties: false,
      required: ["rotation", "scale"],
      properties: {
        rotation: numberVectorSchema(-6.3, 6.3),
        scale: { type: "number", minimum: 0.25, maximum: 2 },
      },
    },
    textureMaterialIndex: { type: "integer", minimum: 0, maximum: MAX_FREEFORM_MATERIALS - 1 },
    texturePrompt: { type: "string", minLength: 1, maxLength: 500 },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberIn(value: unknown, minimum: number, maximum: number) {
  return finiteNumber(value) && value >= minimum && value <= maximum;
}

function integerIn(value: unknown, minimum: number, maximum: number) {
  return Number.isInteger(value) && numberIn(value, minimum, maximum);
}

function vectorIn(value: unknown, length: 2 | 3, minimum: number, maximum: number) {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((component) => numberIn(component, minimum, maximum))
  );
}

const SHAPE_OPS = new Set<FreeformShapeOp>([
  "sphere",
  "box",
  "capsule",
  "torus",
  "ring",
  "wedge",
  "cylinder",
  "cone",
  "sweep",
  "extrude",
  "silhouette",
  "lathe",
  "union",
  "smoothUnion",
  "subtract",
  "intersect",
  "twist",
  "bend",
  "noise",
]);

const ANCHOR_KINDS = new Set<FreeformAnchorKind>([
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "front",
  "back",
  "surface",
]);

function validateAnchor(value: unknown, label: string) {
  if (!isRecord(value) || !ANCHOR_KINDS.has(value.kind as FreeformAnchorKind)) {
    throw new Error(`${label} is invalid`);
  }
  if (!vectorIn(value.direction, 3, -3, 3)) throw new Error(`${label} direction is invalid`);
  if (value.kind === "surface" && Math.hypot(...(value.direction as Vec3)) < 0.1) {
    throw new Error(`${label} surface direction cannot be zero`);
  }
}

function validateMaterial(value: unknown, index: number) {
  if (!isRecord(value)) throw new Error(`Material ${index} must be an object`);
  if (
    typeof value.name !== "string" ||
    value.name.length < 1 ||
    value.name.length > 32 ||
    typeof value.color !== "string" ||
    !/^#[0-9a-f]{6}$/i.test(value.color) ||
    typeof value.emissive !== "string" ||
    !/^#[0-9a-f]{6}$/i.test(value.emissive)
  ) {
    throw new Error(`Material ${index} has invalid identifying fields`);
  }
  if (
    !numberIn(value.emissiveIntensity, 0, 3) ||
    typeof value.flatShading !== "boolean" ||
    !numberIn(value.metalness, 0, 1) ||
    !numberIn(value.opacity, 0.25, 1) ||
    !numberIn(value.roughness, 0.05, 1)
  ) {
    throw new Error(`Material ${index} has values outside the allowed range`);
  }
}

function samePoint(left: Vec2, right: Vec2) {
  return Math.abs(left[0] - right[0]) < 1e-7 && Math.abs(left[1] - right[1]) < 1e-7;
}

function cleanPolygon(polygon: Vec2[]) {
  const cleaned = polygon.filter((point, index) => index === 0 || !samePoint(point, polygon[index - 1]!));
  if (cleaned.length > 1 && samePoint(cleaned[0]!, cleaned.at(-1)!)) cleaned.pop();
  for (let pass = 0; pass < polygon.length && cleaned.length >= 3; pass += 1) {
    const redundant = cleaned.findIndex((point, index) =>
      Math.abs(cross(cleaned[(index + cleaned.length - 1) % cleaned.length]!, point, cleaned[(index + 1) % cleaned.length]!)) < 1e-7);
    if (redundant < 0) break;
    cleaned.splice(redundant, 1);
  }
  return cleaned;
}

function cross(left: Vec2, middle: Vec2, right: Vec2) {
  return (middle[0] - left[0]) * (right[1] - left[1]) -
    (middle[1] - left[1]) * (right[0] - left[0]);
}

function signedPolygonArea(polygon: Vec2[]) {
  return polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) * 0.5;
}

function pointOnSegment(point: Vec2, start: Vec2, end: Vec2) {
  const cross = (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]);
  if (Math.abs(cross) > 1e-7) return false;
  return point[0] >= Math.min(start[0], end[0]) - 1e-7 &&
    point[0] <= Math.max(start[0], end[0]) + 1e-7 &&
    point[1] >= Math.min(start[1], end[1]) - 1e-7 &&
    point[1] <= Math.max(start[1], end[1]) + 1e-7;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > 1e-7 && abD < -1e-7) || (abC < -1e-7 && abD > 1e-7)) &&
    ((cdA > 1e-7 && cdB < -1e-7) || (cdA < -1e-7 && cdB > 1e-7))) return true;
  return pointOnSegment(c, a, b) || pointOnSegment(d, a, b) || pointOnSegment(a, c, d) || pointOnSegment(b, c, d);
}

function segmentsProperlyIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return ((abC > 1e-7 && abD < -1e-7) || (abC < -1e-7 && abD > 1e-7)) &&
    ((cdA > 1e-7 && cdB < -1e-7) || (cdA < -1e-7 && cdB > 1e-7));
}

export function normalizeFreeformPolygon(polygon: Vec2[]) {
  const normalized = cleanPolygon(polygon).map((point) => [...point] as Vec2);
  const maximumPasses = normalized.length * normalized.length;
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let crossing: [number, number] | null = null;
    for (let left = 0; left < normalized.length && !crossing; left += 1) {
      const leftNext = (left + 1) % normalized.length;
      for (let right = left + 1; right < normalized.length; right += 1) {
        const rightNext = (right + 1) % normalized.length;
        if (leftNext === right || rightNext === left) continue;
        if (segmentsProperlyIntersect(normalized[left]!, normalized[leftNext]!, normalized[right]!, normalized[rightNext]!)) {
          crossing = [leftNext, right];
          break;
        }
      }
    }
    if (!crossing) break;
    const [start, end] = crossing;
    normalized.splice(start, end - start + 1, ...normalized.slice(start, end + 1).reverse());
  }
  return normalized;
}

function polygonSelfIntersects(polygon: Vec2[]) {
  for (let left = 0; left < polygon.length; left += 1) {
    const leftNext = (left + 1) % polygon.length;
    for (let right = left + 1; right < polygon.length; right += 1) {
      const rightNext = (right + 1) % polygon.length;
      if (left === right || leftNext === right || rightNext === left) continue;
      if (segmentsIntersect(polygon[left]!, polygon[leftNext]!, polygon[right]!, polygon[rightNext]!)) return true;
    }
  }
  return false;
}

function polygonsIntersect(left: Vec2[], right: Vec2[]) {
  return left.some((point, index) => right.some((other, otherIndex) =>
    segmentsIntersect(point, left[(index + 1) % left.length]!, other, right[(otherIndex + 1) % right.length]!)));
}

function pointInPolygon(point: Vec2, polygon: Vec2[]) {
  if (polygon.some((start, index) => pointOnSegment(point, start, polygon[(index + 1) % polygon.length]!))) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [ax, ay] = polygon[previous]!;
    const [bx, by] = polygon[index]!;
    if ((ay > point[1]) !== (by > point[1]) && point[0] < ((bx - ax) * (point[1] - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function polygonCenter(polygon: Vec2[]): Vec2 {
  const total = polygon.reduce(([x, y], point) => [x + point[0], y + point[1]] as Vec2, [0, 0]);
  return [total[0] / polygon.length, total[1] / polygon.length];
}

function fitHoleInsideOutline(hole: Vec2[], outer: Vec2[]) {
  const center = polygonCenter(hole);
  if (!pointInPolygon(center, outer)) return null;
  for (let attempt = 0; attempt <= 20; attempt += 1) {
    const scale = Math.pow(0.95, attempt);
    const candidate = hole.map(([x, y]) => [
      center[0] + (x - center[0]) * scale,
      center[1] + (y - center[1]) * scale,
    ] as Vec2);
    if (candidate.every((point) => pointInPolygon(point, outer)) && !polygonsIntersect(outer, candidate)) {
      return candidate;
    }
  }
  return null;
}

export function normalizeFreeformSilhouette(polygon: Vec2[], holes: Vec2[][] = []) {
  const outer = normalizeFreeformPolygon(polygon);
  const normalizedHoles = holes.map((hole) => normalizeFreeformPolygon(hole));
  const fittedHoles = normalizedHoles.map((hole) => fitHoleInsideOutline(hole, outer));
  return { outer, holes: fittedHoles };
}

function validateSimpleRing(polygon: Vec2[], label: string) {
  const cleaned = normalizeFreeformPolygon(polygon);
  if (polygonSelfIntersects(cleaned)) throw new Error(`${label} polygon self-intersects`);
  if (cleaned.length < 3 || Math.abs(signedPolygonArea(cleaned)) < 1e-4) {
    throw new Error(`${label} needs a nonzero polygon`);
  }
  return cleaned;
}

function validateNode(value: unknown, partIndex: number, nodeIndex: number) {
  const label = `Part ${partIndex} node ${nodeIndex}`;
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (typeof value.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(value.id)) {
    throw new Error(`${label} has an invalid id`);
  }
  if (!SHAPE_OPS.has(value.op as FreeformShapeOp)) throw new Error(`${label} has an invalid operation`);
  if (!Array.isArray(value.inputs) || value.inputs.length > 8 || value.inputs.some((input) => typeof input !== "string")) {
    throw new Error(`${label} has invalid inputs`);
  }
  if (
    !vectorIn(value.position, 3, -3, 3) ||
    !vectorIn(value.rotation, 3, -6.3, 6.3) ||
    !vectorIn(value.scale, 3, 0.05, 4) ||
    !vectorIn(value.size, 3, 0.02, 4)
  ) {
    throw new Error(`${label} has an invalid transform or size`);
  }
  if (
    !numberIn(value.radius, 0.02, 2) ||
    !numberIn(value.radiusTop, 0, 2) ||
    !numberIn(value.radiusBottom, 0, 2) ||
    !numberIn(value.tube, 0.01, 0.8) ||
    !numberIn(value.height, 0.02, 4) ||
    !numberIn(value.roundness, 0, 0.5) ||
    !numberIn(value.smoothness, 0.01, 1) ||
    !numberIn(value.amount, -3.15, 3.15) ||
    !numberIn(value.frequency, 0.1, 20)
  ) {
    throw new Error(`${label} has numeric values outside the allowed range`);
  }
  if (
    !Array.isArray(value.points) ||
    value.points.length > 16 ||
    value.points.some((point) => !vectorIn(point, 3, -3, 3)) ||
    !Array.isArray(value.radii) ||
    value.radii.length > 16 ||
    value.radii.some((radius) => !numberIn(radius, 0.01, 1.5)) ||
    !Array.isArray(value.polygon) ||
    value.polygon.length > 32 ||
    value.polygon.some((point) => !vectorIn(point, 2, -3, 3)) ||
    (value.holes !== undefined && (
      !Array.isArray(value.holes) ||
      value.holes.length > 6 ||
      value.holes.some((hole) =>
        !Array.isArray(hole) || hole.length < 3 || hole.length > 24 ||
        hole.some((point) => !vectorIn(point, 2, -3, 3)))
    )) ||
    !Array.isArray(value.profile) ||
    value.profile.length > 20 ||
    value.profile.some((point) => !vectorIn(point, 2, -3, 3))
  ) {
    throw new Error(`${label} has invalid path or profile data`);
  }

  const node = value as unknown as FreeformShapeNode;
  const primitiveOps = new Set<FreeformShapeOp>(["sphere", "box", "torus", "ring", "wedge", "cylinder", "cone", "extrude", "silhouette", "lathe"]);
  if (primitiveOps.has(node.op) && node.inputs.length !== 0) throw new Error(`${label} primitive cannot have inputs`);
  if ((node.op === "capsule" || node.op === "sweep") && node.inputs.length !== 0) {
    throw new Error(`${label} sweep cannot have inputs`);
  }
  if ((node.op === "capsule" || node.op === "sweep") && (node.points.length < 2 || node.radii.length !== node.points.length)) {
    throw new Error(`${label} sweep needs matching points and radii`);
  }
  if (node.op === "extrude" && node.polygon.length < 3) throw new Error(`${label} extrusion needs a polygon`);
  if (node.op === "extrude" && polygonSelfIntersects(node.polygon)) {
    throw new Error(`${label} extrusion polygon self-intersects`);
  }
  if (node.op === "silhouette") {
    const outer = validateSimpleRing(node.polygon, `${label} silhouette`);
    const holes = (node.holes ?? []).map((hole, index) =>
      validateSimpleRing(hole, `${label} silhouette hole ${index}`));
    const fittedHoles = normalizeFreeformSilhouette(outer, holes).holes;
    fittedHoles.forEach((hole, index) => {
      if (!hole) {
        throw new Error(`${label} silhouette hole ${index} must be strictly inside its outline`);
      }
      fittedHoles.slice(0, index).forEach((other) => {
        if (!other) return;
        if (polygonsIntersect(hole, other) || pointInPolygon(hole[0]!, other) || pointInPolygon(other[0]!, hole)) {
          throw new Error(`${label} silhouette holes cannot overlap`);
        }
      });
    });
  }
  if (node.op === "lathe" && (node.profile.length < 3 || node.profile.some(([radius]) => radius < 0))) {
    throw new Error(`${label} lathe needs a nonnegative profile`);
  }
  if ((node.op === "torus" || node.op === "ring") && node.tube >= node.radius) {
    throw new Error(`${label} ${node.op} tube must be smaller than its radius`);
  }
  if ((node.op === "union" || node.op === "smoothUnion" || node.op === "intersect") && node.inputs.length < 2) {
    throw new Error(`${label} operation needs at least two inputs`);
  }
  if (node.op === "subtract" && node.inputs.length !== 2) throw new Error(`${label} subtraction needs two inputs`);
  if ((node.op === "twist" || node.op === "bend" || node.op === "noise") && node.inputs.length !== 1) {
    throw new Error(`${label} modifier needs one input`);
  }
}

function validatePartGraph(part: FreeformPart, partIndex: number) {
  const nodes = new Map<string, FreeformShapeNode>();
  part.nodes.forEach((node, nodeIndex) => {
    validateNode(node, partIndex, nodeIndex);
    if (nodes.has(node.id)) throw new Error(`Part ${partIndex} repeats node id ${node.id}`);
    nodes.set(node.id, node);
  });
  if (!nodes.has(part.rootNodeId)) throw new Error(`Part ${partIndex} root node does not exist`);
  const directNode = part.nodes.find(({ op }) => op === "silhouette" || op === "ring");
  if (directNode && (part.nodes.length !== 1 || part.rootNodeId !== directNode.id)) {
    throw new Error(`Part ${partIndex} ${directNode.op} must be the part's only root node`);
  }
  part.nodes.forEach((node) => {
    node.inputs.forEach((input) => {
      if (!nodes.has(input)) throw new Error(`Part ${partIndex} node ${node.id} references missing input ${input}`);
    });
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`Part ${partIndex} shape graph contains a cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    nodes.get(id)!.inputs.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  visit(part.rootNodeId);
  if (visited.size !== part.nodes.length) throw new Error(`Part ${partIndex} contains unreachable shape nodes`);
}

export function validateFreeformAssetProgram(value: unknown): FreeformAssetProgram {
  if (!isRecord(value)) throw new Error("Asset program must be an object");
  if (value.version !== 3) throw new Error("Asset program version must be 3");
  if (typeof value.name !== "string" || value.name.length < 1 || value.name.length > 64) {
    throw new Error("Asset program name must contain 1-64 characters");
  }
  if (value.move !== "rock" && value.move !== "paper" && value.move !== "scissors") {
    throw new Error("Asset program move is invalid");
  }
  if (typeof value.summary !== "string" || value.summary.length < 1 || value.summary.length > 280) {
    throw new Error("Asset program summary is invalid");
  }
  if (value.surfaceDetailMode !== "texture" && value.surfaceDetailMode !== "decal" && value.surfaceDetailMode !== "geometry") {
    throw new Error("Asset program surface detail mode is invalid");
  }
  if (typeof value.texturePrompt !== "string" || value.texturePrompt.length < 1 || value.texturePrompt.length > 500) {
    throw new Error("Asset program texture prompt is invalid");
  }
  if (
    !Array.isArray(value.materials) ||
    value.materials.length < 1 ||
    value.materials.length > MAX_FREEFORM_MATERIALS
  ) {
    throw new Error(`Asset program must contain 1-${MAX_FREEFORM_MATERIALS} materials`);
  }
  const materials = value.materials;
  materials.forEach(validateMaterial);
  if (!integerIn(value.textureMaterialIndex, 0, materials.length - 1)) {
    throw new Error("Asset program texture material index is invalid");
  }
  if (!Array.isArray(value.parts) || value.parts.length < 1 || value.parts.length > MAX_FREEFORM_PARTS) {
    throw new Error(`Asset program must contain 1-${MAX_FREEFORM_PARTS} parts`);
  }
  if (value.surfaceDetailMode === "texture" && value.parts.length !== 1) {
    throw new Error("Texture surface detail mode requires exactly one geometry part");
  }
  if (!isRecord(value.quality) || !integerIn(value.quality.resolution, 12, 28)) {
    throw new Error("Asset program resolution is invalid");
  }
  if (
    !isRecord(value.presentation) ||
    !vectorIn(value.presentation.rotation, 3, -6.3, 6.3) ||
    !numberIn(value.presentation.scale, 0.25, 2)
  ) {
    throw new Error("Asset program presentation is invalid");
  }

  const parts = value.parts as unknown as FreeformPart[];
  const partIds = new Set<string>();
  let totalNodes = 0;
  parts.forEach((part, partIndex) => {
    if (!isRecord(part) || typeof part.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(part.id)) {
      throw new Error(`Part ${partIndex} has an invalid id`);
    }
    if (partIds.has(part.id)) throw new Error(`Asset program repeats part id ${part.id}`);
    partIds.add(part.id);
    if (
      typeof part.name !== "string" ||
      part.name.length < 1 ||
      part.name.length > 48 ||
      !integerIn(part.materialIndex, 0, materials.length - 1) ||
      typeof part.rootNodeId !== "string" ||
      !Array.isArray(part.nodes) ||
      part.nodes.length < 1 ||
      part.nodes.length > 32 ||
      !isRecord(part.attachment)
    ) {
      throw new Error(`Part ${partIndex} is malformed`);
    }
    totalNodes += part.nodes.length;
    validatePartGraph(part, partIndex);
    const attachment = part.attachment;
    if (
      typeof attachment.parentPartId !== "string" ||
      !vectorIn(
        attachment.offset,
        3,
        -MAX_FREEFORM_ATTACHMENT_OFFSET,
        MAX_FREEFORM_ATTACHMENT_OFFSET,
      ) ||
      !vectorIn(attachment.rotation, 3, -6.3, 6.3) ||
      !vectorIn(attachment.scale, 3, 0.05, 4)
    ) {
      throw new Error(`Part ${partIndex} attachment is invalid`);
    }
    validateAnchor(attachment.parentAnchor, `Part ${partIndex} parent anchor`);
    validateAnchor(attachment.selfAnchor, `Part ${partIndex} self anchor`);
  });
  if (totalNodes > MAX_FREEFORM_NODES) throw new Error(`Asset program exceeds ${MAX_FREEFORM_NODES} shape nodes`);

  const roots = parts.filter(({ attachment }) => attachment.parentPartId === "");
  if (roots.length !== 1) throw new Error("Asset program must contain exactly one root part");
  parts.forEach((part, partIndex) => {
    if (part.attachment.parentPartId && !partIds.has(part.attachment.parentPartId)) {
      throw new Error(`Part ${partIndex} references a missing parent part`);
    }
    if (part.attachment.parentPartId === part.id) throw new Error(`Part ${partIndex} cannot attach to itself`);
  });

  const parentById = new Map(parts.map((part) => [part.id, part.attachment.parentPartId]));
  parts.forEach((part) => {
    const seen = new Set<string>();
    let current = part.id;
    while (current) {
      if (seen.has(current)) throw new Error(`Part attachment graph contains a cycle at ${current}`);
      seen.add(current);
      current = parentById.get(current) ?? "";
    }
  });
  if (value.surfaceDetailMode === "decal") {
    parts
      .filter(({ attachment }) => attachment.parentPartId !== "")
      .forEach((part, index) => {
        const { parentAnchor, selfAnchor } = part.attachment;
        if (
          parentAnchor.kind !== "surface" ||
          (selfAnchor.kind !== "front" && selfAnchor.kind !== "back") ||
          part.nodes.some(({ op }) => op !== "extrude")
        ) {
          throw new Error(`Decal part ${index} must be a surface-attached extrusion`);
        }
      });
  }
  return value as unknown as FreeformAssetProgram;
}
