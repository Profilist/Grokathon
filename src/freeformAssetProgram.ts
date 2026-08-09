import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import {
  MAX_FREEFORM_TRIANGLES,
  validateFreeformAssetProgram,
  type FreeformAnchor,
  type FreeformAssetProgram,
  type FreeformPart,
  type FreeformShapeNode,
  type Vec2,
  type Vec3,
} from "./freeformAssetSchema";

export * from "./freeformAssetSchema";

type SdfEvaluator = (x: number, y: number, z: number) => number;

function transformEvaluator(node: FreeformShapeNode, evaluator: SdfEvaluator): SdfEvaluator {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...node.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...node.rotation)),
    new THREE.Vector3(...node.scale),
  );
  const inverse = matrix.clone().invert().elements;
  const distanceScale = Math.min(...node.scale);
  return (x, y, z) => {
    const localX = inverse[0] * x + inverse[4] * y + inverse[8] * z + inverse[12];
    const localY = inverse[1] * x + inverse[5] * y + inverse[9] * z + inverse[13];
    const localZ = inverse[2] * x + inverse[6] * y + inverse[10] * z + inverse[14];
    return evaluator(localX, localY, localZ) * distanceScale;
  };
}

function boxSdf(x: number, y: number, z: number, size: Vec3, roundness: number) {
  const halfX = Math.max(0.001, size[0] * 0.5 - roundness);
  const halfY = Math.max(0.001, size[1] * 0.5 - roundness);
  const halfZ = Math.max(0.001, size[2] * 0.5 - roundness);
  const qx = Math.abs(x) - halfX;
  const qy = Math.abs(y) - halfY;
  const qz = Math.abs(z) - halfZ;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) +
    Math.min(Math.max(qx, qy, qz), 0) -
    roundness
  );
}

function polygonSdf(x: number, y: number, polygon: Vec2[]) {
  let minimumDistanceSquared = Number.POSITIVE_INFINITY;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [ax, ay] = polygon[previous]!;
    const [bx, by] = polygon[index]!;
    const edgeX = bx - ax;
    const edgeY = by - ay;
    const pointX = x - ax;
    const pointY = y - ay;
    const denominator = edgeX * edgeX + edgeY * edgeY;
    const projection = denominator > 0 ? Math.max(0, Math.min(1, (pointX * edgeX + pointY * edgeY) / denominator)) : 0;
    const dx = pointX - edgeX * projection;
    const dy = pointY - edgeY * projection;
    minimumDistanceSquared = Math.min(minimumDistanceSquared, dx * dx + dy * dy);
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return Math.sqrt(minimumDistanceSquared) * (inside ? -1 : 1);
}

function sweepSdf(x: number, y: number, z: number, points: Vec3[], radii: number[]) {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const edgeX = end[0] - start[0];
    const edgeY = end[1] - start[1];
    const edgeZ = end[2] - start[2];
    const pointX = x - start[0];
    const pointY = y - start[1];
    const pointZ = z - start[2];
    const denominator = edgeX * edgeX + edgeY * edgeY + edgeZ * edgeZ;
    const projection = denominator > 0
      ? Math.max(0, Math.min(1, (pointX * edgeX + pointY * edgeY + pointZ * edgeZ) / denominator))
      : 0;
    const dx = pointX - edgeX * projection;
    const dy = pointY - edgeY * projection;
    const dz = pointZ - edgeZ * projection;
    const radius = THREE.MathUtils.lerp(radii[index]!, radii[index + 1]!, projection);
    distance = Math.min(distance, Math.hypot(dx, dy, dz) - radius);
  }
  return distance;
}

function smoothMinimum(left: number, right: number, smoothness: number) {
  const blend = Math.max(smoothness - Math.abs(left - right), 0) / smoothness;
  return Math.min(left, right) - (blend * blend * smoothness) / 4;
}

