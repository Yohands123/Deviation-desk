"use client";
/**
 * The voxel world (docs/DESIGN.md §Voxel world): an isometric cutaway of the site drawn from the
 * twin. Static voxels are a single instanced mesh; workers, particles and lights are small
 * instanced meshes. Serious information stays in the flat panels around it.
 */
import { OrthographicCamera, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { AlertOctagon, PauseCircle } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { buildStaticScene, VOXEL_SIZE, workerSpots, type RoomBounds, type StaticScene } from "@/voxel/build-scene";
import { createRng } from "@/sim/prng";
import { STATUS } from "@/voxel/palette";
import { workerModel } from "@/voxel/models";
import type { SceneData, SceneWorker, Voxel } from "@/voxel/types";

const S = VOXEL_SIZE;
const ISO_DIRECTION = new THREE.Vector3(1, 0.95, 1).normalize();
const WALK_SECONDS = 4;
/** Workers read better slightly smaller than the voxel grid of the rooms. */
const WORKER_SCALE = 0.75;

export interface VoxelWorldProps {
  scene: SceneData;
  /** Frame the viewer's department (true) or the whole site (false). */
  focusDepartment: boolean;
  reducedMotion: boolean;
  /** Off screen: stop rendering entirely until visible again. */
  paused: boolean;
  onSelectWorker: (worker: SceneWorker) => void;
  onSelectRoom: (roomId: string) => void;
  /** Called when the device cannot keep a usable frame rate; the page switches to the flat map. */
  onTooSlow: () => void;
}

/** World position of a voxel's centre. */
const at = (x: number, y: number, z: number) => new THREE.Vector3((x + 0.5) * S, (y + 0.5) * S, (z + 0.5) * S);

function unionBounds(rooms: Record<string, RoomBounds>, ids: string[]): RoomBounds | null {
  const list = ids.map((id) => rooms[id]).filter((b): b is RoomBounds => Boolean(b));
  if (list.length === 0) return null;
  return {
    x0: Math.min(...list.map((b) => b.x0)),
    z0: Math.min(...list.map((b) => b.z0)),
    x1: Math.max(...list.map((b) => b.x1)),
    z1: Math.max(...list.map((b) => b.z1)),
  };
}

// ─── Static voxels: one draw call ────────────────────────────────────

function StaticVoxels({
  built,
  onSelectRoom,
  equipmentRoom,
  shippingRoom,
}: {
  built: StaticScene;
  onSelectRoom: (id: string) => void;
  equipmentRoom: Map<string, string>;
  shippingRoom: string | null;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const [hovered, setHovered] = useState(false);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    built.voxels.forEach((v, i) => {
      matrix.setPosition(at(v.x, v.y, v.z));
      m.setMatrixAt(i, matrix);
      m.setColorAt(i, color.set(v.color));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [built]);

  const roomFor = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const owner = e.instanceId === undefined ? null : built.voxels[e.instanceId]?.owner;
    if (!owner) return null;
    if (owner.kind === "room") return owner.id;
    if (owner.kind === "equipment") return equipmentRoom.get(owner.id) ?? null;
    return shippingRoom; // trucks wait at the shipping room
  };

  useLayoutEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, built.voxels.length]}
      onClick={(e) => {
        e.stopPropagation();
        const room = roomFor(e);
        if (room) onSelectRoom(room);
      }}
      onPointerMove={(e) => setHovered(roomFor(e) !== null)}
      onPointerOut={() => setHovered(false)}
    >
      <boxGeometry args={[S, S, S]} />
      <meshLambertMaterial />
    </instancedMesh>
  );
}

// ─── Workers ─────────────────────────────────────────────────────────

