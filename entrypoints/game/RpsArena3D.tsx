import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { GameWinner, RpsMove } from "../../src/lobby";

type ArenaPhase = "selecting" | "waiting" | "spectating" | "complete";

interface RpsArena3DProps {
  canReplay: boolean;
  canChoose: boolean;
  guestHandle: string;
  guestLocked: boolean;
  guestMove: RpsMove | null;
  hostHandle: string;
  hostLocked: boolean;
  hostMove: RpsMove | null;
  isReplaying: boolean;
  isSubmitting: boolean;
  onChoose: (move: RpsMove) => void;
  onReplay: () => void;
  phase: ArenaPhase;
  resultHeadline: string | null;
  selectedMove: RpsMove | null;
  winner: GameWinner | null;
}

const MOVE_META: Record<RpsMove, { color: number; emoji: string; label: string }> = {
  rock: { color: 0x7c5cff, emoji: "✊", label: "Rock" },
  paper: { color: 0x53d8ff, emoji: "✋", label: "Paper" },
  scissors: { color: 0xff4fc8, emoji: "✌️", label: "Scissors" },
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
  const geometry = new THREE.IcosahedronGeometry(0.46, 1);
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const variation = 1 + Math.sin(index * 12.9898) * 0.08;
    positions.setXYZ(index, x * variation, y * (1 + Math.cos(index * 4.1) * 0.05), z * variation);
  }
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: MOVE_META.rock.color,
    emissive: 0x291878,
    emissiveIntensity: 0.85,
    flatShading: true,
    metalness: 0.28,
    roughness: 0.42,
  });
  const rock = new THREE.Mesh(geometry, material);
  rock.rotation.set(0.25, 0.4, -0.12);
  group.add(rock);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 28),
    new THREE.LineBasicMaterial({ color: 0xb7a9ff, transparent: true, opacity: 0.55 }),
  );
  edge.rotation.copy(rock.rotation);
  group.add(edge);
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
    transparent: true,
    opacity: 0.94,
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

function createMoveObject(move: RpsMove) {
  if (move === "rock") return createRock();
  if (move === "paper") return createPaper();
  return createScissors();
}

function setGlow(group: THREE.Object3D, intensity: number, opacity = 1) {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineSegments)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      material.transparent = opacity < 1 || material.transparent;
      material.opacity = opacity;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissiveIntensity = intensity;
      }
    });
  });
}