function createShapeEvaluator(part: FreeformPart) {
  const nodes = new Map(part.nodes.map((node) => [node.id, node]));
  const evaluators = new Map<string, SdfEvaluator>();
  const create = (id: string): SdfEvaluator => {
    const existing = evaluators.get(id);
    if (existing) return existing;
    const node = nodes.get(id)!;
    const inputs = node.inputs.map(create);
    let local: SdfEvaluator;
    switch (node.op) {
      case "sphere":
        local = (x, y, z) => Math.hypot(x, y, z) - node.radius;
        break;
      case "box":
        local = (x, y, z) => boxSdf(x, y, z, node.size, Math.min(node.roundness, Math.min(...node.size) * 0.49));
        break;
      case "capsule":
      case "sweep":
        local = (x, y, z) => sweepSdf(x, y, z, node.points, node.radii);
        break;
      case "torus":
        local = (x, y, z) => Math.hypot(Math.hypot(x, z) - node.radius, y) - node.tube;
        break;
      case "cylinder":
        local = (x, y, z) => {
          const radial = Math.hypot(x, z) - node.radius;
          const vertical = Math.abs(y) - node.height * 0.5;
          return Math.hypot(Math.max(radial, 0), Math.max(vertical, 0)) + Math.min(Math.max(radial, vertical), 0);
        };
        break;
      case "cone":
        local = (x, y, z) => {
          const halfHeight = node.height * 0.5;
          const ratio = Math.max(0, Math.min(1, (y + halfHeight) / node.height));
          const localRadius = THREE.MathUtils.lerp(node.radiusBottom, node.radiusTop, ratio);
          return Math.max(Math.hypot(x, z) - localRadius, Math.abs(y) - halfHeight);
        };
        break;
      case "extrude":
        local = (x, y, z) => {
          const planar = polygonSdf(x, y, node.polygon);
          const depth = Math.abs(z) - node.height * 0.5;
          return Math.hypot(Math.max(planar, 0), Math.max(depth, 0)) + Math.min(Math.max(planar, depth), 0);
        };
        break;
      case "lathe":
        local = (x, y, z) => polygonSdf(Math.hypot(x, z), y, node.profile);
        break;
      case "union":
        local = (x, y, z) => inputs.reduce((distance, input) => Math.min(distance, input(x, y, z)), Number.POSITIVE_INFINITY);
        break;
      case "smoothUnion":
        local = (x, y, z) => {
          let distance = inputs[0]!(x, y, z);
          for (let index = 1; index < inputs.length; index += 1) {
            distance = smoothMinimum(distance, inputs[index]!(x, y, z), node.smoothness);
          }
          return distance;
        };
        break;
      case "subtract":
        local = (x, y, z) => Math.max(inputs[0]!(x, y, z), -inputs[1]!(x, y, z));
        break;
      case "intersect":
        local = (x, y, z) => inputs.reduce((distance, input) => Math.max(distance, input(x, y, z)), Number.NEGATIVE_INFINITY);
        break;
      case "twist":
        local = (x, y, z) => {
          const angle = -node.amount * y;
          const cosine = Math.cos(angle);
          const sine = Math.sin(angle);
          return inputs[0]!(x * cosine - z * sine, y, x * sine + z * cosine);
        };
        break;
      case "bend":
        local = (x, y, z) => {
          const angle = -node.amount * y;
          const cosine = Math.cos(angle);
          const sine = Math.sin(angle);
          return inputs[0]!(x * cosine - y * sine, x * sine + y * cosine, z);
        };
        break;
      case "noise":
        local = (x, y, z) => {
          const wave =
            Math.sin(x * node.frequency + Math.sin(z * node.frequency * 0.73)) *
            Math.sin(y * node.frequency * 1.17 + z * node.frequency * 0.41);
          return inputs[0]!(x, y, z) + wave * node.amount * 0.08;
        };
        break;
    }
    const transformed = transformEvaluator(node, local);
    evaluators.set(id, transformed);
    return transformed;
  };
  return create(part.rootNodeId);
}

function boundsFromPoints(points: Array<Vec2 | Vec3>, radius = 0) {
  const bounds = new THREE.Box3();
  points.forEach((point) => bounds.expandByPoint(new THREE.Vector3(point[0], point[1], point[2] ?? 0)));
  return bounds.expandByScalar(radius);
}

function transformedBounds(node: FreeformShapeNode, bounds: THREE.Box3) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...node.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...node.rotation)),
    new THREE.Vector3(...node.scale),
  );
  return bounds.applyMatrix4(matrix);
}