function ModelMesh({ voxels }: { voxels: Voxel[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    voxels.forEach((v, i) => {
      m.setMatrixAt(i, matrix.setPosition(at(v.x - 1, v.y, v.z - 1)));
      m.setColorAt(i, color.set(v.color));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [voxels]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, voxels.length]}>
      <boxGeometry args={[S, S, S]} />
      <meshLambertMaterial />
    </instancedMesh>
  );
}

function Worker({
  worker,
  from,
  to,
  reducedMotion,
  onSelect,
}: {
  worker: SceneWorker;
  from: THREE.Vector3;
  to: THREE.Vector3;
  reducedMotion: boolean;
  onSelect: (w: SceneWorker) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const diamond = useRef<THREE.Mesh>(null);
  const started = useRef<number | null>(null);
  const voxels = useMemo(() => workerModel(worker.outfit, worker.id, worker.carryingFolder), [worker]);
  // Face the direction of travel; otherwise face the open front of the building.
  const heading = Math.atan2(to.x - from.x, to.z - from.z);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    if (started.current === null) started.current = state.clock.elapsedTime;
    const t = reducedMotion ? 1 : Math.min(1, (state.clock.elapsedTime - started.current) / WALK_SECONDS);
    g.position.lerpVectors(from, to, t);
    const moving = t < 1 && from.distanceTo(to) > 0.01;
    // Stand on top of the floor layer; bob a little while walking.
    g.position.y = S + (moving ? Math.abs(Math.sin(state.clock.elapsedTime * 10)) * 0.06 : 0);
    g.rotation.y = moving ? heading : Math.PI / 4;
    if (diamond.current && !reducedMotion) diamond.current.rotation.y = state.clock.elapsedTime * 1.2;
  });

  return (
    <group
      ref={group}
      position={from}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(worker);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
      scale={WORKER_SCALE}
    >
      <ModelMesh voxels={voxels} />
      {worker.kind === "agent" && (
        // The AI marker floats above every agent (trust rule 1).
        <mesh ref={diamond} position={[0, 10.6 * S, 0]}>
          <octahedronGeometry args={[S * 0.9]} />
          <meshLambertMaterial color="#2f5d8a" emissive="#2f5d8a" emissiveIntensity={0.35} />
        </mesh>
      )}
    </group>
  );
}

// ─── Overlays ────────────────────────────────────────────────────────

/** Floating particles over affected rooms. Still when reduced motion is on. */
function Particles({ rooms, reducedMotion }: { rooms: RoomBounds[]; reducedMotion: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(
    () =>
      rooms.flatMap((b, r) => {
        // Seeded so the cloud looks the same on every render and every visit.
        const rng = createRng(1000 + r);
        return Array.from({ length: 36 }, () => ({
          x: b.x0 + 1 + rng.next() * (b.x1 - b.x0 - 1),
          z: b.z0 + 1 + rng.next() * (b.z1 - b.z0 - 1),
          y: 3 + rng.next() * 6,
          phase: rng.next() * Math.PI * 2,
        }));
      }),
    [rooms],
  );
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const place = (time: number) => {
    const m = mesh.current;
    if (!m) return;
    seeds.forEach((p, i) => {
      const y = p.y + (reducedMotion ? 0 : Math.sin(time * 0.8 + p.phase) * 0.8);
      m.setMatrixAt(i, matrix.makeScale(0.6, 0.6, 0.6).setPosition(at(p.x, y, p.z)));
    });
    m.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(() => place(0));
  useFrame((state) => {
    if (!reducedMotion) place(state.clock.elapsedTime);
  });
  if (seeds.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, seeds.length]} raycast={() => null}>
      <boxGeometry args={[S, S, S]} />
      <meshBasicMaterial color={STATUS.critical} transparent opacity={0.7} />
    </instancedMesh>
  );
}

/** Amber light on halted equipment and lines; it pulses unless reduced motion is on. */
function HaltedLight({ position, reducedMotion }: { position: THREE.Vector3; reducedMotion: boolean }) {
  const material = useRef<THREE.MeshLambertMaterial>(null);
  useFrame((state) => {
    if (material.current && !reducedMotion) material.current.emissiveIntensity = 0.4 + Math.abs(Math.sin(state.clock.elapsedTime * 3)) * 0.8;
  });
  return (
    <mesh position={position}>
      <boxGeometry args={[S, S, S]} />
      <meshLambertMaterial ref={material} color={STATUS.atRisk} emissive={STATUS.atRisk} emissiveIntensity={0.8} />
    </mesh>
  );
}

