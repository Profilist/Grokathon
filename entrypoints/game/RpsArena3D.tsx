import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  buildFreeformAsset,
} from "../../src/freeformAssetProgram";
import type { RenderableRpsAsset } from "../../src/generatedRpsAssets";
import type { GameWinner, RpsMove } from "../../src/lobby";
import { ArenaBackdrop } from "./ArenaBackdrop";

type ArenaPhase = "selecting" | "waiting" | "spectating" | "complete";
type ResultSlot = "host" | "guest";

interface ResultDisplay {
  handle: string | null;
  text: string;
}

interface RpsArena3DProps {
  guestHandle: string;
  guestLocked: boolean;
  guestMove: RpsMove | null;
  guestResultAsset?: RenderableRpsAsset | null;
  hostHandle: string;
  hostLocked: boolean;
  hostMove: RpsMove | null;
  hostResultAsset?: RenderableRpsAsset | null;
  isSubmitting: boolean;
  phase: ArenaPhase;
  result: ResultDisplay | null;
  selectedMove: RpsMove | null;
  selectionAssets?: Partial<Record<RpsMove, RenderableRpsAsset>>;
  wagerAmount: number;
  winner: GameWinner | null;
}

interface LiveArenaState {
  guestMove: RpsMove | null;
  hostMove: RpsMove | null;
  phase: ArenaPhase;
  selectedMove: RpsMove | null;
  winner: GameWinner | null;
}

interface ObjectSwap {
  from: THREE.Group;
  startedAt: number;
  to: THREE.Group;
}

interface ArenaRuntime {
  disposed: boolean;
  guestResult: THREE.Group | null;
  guestResultKey: string | null;
  hostResult: THREE.Group | null;
  hostResultKey: string | null;
  resultSpacing: number;
  scene: THREE.Scene;
  selection: Record<RpsMove, THREE.Group>;
  selectionKeys: Record<RpsMove, string>;
  selectionSpacing: number;
  swaps: ObjectSwap[];
}

const MOVES: RpsMove[] = ["rock", "paper", "scissors"];
const SWAP_DURATION_MS = 280;

const MOVE_META: Record<RpsMove, { color: number; label: string }> = {
  rock: { color: 0x777a7d, label: "Rock" },
  paper: { color: 0x53d8ff, label: "Paper" },
  scissors: { color: 0xff4fc8, label: "Scissors" },
};

function tagMove(group: THREE.Group, move: RpsMove) {
  group.userData.move = move;
  group.traverse((object) => {
    object.userData.move = move;
  });
  return group;
}

function createRock() {
  const group = new THREE.Group();
  let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(0.48, 2);
  if (geometry.index) {
    const nonIndexed = geometry.toNonIndexed();
    geometry.dispose();
    geometry = nonIndexed;
  }
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const coarseNoise = Math.sin(x * 9.7 + y * 5.3 - z * 7.1) * 0.13;
    const fineNoise = Math.sin(x * 21.1 - y * 13.7 + z * 17.3) * 0.055;
    const variation = 1 + coarseNoise + fineNoise;
    positions.setXYZ(
      index,
      x * variation * 1.1 + y * 0.045,
      y * variation * 0.78,
      z * variation * 0.9,
    );
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  for (let index = 0; index < positions.count; index += 3) {
    const normalY = (normals.getY(index) + normals.getY(index + 1) + normals.getY(index + 2)) / 3;
    const normalZ = (normals.getZ(index) + normals.getZ(index + 1) + normals.getZ(index + 2)) / 3;
    const shade = 0.18 + Math.max(normalY, 0) * 0.13 + Math.max(normalZ, 0) * 0.05;
    for (let vertex = index; vertex < index + 3; vertex += 1) {
      colors[vertex * 3] = shade * 0.98;
      colors[vertex * 3 + 1] = shade;
      colors[vertex * 3 + 2] = shade * 0.97;
    }
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
  });
  const rock = new THREE.Mesh(geometry, material);
  rock.rotation.set(0.18, 0.38, -0.08);
  group.add(rock);
  return tagMove(group, "rock");
}