function createShapeBounds(part: FreeformPart) {
  const nodes = new Map(part.nodes.map((node) => [node.id, node]));
  const boundsById = new Map<string, THREE.Box3>();
  const create = (id: string): THREE.Box3 => {
    const existing = boundsById.get(id);
    if (existing) return existing.clone();
    const node = nodes.get(id)!;
    const inputBounds = node.inputs.map(create);
    let bounds: THREE.Box3;
    switch (node.op) {
      case "sphere":
        bounds = new THREE.Box3(
          new THREE.Vector3(-node.radius, -node.radius, -node.radius),
          new THREE.Vector3(node.radius, node.radius, node.radius),
        );
        break;
      case "box":
        bounds = new THREE.Box3(
          new THREE.Vector3(-node.size[0] / 2, -node.size[1] / 2, -node.size[2] / 2),
          new THREE.Vector3(node.size[0] / 2, node.size[1] / 2, node.size[2] / 2),
        );
        break;
      case "capsule":
      case "sweep":
        bounds = boundsFromPoints(node.points, Math.max(...node.radii));
        break;
      case "torus": {
        const radial = node.radius + node.tube;
        bounds = new THREE.Box3(
          new THREE.Vector3(-radial, -node.tube, -radial),
          new THREE.Vector3(radial, node.tube, radial),
        );
        break;
      }
      case "cylinder":
      case "cone": {
        const radial = node.op === "cylinder" ? node.radius : Math.max(node.radiusTop, node.radiusBottom);
        bounds = new THREE.Box3(
          new THREE.Vector3(-radial, -node.height / 2, -radial),
          new THREE.Vector3(radial, node.height / 2, radial),
        );
        break;
      }
      case "extrude": {
        bounds = boundsFromPoints(node.polygon);
        bounds.min.z = -node.height / 2;
        bounds.max.z = node.height / 2;
        break;
      }
      case "lathe": {
        const radial = Math.max(...node.profile.map(([value]) => value));
        const ys = node.profile.map(([, value]) => value);
        bounds = new THREE.Box3(
          new THREE.Vector3(-radial, Math.min(...ys), -radial),
          new THREE.Vector3(radial, Math.max(...ys), radial),
        );
        break;
      }
      case "union":
      case "smoothUnion":
        bounds = inputBounds[0]!.clone();
        inputBounds.slice(1).forEach((input) => bounds.union(input));
        if (node.op === "smoothUnion") bounds.expandByScalar(node.smoothness);
        break;
      case "subtract":
        bounds = inputBounds[0]!.clone();
        break;
      case "intersect":
        bounds = inputBounds[0]!.clone();
        inputBounds.slice(1).forEach((input) => bounds.intersect(input));
        break;
      case "twist":
        bounds = inputBounds[0]!.clone();
        bounds.expandByScalar(bounds.getSize(new THREE.Vector3()).length() * 0.15);
        break;
      case "bend":
        bounds = inputBounds[0]!.clone();
        bounds.expandByScalar(Math.abs(node.amount) * bounds.getSize(new THREE.Vector3()).y * 0.3);
        break;
      case "noise":
        bounds = inputBounds[0]!.clone().expandByScalar(Math.abs(node.amount) * 0.1);
        break;
    }
    if (bounds.isEmpty()) throw new Error(`Part ${part.id} node ${node.id} produced empty bounds`);
    const transformed = transformedBounds(node, bounds);
    boundsById.set(id, transformed.clone());
    return transformed;
  };
  return create(part.rootNodeId);
}

const TETRAHEDRA = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
] as const;

const CUBE_CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
] as const;

interface SamplePoint {
  value: number;
  x: number;
  y: number;
  z: number;
}

function interpolateSurface(left: SamplePoint, right: SamplePoint): Vec3 {
  const denominator = left.value - right.value;
  const ratio = Math.abs(denominator) < 1e-8 ? 0.5 : left.value / denominator;
  return [
    THREE.MathUtils.lerp(left.x, right.x, ratio),
    THREE.MathUtils.lerp(left.y, right.y, ratio),
    THREE.MathUtils.lerp(left.z, right.z, ratio),
  ];
}