function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineSegments) && !(object instanceof THREE.Points)) {
      return;
    }
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export function RpsArena3D({
  canReplay,
  canChoose,
  guestHandle,
  guestLocked,
  guestMove,
  hostHandle,
  hostLocked,
  hostMove,
  isReplaying,
  isSubmitting,
  onChoose,
  onReplay,
  phase,
  resultHeadline,
  selectedMove,
  winner,
}: RpsArena3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chooseRef = useRef(onChoose);
  const [webglFailed, setWebglFailed] = useState(false);

  chooseRef.current = onChoose;

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
    renderer.setClearColor(0x03050b, 0);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050712, 0.12);
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

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.45, 64),
      new THREE.MeshBasicMaterial({ color: 0x070b17, transparent: true, opacity: 0.92 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.66;
    scene.add(floor);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x339dff,
      transparent: true,
      opacity: 0.7,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.025, 12, 80), ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.62;
    scene.add(ring);

    const innerRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.82, 0.012, 10, 64),
      new THREE.MeshBasicMaterial({ color: 0x7b57ff, transparent: true, opacity: 0.45 }),
    );
    innerRing.rotation.x = Math.PI / 2;
    innerRing.position.y = -0.615;
    scene.add(innerRing);

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

    const selectionMoves: RpsMove[] = ["rock", "paper", "scissors"];
    const selectionObjects = selectionMoves.map((move, index) => {
      const object = createMoveObject(move);
      const baseScale = phase === "waiting" ? 0.9 : 0.78;
      object.position.set((index - 1) * 1.08, -0.02, 0);
      object.scale.setScalar(baseScale);
      object.userData.baseX = object.position.x;
      object.userData.baseY = object.position.y;
      object.userData.baseScale = baseScale;
      object.visible = phase !== "complete" && (phase !== "waiting" || move === selectedMove);
      if (phase === "waiting" && move === selectedMove) object.position.x = 0;
      if (phase === "spectating") setGlow(object, 0.42, 0.48);
      scene.add(object);
      return object;
    });

    let hostResult: THREE.Group | null = null;
    let guestResult: THREE.Group | null = null;
    if (phase === "complete" && hostMove && guestMove) {
      hostResult = createMoveObject(hostMove);
      guestResult = createMoveObject(guestMove);
      hostResult.position.set(-0.98, -0.01, 0);
      guestResult.position.set(0.98, -0.01, 0);
      hostResult.scale.setScalar(0.78);
      guestResult.scale.setScalar(0.78);
      setGlow(hostResult, winner === "host" || winner === "draw" ? 1.45 : 0.38, winner === "guest" ? 0.62 : 1);
      setGlow(guestResult, winner === "guest" || winner === "draw" ? 1.45 : 0.38, winner === "host" ? 0.62 : 1);
      scene.add(hostResult, guestResult);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoveredMove: RpsMove | null = null;

    const findMove = (event: PointerEvent) => {
      if (phase !== "selecting" || !canChoose) return null;
      const bounds = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(selectionObjects, true)[0];
      return (hit?.object.userData.move as RpsMove | undefined) ?? null;
    };

    const handlePointerMove = (event: PointerEvent) => {
      hoveredMove = findMove(event);
      canvas.style.cursor = hoveredMove ? "pointer" : "default";
    };
    const handlePointerLeave = () => {
      hoveredMove = null;
      canvas.style.cursor = "default";
    };
    const handlePointerUp = (event: PointerEvent) => {
      const move = findMove(event);
      if (move) chooseRef.current(move);
    };
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("pointerup", handlePointerUp);

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
      const drawingWidth = Math.floor(width * pixelRatio);
      const drawingHeight = Math.floor(height * pixelRatio);
      if (canvas.width !== drawingWidth || canvas.height !== drawingHeight) {
        renderer.setSize(drawingWidth, drawingHeight, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setAnimationLoop((time) => {
      resize();
      const seconds = time * 0.001;
      particles.rotation.y = seconds * 0.035;
      ringMaterial.opacity = 0.48 + Math.sin(seconds * 2.4) * 0.18;
      ring.rotation.z = seconds * 0.08;
      innerRing.rotation.z = -seconds * 0.12;

      selectionObjects.forEach((object, index) => {
        if (!object.visible) return;
        const move = selectionMoves[index];
        const baseScale = object.userData.baseScale as number;
        const hoverScale = baseScale * (hoveredMove === move ? 1.16 : phase === "waiting" ? 1.08 : 1);
        object.scale.lerp(new THREE.Vector3(hoverScale, hoverScale, hoverScale), 0.13);
        object.position.y = object.userData.baseY + (reducedMotion ? 0 : Math.sin(seconds * 1.8 + index) * 0.07);
        if (!reducedMotion) object.rotation.y += 0.006 + index * 0.0015;
        setGlow(object, hoveredMove === move ? 1.55 : phase === "waiting" ? 1.25 : 0.85);
      });

      if (hostResult && guestResult) {
        const hostWins = winner === "host";
        const guestWins = winner === "guest";
        const hostScale = hostWins ? 0.92 : 0.78;
        const guestScale = guestWins ? 0.92 : 0.78;
        hostResult.scale.lerp(new THREE.Vector3(hostScale, hostScale, hostScale), 0.08);
        guestResult.scale.lerp(new THREE.Vector3(guestScale, guestScale, guestScale), 0.08);
        if (!reducedMotion) {
          hostResult.rotation.y += 0.007;
          guestResult.rotation.y -= 0.007;
          hostResult.position.y = Math.sin(seconds * 2) * 0.045;
          guestResult.position.y = Math.sin(seconds * 2 + 1.2) * 0.045;
        }
      }

      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("pointerup", handlePointerUp);
      disposeScene(scene);
      renderer.dispose();
    };
  }, [canChoose, guestMove, hostMove, phase, selectedMove, winner]);

  const selectedMeta = selectedMove ? MOVE_META[selectedMove] : null;

  return (
    <div className={`rps-arena rps-arena--${phase}`}>
      <canvas ref={canvasRef} className="rps-arena__canvas" aria-hidden />
      {webglFailed ? <div className="rps-arena__fallback">3D preview unavailable</div> : null}

      <div className="arena-scoreboard">
        <span>
          @{hostHandle.replace(/^@/, "")}
          <small className={hostLocked ? "is-locked" : ""}>
            {hostLocked ? "LOCKED" : "CHOOSING"}
          </small>
        </span>
        <b>VS</b>
        <span>
          @{guestHandle.replace(/^@/, "")}
          <small className={guestLocked ? "is-locked" : ""}>
            {guestLocked ? "LOCKED" : "CHOOSING"}
          </small>
        </span>
      </div>

      {phase === "selecting" ? (
        <div className="arena-move-controls" aria-label="Choose your move">
          {(Object.keys(MOVE_META) as RpsMove[]).map((move) => (
            <button
              type="button"
              key={move}
              disabled={!canChoose || isSubmitting}
              aria-label={`Choose ${MOVE_META[move].label}`}
              onClick={() => onChoose(move)}
            >
              <span aria-hidden>{MOVE_META[move].emoji}</span>
              {MOVE_META[move].label}
            </button>
          ))}
        </div>
      ) : null}

      {phase === "waiting" ? (
        <div className="arena-lock-copy" aria-live="polite">
          <span aria-hidden>{selectedMeta?.emoji ?? "◆"}</span>
          <strong>{isSubmitting ? "LOCKING MOVE…" : `${selectedMeta?.label ?? "MOVE"} LOCKED`}</strong>
          <small>Waiting for opponent</small>
        </div>
      ) : null}

      {phase === "spectating" ? (
        <div className="arena-lock-copy">
          <span aria-hidden>◈</span>
          <strong>PLAYERS CHOOSING</strong>
          <small>Moves reveal together</small>
        </div>
      ) : null}

      {phase === "complete" ? (
        <div className="arena-result-copy" aria-live="polite">
          <small>ROUND RESULT</small>
          <strong>{resultHeadline}</strong>
          <span>
            {hostMove ? MOVE_META[hostMove].label : "—"} vs {guestMove ? MOVE_META[guestMove].label : "—"}
          </span>
          {canReplay ? (
            <button type="button" disabled={isReplaying} onClick={onReplay}>
              <span aria-hidden>↻</span>
              {isReplaying ? "Resetting…" : "Play again"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