function createPaper() {
  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(0.92, 0.72, 12, 10);
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    positions.setZ(index, Math.sin((x + 0.45) * 4.6) * 0.075 + Math.cos(y * 4.1) * 0.025);
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xdff9ff,
    emissive: 0x126c8e,
    emissiveIntensity: 0.7,
    metalness: 0.08,
    roughness: 0.24,
    side: THREE.DoubleSide,
  });
  const paper = new THREE.Mesh(geometry, material);
  paper.rotation.set(-0.12, -0.22, 0.08);
  group.add(paper);
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 22),
    new THREE.LineBasicMaterial({ color: MOVE_META.paper.color, transparent: true, opacity: 0.8 }),
  );
  edge.rotation.copy(paper.rotation);
  group.add(edge);
  return tagMove(group, "paper");
}

function createScissors() {
  const group = new THREE.Group();
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: 0xf4f7ff,
    emissive: 0x672050,
    emissiveIntensity: 0.65,
    metalness: 0.92,
    roughness: 0.18,
  });
  const handleMaterial = new THREE.MeshStandardMaterial({
    color: MOVE_META.scissors.color,
    emissive: 0x781848,
    emissiveIntensity: 0.95,
    metalness: 0.35,
    roughness: 0.3,
  });
  [-1, 1].forEach((direction) => {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.82, 0.075), bladeMaterial);
    blade.position.set(direction * 0.14, 0.18, 0);
    blade.rotation.z = direction * -0.34;
    group.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.28, 12), bladeMaterial);
    tip.position.set(direction * 0.28, 0.56, 0);
    tip.rotation.z = direction * -0.34;
    group.add(tip);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.052, 12, 28), handleMaterial);
    handle.position.set(direction * 0.2, -0.34, 0);
    group.add(handle);
  });
  const pivot = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 18, 18),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: MOVE_META.scissors.color,
      emissiveIntensity: 1.2,
      metalness: 0.8,
      roughness: 0.2,
    }),
  );
  pivot.position.y = -0.02;
  group.add(pivot);
  group.rotation.z = -0.04;
  return tagMove(group, "scissors");
}

function createDefaultMove(move: RpsMove) {
  if (move === "rock") return createRock();
  if (move === "paper") return createPaper();
  return createScissors();
}

async function createMoveObject(move: RpsMove, asset: RenderableRpsAsset | null) {
  if (!asset) return createDefaultMove(move);
  let texture: THREE.Texture | null = null;
  if (asset.textureUrl) {
    try {
      texture = await new THREE.TextureLoader().loadAsync(asset.textureUrl);
    } catch (error) {
      console.warn("Generated RPS texture failed to load; using geometry materials", error);
    }
  }
  try {
    const built = buildFreeformAsset(asset.program, texture);
    built.group.scale.multiplyScalar(0.39);
    const wrapper = new THREE.Group();
    wrapper.name = asset.name;
    wrapper.userData.generatedAssetId = asset.id;
    wrapper.add(built.group);
    return tagMove(wrapper, move);
  } catch (error) {
    texture?.dispose();
    throw error;
  }
}

function materialsOf(object: THREE.Object3D) {
  const materials: THREE.Material[] = [];
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.LineSegments) && !(child instanceof THREE.Points)) {
      return;
    }
    materials.push(...(Array.isArray(child.material) ? child.material : [child.material]));
  });
  return materials;
}