function pushOrientedTriangle(positions: number[], triangle: [Vec3, Vec3, Vec3], sdf: SdfEvaluator, epsilon: number) {
  const [a, b, c] = triangle;
  const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const normal = ab.cross(ac);
  const centerX = (a[0] + b[0] + c[0]) / 3;
  const centerY = (a[1] + b[1] + c[1]) / 3;
  const centerZ = (a[2] + b[2] + c[2]) / 3;
  const gradient = new THREE.Vector3(
    sdf(centerX + epsilon, centerY, centerZ) - sdf(centerX - epsilon, centerY, centerZ),
    sdf(centerX, centerY + epsilon, centerZ) - sdf(centerX, centerY - epsilon, centerZ),
    sdf(centerX, centerY, centerZ + epsilon) - sdf(centerX, centerY, centerZ - epsilon),
  );
  if (normal.dot(gradient) < 0) [triangle[1], triangle[2]] = [triangle[2], triangle[1]];
  triangle.forEach((point) => positions.push(...point));
}

function polygonizeTetrahedron(points: SamplePoint[], positions: number[], sdf: SdfEvaluator, epsilon: number) {
  const inside = points.map((point) => point.value <= 0);
  const insideIndices = inside.map((value, index) => (value ? index : -1)).filter((index) => index >= 0);
  const outsideIndices = inside.map((value, index) => (!value ? index : -1)).filter((index) => index >= 0);
  if (insideIndices.length === 0 || insideIndices.length === 4) return;

  if (insideIndices.length === 1 || insideIndices.length === 3) {
    const singleInside = insideIndices.length === 1;
    const sourceIndex = (singleInside ? insideIndices : outsideIndices)[0]!;
    const targets = singleInside ? outsideIndices : insideIndices;
    const triangle = targets.map((target) => interpolateSurface(points[sourceIndex]!, points[target]!)) as [Vec3, Vec3, Vec3];
    pushOrientedTriangle(positions, triangle, sdf, epsilon);
    return;
  }

  const [insideA, insideB] = insideIndices;
  const [outsideA, outsideB] = outsideIndices;
  const a = interpolateSurface(points[insideA!]!, points[outsideA!]!);
  const b = interpolateSurface(points[insideA!]!, points[outsideB!]!);
  const c = interpolateSurface(points[insideB!]!, points[outsideA!]!);
  const d = interpolateSurface(points[insideB!]!, points[outsideB!]!);
  pushOrientedTriangle(positions, [a, b, c], sdf, epsilon);
  pushOrientedTriangle(positions, [b, d, c], sdf, epsilon);
}

function usesSphericalUv(part: FreeformPart) {
  const sourceNodes = part.nodes.filter(({ op }) =>
    ["sphere", "box", "capsule", "torus", "cylinder", "cone", "sweep", "extrude", "lathe"].includes(op),
  );
  return sourceNodes.length === 1 && sourceNodes[0]!.op === "sphere";
}