// ─── Camera ──────────────────────────────────────────────────────────

/** Frames the requested area and eases there when it changes (motion only on change). */
function CameraRig({ area, reducedMotion }: { area: RoomBounds; reducedMotion: boolean }) {
  const { size, invalidate } = useThree();
  const target = useRef(new THREE.Vector3());
  const goal = useMemo(() => {
    const cx = ((area.x0 + area.x1 + 1) / 2) * S;
    const cz = ((area.z0 + area.z1 + 1) / 2) * S;
    const wx = (area.x1 - area.x0 + 1) * S;
    const wz = (area.z1 - area.z0 + 1) * S;
    // Projected size of the area seen from the isometric direction, with room for walls and labels.
    const projectedWidth = (wx + wz) * 0.75 + 2;
    const projectedHeight = (wx + wz) * 0.45 + 3.6;
    const zoom = Math.min(size.width / projectedWidth, size.height / projectedHeight);
    return { center: new THREE.Vector3(cx, 0.6, cz), zoom };
  }, [area, size.width, size.height]);
  const progress = useRef(0);

  useLayoutEffect(() => {
    progress.current = reducedMotion ? 1 : 0;
    invalidate();
  }, [goal, reducedMotion, invalidate]);

  useFrame((state) => {
    const cam = state.camera as THREE.OrthographicCamera;
    if (progress.current < 1) progress.current = Math.min(1, progress.current + 0.06);
    const k = progress.current === 1 ? 1 : 0.12;
    target.current.lerp(goal.center, k);
    cam.zoom += (goal.zoom - cam.zoom) * k;
    cam.position.copy(target.current).addScaledVector(ISO_DIRECTION, 40);
    cam.lookAt(target.current);
    cam.updateProjectionMatrix();
    if (progress.current < 1) invalidate();
  });
  return null;
}

// ─── Labels ──────────────────────────────────────────────────────────

/**
 * Keeps DOM labels over their 3D anchors. Labels are ordinary elements next to the canvas; this
 * only writes their transform, so nothing re-renders per frame.
 */
function LabelProjector({ anchors, elements }: { anchors: Map<string, THREE.Vector3>; elements: RefObject<Map<string, HTMLElement>> }) {
  const scratch = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    for (const [key, anchor] of anchors) {
      const el = elements.current.get(key);
      if (!el) continue;
      scratch.copy(anchor).project(state.camera);
      const x = ((scratch.x + 1) / 2) * state.size.width;
      const y = ((1 - scratch.y) / 2) * state.size.height;
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      el.style.visibility = Math.abs(scratch.x) <= 1.1 && Math.abs(scratch.y) <= 1.1 ? "visible" : "hidden";
    }
  });
  return null;
}

// ─── The world ───────────────────────────────────────────────────────