function setGlow(group: THREE.Object3D, intensity: number, opacity = 1) {
  materialsOf(group).forEach((material) => {
    if (typeof material.userData.rpsBaseOpacity !== "number") {
      material.userData.rpsBaseOpacity = material.opacity;
    }
    const baseOpacity = material.userData.rpsBaseOpacity as number;
    const nextOpacity = baseOpacity * opacity;
    material.opacity = nextOpacity;
    material.transparent = nextOpacity < 0.999;
    material.depthWrite = nextOpacity >= 0.999;
    if (material instanceof THREE.MeshStandardMaterial) material.emissiveIntensity = intensity;
  });
}

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set(materialsOf(object));
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Points) {
      geometries.add(child.geometry);
    }
  });
  materials.forEach((material) => {
    Object.values(material).forEach((value) => {
      if (value instanceof THREE.Texture) textures.add(value);
    });
  });
  textures.forEach((texture) => texture.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function disposeScene(scene: THREE.Scene) {
  scene.children.forEach((child) => disposeObject(child));
}

function beginSwap(runtime: ArenaRuntime, from: THREE.Group, to: THREE.Group) {
  const interrupted = runtime.swaps.filter((swap) => swap.to === from);
  interrupted.forEach((swap) => {
    runtime.scene.remove(swap.from);
    disposeObject(swap.from);
  });
  runtime.swaps = runtime.swaps.filter((swap) => swap.to !== from && swap.from !== from);
  setGlow(to, 0.85, 0);
  runtime.scene.add(to);
  runtime.swaps.push({ from, to, startedAt: performance.now() });
}

function removeResult(runtime: ArenaRuntime, slot: ResultSlot) {
  const key = slot === "host" ? "hostResult" : "guestResult";
  const object = runtime[key];
  if (object) {
    runtime.scene.remove(object);
    disposeObject(object);
    runtime[key] = null;
  }
  if (slot === "host") runtime.hostResultKey = null;
  else runtime.guestResultKey = null;
}

export function RpsArena3D({
  guestHandle,
  guestLocked,
  guestMove,
  guestResultAsset = null,
  hostHandle,
  hostLocked,
  hostMove,
  hostResultAsset = null,
  isSubmitting,
  phase,
  result,
  selectedMove,
  selectionAssets = {},
  wagerAmount,
  winner,
}: RpsArena3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<ArenaRuntime | null>(null);
  const liveStateRef = useRef<LiveArenaState>({ guestMove, hostMove, phase, selectedMove, winner });
  const [webglFailed, setWebglFailed] = useState(false);
  liveStateRef.current = { guestMove, hostMove, phase, selectedMove, winner };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        canvas,
        powerPreference: "high-performance",
      });
    } catch {
      setWebglFailed(true);
      return;
    }

    setWebglFailed(false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050712, 0.045);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.set(0, 1.05, 5.1);
    camera.lookAt(0, 0.02, 0);
    scene.add(new THREE.HemisphereLight(0xb7c8ff, 0x130823, 1.65));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.3);
    keyLight.position.set(1.8, 3.2, 4.2);
    scene.add(keyLight);
    const cyanLight = new THREE.PointLight(0x2bdcff, 18, 8, 2);
    cyanLight.position.set(-2.4, 0.8, 1.4);
    scene.add(cyanLight);
    const pinkLight = new THREE.PointLight(0xff3fbd, 16, 8, 2);
    pinkLight.position.set(2.4, 0.4, 1.1);
    scene.add(pinkLight);

    const particlePositions = new Float32Array(120 * 3);
    for (let index = 0; index < particlePositions.length; index += 3) {
      const radius = 1.5 + ((index * 17) % 100) / 70;
      const angle = index * 0.73;
      particlePositions[index] = Math.cos(angle) * radius;
      particlePositions[index + 1] = ((index * 29) % 100) / 55 - 0.55;
      particlePositions[index + 2] = Math.sin(angle) * radius - 0.3;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particles = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({
        color: 0x6fdcff,
        size: 0.018,
        transparent: true,
        opacity: 0.6,
        sizeAttenuation: true,
      }),
    );
    scene.add(particles);

    const selection = Object.fromEntries(
      MOVES.map((move) => [move, createDefaultMove(move)]),
    ) as Record<RpsMove, THREE.Group>;
    MOVES.forEach((move) => scene.add(selection[move]));
    const runtime: ArenaRuntime = {
      disposed: false,
      guestResult: null,
      guestResultKey: null,
      hostResult: null,
      hostResultKey: null,
      resultSpacing: 0.98,
      scene,
      selection,
      selectionKeys: { rock: "default:rock", paper: "default:paper", scissors: "default:scissors" },
      selectionSpacing: 1.08,
      swaps: [],
    };
    runtimeRef.current = runtime;

    let renderedWidth = 0;
    let renderedHeight = 0;
    let renderedPixelRatio = 0;
    const layoutObjects = (aspect: number) => {
      runtime.selectionSpacing = THREE.MathUtils.clamp(aspect * 0.9, 0.6, 1.08);
      MOVES.forEach((move, index) => {
        const object = runtime.selection[move];
        object.userData.baseX = (index - 1) * runtime.selectionSpacing;
      });

      runtime.resultSpacing = THREE.MathUtils.clamp(aspect * 0.82, 0.58, 0.98);
      if (runtime.hostResult) runtime.hostResult.position.x = -runtime.resultSpacing;
      if (runtime.guestResult) runtime.guestResult.position.x = runtime.resultSpacing;
    };
    const resize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      // The game lives inside an X iframe whose CSS dimensions change as the
      // post expands. A 1:1 drawing buffer prevents Chromium from stretching
      // or offsetting the WebGL canvas while that iframe is being resized.
      const pixelRatio = 1;
      if (
        width !== renderedWidth ||
        height !== renderedHeight ||
        pixelRatio !== renderedPixelRatio
      ) {
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        layoutObjects(camera.aspect);
        renderedWidth = width;
        renderedHeight = height;
        renderedPixelRatio = pixelRatio;
      }
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

    renderer.setAnimationLoop((time) => {
      resize();
      const seconds = time * 0.001;
      const state = liveStateRef.current;
      particles.rotation.y = seconds * 0.035;

      MOVES.forEach((move, index) => {
        const object = runtime.selection[move];
        const baseScale = state.phase === "waiting" ? 0.9 : 0.78;
        const visible = state.phase !== "complete" && (state.phase !== "waiting" || move === state.selectedMove);
        object.visible = visible;
        if (!visible) return;
        const baseX = state.phase === "waiting" && move === state.selectedMove
          ? 0
          : (index - 1) * runtime.selectionSpacing;
        const selected = state.selectedMove === move;
        const targetScale = baseScale * (selected ? 1.14 : state.phase === "waiting" ? 1.08 : 1);
        object.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.13);
        object.position.x += (baseX - object.position.x) * 0.18;
        object.position.y = reducedMotion ? -0.02 : -0.02 + Math.sin(seconds * 1.8 + index) * 0.07;
        if (!reducedMotion) object.rotation.y += 0.006 + index * 0.0015;
        setGlow(object, selected ? 1.55 : state.phase === "waiting" ? 1.25 : 0.85, 1);
      });

      const results: Array<[ResultSlot, THREE.Group | null]> = [
        ["host", runtime.hostResult],
        ["guest", runtime.guestResult],
      ];
      results.forEach(([slot, object]) => {
        if (!object) return;
        object.visible = state.phase === "complete";
        const isHost = slot === "host";
        const wins = state.winner === slot;
        const loses = state.winner && state.winner !== "draw" && state.winner !== slot;
        const targetScale = wins ? 0.92 : 0.78;
        object.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.08);
        object.position.x = isHost ? -runtime.resultSpacing : runtime.resultSpacing;
        object.position.y = reducedMotion ? -0.01 : Math.sin(seconds * 2 + (isHost ? 0 : 1.2)) * 0.045;
        if (!reducedMotion) object.rotation.y += isHost ? 0.007 : -0.007;
        setGlow(object, wins || state.winner === "draw" ? 1.45 : 0.38, loses ? 0.62 : 1);
      });

      runtime.swaps = runtime.swaps.filter((swap) => {
        const progress = reducedMotion
          ? 1
          : Math.min(1, Math.max(0, (time - swap.startedAt) / SWAP_DURATION_MS));
        setGlow(swap.from, 0.85, 1 - progress);
        setGlow(swap.to, 0.85, progress);
        if (progress < 1) return true;
        scene.remove(swap.from);
        disposeObject(swap.from);
        return false;
      });

      renderer.render(scene, camera);
    });

    return () => {
      runtime.disposed = true;
      runtimeRef.current = null;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      disposeScene(scene);
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    MOVES.forEach((move) => {
      const asset = selectionAssets[move] ?? null;
      const key = asset?.id ?? `default:${move}`;
      if (runtime.selectionKeys[move] === key) return;
      runtime.selectionKeys[move] = key;
      void createMoveObject(move, asset)
        .then((next) => {
          if (runtime.disposed || runtime.selectionKeys[move] !== key) {
            disposeObject(next);
            return;
          }
          const current = runtime.selection[move];
          next.position.copy(current.position);
          next.rotation.copy(current.rotation);
          next.scale.copy(current.scale);
          next.visible = current.visible;
          runtime.selection[move] = next;
          beginSwap(runtime, current, next);
        })
        .catch((error) => {
          console.error(`Could not render generated ${move} asset`, error);
          if (runtime.selectionKeys[move] === key) runtime.selectionKeys[move] = `failed:${key}`;
        });
    });
  }, [selectionAssets.rock?.id, selectionAssets.paper?.id, selectionAssets.scissors?.id]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const updateSlot = (slot: ResultSlot, move: RpsMove | null, asset: RenderableRpsAsset | null) => {
      if (phase !== "complete" || !move) {
        removeResult(runtime, slot);
        return;
      }
      const key = `${move}:${asset?.id ?? "default"}`;
      const currentKey = slot === "host" ? runtime.hostResultKey : runtime.guestResultKey;
      if (currentKey === key) return;
      if (slot === "host") runtime.hostResultKey = key;
      else runtime.guestResultKey = key;
      void createMoveObject(move, asset)
        .then((next) => {
          if (runtime.disposed) {
            disposeObject(next);
            return;
          }
          const latestKey = slot === "host" ? runtime.hostResultKey : runtime.guestResultKey;
          if (latestKey !== key) {
            disposeObject(next);
            return;
          }
          const current = slot === "host" ? runtime.hostResult : runtime.guestResult;
          next.position.set(
            slot === "host" ? -runtime.resultSpacing : runtime.resultSpacing,
            -0.01,
            0,
          );
          next.scale.setScalar(0.78);
          if (slot === "host") runtime.hostResult = next;
          else runtime.guestResult = next;
          if (current) beginSwap(runtime, current, next);
          else runtime.scene.add(next);
        })
        .catch((error) => console.error(`Could not render ${slot} result asset`, error));
    };
    updateSlot("host", hostMove, hostResultAsset);
    updateSlot("guest", guestMove, guestResultAsset);
  }, [phase, hostMove, guestMove, hostResultAsset?.id, guestResultAsset?.id]);

  const selectedMeta = selectedMove ? MOVE_META[selectedMove] : null;
  return (
    <div className={`rps-arena rps-arena--${phase}`}>
      <ArenaBackdrop />
      <div className="arena-stage" aria-hidden>
        <div className="arena-stage__dome" />
        <div className="arena-stage__pad" />
      </div>
      <canvas ref={canvasRef} className="rps-arena__canvas" aria-hidden />
      {webglFailed ? <div className="rps-arena__fallback">3D preview unavailable</div> : null}

      {phase !== "complete" ? (
        <div className="arena-scoreboard">
          <span>
            @{hostHandle.replace(/^@/, "")}
            <small className={hostLocked ? "is-locked" : ""}>{hostLocked ? "Locked" : "Choosing"}</small>
          </span>
          <b>vs</b>
          <span>
            @{guestHandle.replace(/^@/, "")}
            <small className={guestLocked ? "is-locked" : ""}>{guestLocked ? "Locked" : "Choosing"}</small>
          </span>
        </div>
      ) : null}

      {phase === "waiting" ? (
        <div className="arena-lock-copy" aria-live="polite">
          <strong>{isSubmitting ? "Locking move…" : `${selectedMeta?.label ?? "Move"} locked`}</strong>
          <small>Waiting for opponent</small>
        </div>
      ) : null}

      {phase === "spectating" ? (
        <div className="arena-lock-copy">
          <strong>Players choosing</strong>
          <small>Moves reveal together</small>
        </div>
      ) : null}

      {phase === "complete" && result ? (
        <div className="arena-result-overlay" aria-live="polite">
          <small>Round Results</small>
          <strong className="arena-result-overlay__headline">
            {result.handle ? (
              <><span className="arena-result-overlay__handle">{result.handle}</span> {result.text}</>
            ) : result.text}
          </strong>
          <span className="arena-result-overlay__payout">${wagerAmount}</span>
        </div>
      ) : null}
    </div>
  );
}