function createSdfGeometry(part: FreeformPart, resolution: number) {
  const sdf = createShapeEvaluator(part);
  const bounds = createShapeBounds(part).expandByScalar(0.08);
  const size = bounds.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  const countX = Math.max(8, Math.round((resolution * size.x) / longest));
  const countY = Math.max(8, Math.round((resolution * size.y) / longest));
  const countZ = Math.max(8, Math.round((resolution * size.z) / longest));
  const stepX = size.x / (countX - 1);
  const stepY = size.y / (countY - 1);
  const stepZ = size.z / (countZ - 1);
  const sampleCount = countX * countY * countZ;
  const field = new Float32Array(sampleCount);
  const sampleIndex = (x: number, y: number, z: number) => x + countX * (y + countY * z);

  for (let z = 0; z < countZ; z += 1) {
    const worldZ = bounds.min.z + z * stepZ;
    for (let y = 0; y < countY; y += 1) {
      const worldY = bounds.min.y + y * stepY;
      for (let x = 0; x < countX; x += 1) {
        const worldX = bounds.min.x + x * stepX;
        field[sampleIndex(x, y, z)] = sdf(worldX, worldY, worldZ);
      }
    }
  }

  const positions: number[] = [];
  const epsilon = Math.min(stepX, stepY, stepZ) * 0.35;
  for (let z = 0; z < countZ - 1; z += 1) {
    for (let y = 0; y < countY - 1; y += 1) {
      for (let x = 0; x < countX - 1; x += 1) {
        const corners = CUBE_CORNERS.map(([dx, dy, dz]) => {
          const pointX = x + dx;
          const pointY = y + dy;
          const pointZ = z + dz;
          return {
            value: field[sampleIndex(pointX, pointY, pointZ)]!,
            x: bounds.min.x + pointX * stepX,
            y: bounds.min.y + pointY * stepY,
            z: bounds.min.z + pointZ * stepZ,
          } satisfies SamplePoint;
        });
        TETRAHEDRA.forEach((tetrahedron) => {
          polygonizeTetrahedron(tetrahedron.map((index) => corners[index]!), positions, sdf, epsilon);
        });
      }
    }
  }
  if (positions.length === 0) throw new Error(`Part ${part.id} generated no surface; check its SDF operations`);

  const raw = new THREE.BufferGeometry();
  raw.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  let geometry = mergeVertices(raw, 1e-4);
  raw.dispose();
  if (countGeometryComponents(geometry) !== 1) {
    geometry.dispose();
    throw new Error(`Part ${part.id} contains disconnected geometry; use one connected shape per part`);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const sphericalUv = usesSphericalUv(part);
  if (sphericalUv && geometry.index) {
    const nonIndexed = geometry.toNonIndexed();
    geometry.dispose();
    geometry = nonIndexed;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const uv = new Float32Array(position.count * 2);
  const geometryBounds = geometry.boundingBox!;
  const geometryCenter = geometryBounds.getCenter(new THREE.Vector3());
  const geometrySize = geometryBounds.getSize(new THREE.Vector3());
  for (let index = 0; index < position.count; index += 1) {
    if (sphericalUv) {
      const normalizedX = (position.getX(index) - geometryCenter.x) / Math.max(geometrySize.x * 0.5, 1e-6);
      const normalizedY = (position.getY(index) - geometryCenter.y) / Math.max(geometrySize.y * 0.5, 1e-6);
      const normalizedZ = (position.getZ(index) - geometryCenter.z) / Math.max(geometrySize.z * 0.5, 1e-6);
      uv[index * 2] = 0.5 + Math.atan2(normalizedZ, normalizedX) / (Math.PI * 2);
      uv[index * 2 + 1] = 0.5 - Math.asin(THREE.MathUtils.clamp(normalizedY, -1, 1)) / Math.PI;
    } else {
      uv[index * 2] = (position.getX(index) - geometryBounds.min.x) / Math.max(geometrySize.x, 1e-6);
      uv[index * 2 + 1] = (position.getY(index) - geometryBounds.min.y) / Math.max(geometrySize.y, 1e-6);
    }
  }
  if (sphericalUv) {
    for (let index = 0; index < position.count; index += 3) {
      const u0 = uv[index * 2]!;
      const u1 = uv[(index + 1) * 2]!;
      const u2 = uv[(index + 2) * 2]!;
      if (Math.max(u0, u1, u2) - Math.min(u0, u1, u2) > 0.5) {
        if (u0 < 0.5) uv[index * 2] = u0 + 1;
        if (u1 < 0.5) uv[(index + 1) * 2] = u1 + 1;
        if (u2 < 0.5) uv[(index + 2) * 2] = u2 + 1;
      }
    }
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.translate(-geometryCenter.x, -geometryCenter.y, -geometryCenter.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function countGeometryComponents(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute("position");
  const index = geometry.index;
  if (!index || positions.count === 0) return positions.count === 0 ? 0 : 1;
  const parent = new Int32Array(positions.count);
  for (let vertex = 0; vertex < parent.length; vertex += 1) parent[vertex] = vertex;
  const find = (vertex: number): number => {
    let root = vertex;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[vertex] !== vertex) {
      const next = parent[vertex]!;
      parent[vertex] = root;
      vertex = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  for (let offset = 0; offset < index.count; offset += 3) {
    const a = index.getX(offset);
    const b = index.getX(offset + 1);
    const c = index.getX(offset + 2);
    union(a, b);
    union(b, c);
  }
  const roots = new Set<number>();
  for (let vertex = 0; vertex < positions.count; vertex += 1) roots.add(find(vertex));
  return roots.size;
}

function anchorPoint(bounds: THREE.Box3, anchor: FreeformAnchor) {
  const center = bounds.getCenter(new THREE.Vector3());
  switch (anchor.kind) {
    case "center":
      return center;
    case "top":
      return new THREE.Vector3(center.x, bounds.max.y, center.z);
    case "bottom":
      return new THREE.Vector3(center.x, bounds.min.y, center.z);
    case "left":
      return new THREE.Vector3(bounds.min.x, center.y, center.z);
    case "right":
      return new THREE.Vector3(bounds.max.x, center.y, center.z);
    case "front":
      return new THREE.Vector3(center.x, center.y, bounds.max.z);
    case "back":
      return new THREE.Vector3(center.x, center.y, bounds.min.z);
    case "surface": {
      const direction = new THREE.Vector3(...anchor.direction).normalize();
      const half = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const candidates = [
        Math.abs(direction.x) > 1e-6 ? half.x / Math.abs(direction.x) : Number.POSITIVE_INFINITY,
        Math.abs(direction.y) > 1e-6 ? half.y / Math.abs(direction.y) : Number.POSITIVE_INFINITY,
        Math.abs(direction.z) > 1e-6 ? half.z / Math.abs(direction.z) : Number.POSITIVE_INFINITY,
      ];
      return center.addScaledVector(direction, Math.min(...candidates));
    }
  }
}

function anchorNormal(anchor: FreeformAnchor) {
  switch (anchor.kind) {
    case "top":
      return new THREE.Vector3(0, 1, 0);
    case "bottom":
      return new THREE.Vector3(0, -1, 0);
    case "left":
      return new THREE.Vector3(-1, 0, 0);
    case "right":
      return new THREE.Vector3(1, 0, 0);
    case "front":
      return new THREE.Vector3(0, 0, 1);
    case "back":
      return new THREE.Vector3(0, 0, -1);
    case "surface":
      return new THREE.Vector3(...anchor.direction).normalize();
    case "center":
      return null;
  }
}

function boxSeparation(left: THREE.Box3, right: THREE.Box3) {
  const gapX = Math.max(0, left.min.x - right.max.x, right.min.x - left.max.x);
  const gapY = Math.max(0, left.min.y - right.max.y, right.min.y - left.max.y);
  const gapZ = Math.max(0, left.min.z - right.max.z, right.min.z - left.max.z);
  return Math.hypot(gapX, gapY, gapZ);
}

export interface BuiltFreeformAsset {
  group: THREE.Group;
  triangles: number;
}

export function buildFreeformAsset(
  input: FreeformAssetProgram,
  texture: THREE.Texture | null = null,
): BuiltFreeformAsset {
  const program = validateFreeformAssetProgram(input);
  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = program.surfaceDetailMode === "texture" ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    texture.repeat.set(program.surfaceDetailMode === "texture" ? 1 : 2, program.surfaceDetailMode === "texture" ? 1 : 2);
  }
  const materials = program.materials.map(
    (material, materialIndex) =>
      new THREE.MeshStandardMaterial({
        color: material.color,
        emissive: material.emissive,
        emissiveIntensity: material.emissiveIntensity,
        flatShading: material.flatShading,
        map: materialIndex === program.textureMaterialIndex ? texture : null,
        metalness: material.metalness,
        opacity: material.opacity,
        roughness: material.roughness,
        side: THREE.DoubleSide,
        transparent: material.opacity < 1,
      }),
  );

  const group = new THREE.Group();
  group.name = program.name;
  group.userData.freeformAssetProgram = program;
  const meshes = new Map<string, THREE.Mesh>();
  let triangles = 0;
  try {
    program.parts.forEach((part) => {
      const geometry = createSdfGeometry(part, program.quality.resolution);
      triangles += geometry.index ? geometry.index.count / 3 : geometry.getAttribute("position").count / 3;
      const mesh = new THREE.Mesh(geometry, materials[part.materialIndex]);
      mesh.name = part.name;
      meshes.set(part.id, mesh);
      group.add(mesh);
    });

    const remaining = new Set(program.parts.map(({ id }) => id));
    while (remaining.size > 0) {
      let placed = false;
      for (const part of program.parts) {
        if (!remaining.has(part.id)) continue;
        const parentId = part.attachment.parentPartId;
        if (parentId && remaining.has(parentId)) continue;
        const mesh = meshes.get(part.id)!;
        const attachment = part.attachment;
        mesh.rotation.fromArray(attachment.rotation);
        mesh.scale.fromArray(attachment.scale);
        if (!parentId) {
          mesh.position.fromArray(attachment.offset);
        } else {
          const parent = meshes.get(parentId)!;
          parent.updateMatrix();
          let parentSurfaceNormal: THREE.Vector3 | null = null;
          if (attachment.parentAnchor.kind === "surface") {
            const parentNormal = anchorNormal(attachment.parentAnchor)!;
            parentSurfaceNormal = parentNormal;
            const selfNormal = anchorNormal(attachment.selfAnchor);
            if (selfNormal) {
              const alignment = new THREE.Quaternion().setFromUnitVectors(
                selfNormal,
                parentNormal.clone().negate(),
              );
              mesh.quaternion.premultiply(alignment);
            }
            const parentSize = parent.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(parent.scale);
            const childSize = mesh.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(mesh.scale);
            const parentLongest = Math.max(parentSize.x, parentSize.y, parentSize.z);
            const childLongest = Math.max(childSize.x, childSize.y, childSize.z);
            const maximumChildSize = parentLongest * (program.surfaceDetailMode === "decal" ? 0.35 : 0.5);
            if (childLongest > maximumChildSize) mesh.scale.multiplyScalar(maximumChildSize / childLongest);
          }
          mesh.quaternion.premultiply(parent.quaternion);
          mesh.scale.multiply(parent.scale);
          const parentTarget = anchorPoint(parent.geometry.boundingBox!, attachment.parentAnchor)
            .multiply(parent.scale)
            .applyQuaternion(parent.quaternion)
            .add(parent.position);
          const parentOffset = new THREE.Vector3(...attachment.offset);
          if (parentSurfaceNormal) {
            parentOffset.addScaledVector(parentSurfaceNormal, -parentOffset.dot(parentSurfaceNormal));
          }
          parentOffset
            .clampLength(0, Math.max(...parent.geometry.boundingBox!.getSize(new THREE.Vector3()).toArray()) * 0.2)
            .multiply(parent.scale)
            .applyQuaternion(parent.quaternion);
          const selfOffset = anchorPoint(mesh.geometry.boundingBox!, attachment.selfAnchor)
            .multiply(mesh.scale)
            .applyQuaternion(mesh.quaternion);
          mesh.position.copy(parentTarget).add(parentOffset).sub(selfOffset);
        }
        mesh.updateMatrix();
        remaining.delete(part.id);
        placed = true;
      }
      if (!placed) throw new Error("Could not resolve the part attachment graph");
    }

    group.updateMatrixWorld(true);
    program.parts.forEach((part) => {
      const parentId = part.attachment.parentPartId;
      if (!parentId || part.attachment.parentAnchor.kind !== "surface") return;
      const mesh = meshes.get(part.id)!;
      const localSize = mesh.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(mesh.scale);
      const longest = Math.max(localSize.x, localSize.y, localSize.z);
      const shortest = Math.min(localSize.x, localSize.y, localSize.z);
      if (shortest / Math.max(longest, 1e-6) >= 0.18) return;
      const parent = meshes.get(parentId)!;
      const parentBounds = new THREE.Box3().setFromObject(parent);
      const childBounds = new THREE.Box3().setFromObject(mesh);
      const parentLongest = Math.max(...parentBounds.getSize(new THREE.Vector3()).toArray());
      if (boxSeparation(parentBounds, childBounds) > parentLongest * 0.04) {
        throw new Error(`Surface detail part ${part.id} floats beyond the allowed tolerance`);
      }
    });
    const bounds = new THREE.Box3().setFromObject(group);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(longest) || longest <= 0) throw new Error("Generated asset bounds are invalid");
    group.children.forEach((child) => child.position.sub(center));
    group.rotation.fromArray(program.presentation.rotation);
    group.scale.setScalar((2.4 / longest) * program.presentation.scale);
    if (triangles > MAX_FREEFORM_TRIANGLES) {
      throw new Error(`Generated asset has ${Math.round(triangles)} triangles; limit is ${MAX_FREEFORM_TRIANGLES}`);
    }
    return { group, triangles: Math.round(triangles) };
  } catch (error) {
    disposeFreeformAsset(group);
    throw error;
  }
}

export function disposeFreeformAsset(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    meshMaterials.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