export default function VoxelWorld({ scene, focusDepartment, reducedMotion, paused, onSelectWorker, onSelectRoom, onTooSlow }: VoxelWorldProps) {
  const built = useMemo(() => buildStaticScene(scene), [scene]);
  const spots = useMemo(() => workerSpots(scene, scene.workers), [scene]);
  const equipmentRoom = useMemo(() => new Map(scene.equipment.map((e) => [e.id, e.roomId])), [scene.equipment]);
  const criticalRooms = useMemo(() => scene.rooms.filter((r) => r.tint === "critical").map((r) => built.rooms[r.id]).filter((b): b is RoomBounds => Boolean(b)), [scene.rooms, built]);
  const area = (focusDepartment ? unionBounds(built.rooms, scene.focusRoomIds) : null) ?? built.bounds;
  const animated = !reducedMotion && (criticalRooms.length > 0 || scene.workers.length > 0 || scene.equipment.some((e) => e.halted));

  // Label anchors: each room's front-left floor corner, and above each truck.
  const anchors = useMemo(() => {
    const m = new Map<string, THREE.Vector3>();
    for (const r of scene.rooms) {
      const b = built.rooms[r.id];
      if (b) m.set(`room:${r.id}`, at(b.x0 + 0.5, 0.5, b.z1 + 0.5));
    }
    for (const t of scene.trucks) {
      const top = built.truckTops[t.shipmentCode];
      if (top) m.set(`truck:${t.shipmentCode}`, at(top.x, top.y + 2, top.z));
    }
    return m;
  }, [scene.rooms, scene.trucks, built]);
  const labelElements = useRef(new Map<string, HTMLElement>());
  const register = (key: string) => (el: HTMLElement | null) => {
    if (el) labelElements.current.set(key, el);
    else labelElements.current.delete(key);
  };

  return (
    <div className="relative h-full w-full">
    <Canvas
      frameloop={paused ? "never" : animated ? "always" : "demand"}
      dpr={[1, 1.75]}
      gl={{ antialias: true }}
      onPointerMissed={() => (document.body.style.cursor = "")}
      aria-label="Isometric view of the site"
      role="img"
    >
      <PerformanceMonitor onFallback={onTooSlow} flipflops={3} />
      <OrthographicCamera makeDefault near={0.1} far={200} />
      <CameraRig area={area} reducedMotion={reducedMotion} />
      <color attach="background" args={["#f5f4ef"]} />
      <hemisphereLight args={["#ffffff", "#d8d2c4", 1.6]} />
      <directionalLight position={[6, 12, 9]} intensity={1.4} />

      <StaticVoxels built={built} onSelectRoom={onSelectRoom} equipmentRoom={equipmentRoom} shippingRoom={scene.rooms.find((r) => r.roomType === "shipping")?.id ?? null} />
      <Particles rooms={criticalRooms} reducedMotion={reducedMotion} />
      {scene.equipment
        .filter((e) => e.halted)
        .map((e) => {
          const top = built.equipmentTops[e.id];
          return top ? <HaltedLight key={e.id} position={at(top.x, top.y, top.z)} reducedMotion={reducedMotion} /> : null;
        })}
      {scene.workers.map((w) => {
        const spot = spots[w.id];
        if (!spot) return null;
        return (
          <Worker
            key={w.id}
            worker={w}
            from={at(spot.home.x, 1, spot.home.z).setY(0)}
            to={at(spot.target.x, 1, spot.target.z).setY(0)}
            reducedMotion={reducedMotion || !w.walking}
            onSelect={onSelectWorker}
          />
        );
      })}
      <LabelProjector anchors={anchors} elements={labelElements} />
    </Canvas>
      {/* Labels pair each status colour with a word (trust rule 4). Positioned by LabelProjector. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {scene.rooms.map((r) => (
          <div key={r.id} ref={register(`room:${r.id}`)} className="invisible absolute left-0 top-0">
            <div className="-translate-y-full whitespace-nowrap rounded bg-panel/90 px-1.5 py-0.5 text-[11px] leading-tight shadow-sm">
              <span className="font-medium">{r.name}</span>{" "}
              <span className={r.tint === "critical" ? "text-critical-text" : r.tint === "at_risk" ? "text-at-risk-text" : "text-muted"}>
                · {{ critical: "Affected", at_risk: "At risk", clear: "Clear" }[r.tint]}
              </span>
              {r.taped && <span className="text-at-risk-text"> · Taped off</span>}
            </div>
          </div>
        ))}
        {scene.trucks.map((t) => (
          <div key={t.shipmentCode} ref={register(`truck:${t.shipmentCode}`)} className="invisible absolute left-0 top-0">
            <div className={`flex -translate-x-1/2 -translate-y-full items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] shadow-sm ${t.held ? "border-critical bg-critical-fill text-critical-text" : "border-line bg-panel text-ink"}`}>
              {t.held ? <AlertOctagon aria-hidden className="size-3" /> : <PauseCircle aria-hidden className="size-3" />}
              <span className="font-mono">{t.shipmentCode}</span> · {t.held ? "Held" : "At dock"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
