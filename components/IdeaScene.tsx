"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { IdeaScene as SceneData } from "@/lib/types";

// Generic 3D view for idea-lab strategies. kind "terrain": a landscape of bars,
// x = category (coin), z = time (oldest at the back, newest at the front), height = value.
// "glow" lights the cells the strategy actually held; "live" adds beacons for today's readings.

const X_SPAN = 16;
const Z_SPAN = 12;
const Y_PER = 0.06; // world units per value unit (e.g. per 1% APR)
const Y_MIN = -25;
const Y_MAX = 70;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const C_NEG = new THREE.Color("#d96b25");
const C_ZERO = new THREE.Color("#1d2740");
const C_BASE = new THREE.Color("#1b9bd0");
const C_HIGH = new THREE.Color("#35f0c0");
const C_HELD = new THREE.Color("#ffc94d");

function valueColor(v: number, ref: number): THREE.Color {
  if (v < 0) return C_ZERO.clone().lerp(C_NEG, clamp(-v / 20, 0, 1));
  if (v < ref) return C_ZERO.clone().lerp(C_BASE, clamp(v / ref, 0, 1));
  return C_BASE.clone().lerp(C_HIGH, clamp((v - ref) / 30, 0, 1));
}

type Cell = { i: number; j: number; x: number; z: number; v: number; glow: number };

function useLayout(sc: SceneData) {
  return useMemo(() => {
    const nx = sc.x.length;
    const nz = sc.z.length;
    const dx = X_SPAN / Math.max(1, nx);
    const dz = Z_SPAN / Math.max(1, nz + 2); // +2 leaves a row in front for the live beacons
    const xAt = (i: number) => -X_SPAN / 2 + dx * (i + 0.5);
    const zAt = (j: number) => -Z_SPAN / 2 + dz * (j + 0.5);
    const cells: Cell[] = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const v = sc.y[j]?.[i];
        if (v === null || v === undefined) continue;
        cells.push({ i, j, x: xAt(i), z: zAt(j), v, glow: sc.glow?.[j]?.[i] ?? 0 });
      }
    }
    return { cells, dx, dz, xAt, zAt, liveZ: zAt(nz + 0.8), nz };
  }, [sc]);
}

function Terrain({ sc, onHover }: { sc: SceneData; onHover: (c: Cell | null) => void }) {
  const { cells, dx, dz } = useLayout(sc);
  const ref = useRef<THREE.InstancedMesh>(null);
  const refVal = sc.ref_plane ?? 0;
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    cells.forEach((c, k) => {
      const h = Math.max(0.02, Math.abs(clamp(c.v, Y_MIN, Y_MAX)) * Y_PER);
      o.position.set(c.x, c.v >= 0 ? h / 2 : -h / 2, c.z);
      o.scale.set(dx * 0.72, h, dz * 0.82);
      o.updateMatrix();
      m.setMatrixAt(k, o.matrix);
      const col = c.glow > 0.05
        ? valueColor(c.v, refVal).lerp(C_HELD, 0.35 + 0.65 * c.glow).multiplyScalar(1 + 1.6 * c.glow)
        : valueColor(c.v, refVal);
      m.setColorAt(k, col);
    });
    m.count = cells.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [cells, dx, dz, refVal]);
  return (
    <instancedMesh key={cells.length} ref={ref} args={[undefined, undefined, Math.max(1, cells.length)]}
      onPointerMove={(e) => { e.stopPropagation(); onHover(e.instanceId !== undefined ? cells[e.instanceId] ?? null : null); }}
      onPointerOut={() => onHover(null)}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.45} metalness={0.2} toneMapped={false} />
    </instancedMesh>
  );
}

function Plane({ value, label, color, opacity }: { value: number; label: string; color: string; opacity: number }) {
  const y = value * Y_PER;
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = opacity * (0.8 + 0.2 * Math.sin(clock.getElapsedTime() * 1.3));
  });
  const hx = X_SPAN / 2 + 0.2;
  const hz = Z_SPAN / 2;
  return (
    <group>
      <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[X_SPAN + 0.4, Z_SPAN]} />
        <meshBasicMaterial ref={mat} color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={[[-hx, y, -hz], [hx, y, -hz], [hx, y, hz], [-hx, y, hz], [-hx, y, -hz]]} color={color} lineWidth={1.2}
        dashed dashSize={0.25} gapSize={0.15} transparent opacity={0.8} />
      <Html position={[hx + 0.3, y, -hz]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ color }}>{label}</div>
      </Html>
    </group>
  );
}

function LiveBeacons({ sc }: { sc: SceneData }) {
  const { xAt, liveZ, dx } = useLayout(sc);
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!g.current) return;
    const t = clock.getElapsedTime();
    g.current.children.forEach((c, k) => {
      c.scale.x = c.scale.z = 1 + 0.15 * Math.sin(t * 2.4 + k);
    });
  });
  if (!sc.live) return null;
  return (
    <group ref={g}>
      {sc.x.map((coin, i) => {
        const l = sc.live?.[coin];
        if (!l || l.apr === null || l.apr === undefined) return null;
        const h = Math.max(0.03, Math.abs(clamp(l.apr, Y_MIN, Y_MAX)) * Y_PER);
        const col = l.held ? C_HELD.clone().multiplyScalar(2.2) : valueColor(l.apr, sc.ref_plane ?? 0).multiplyScalar(1.4);
        return (
          <group key={coin} position={[xAt(i), 0, liveZ]}>
            <mesh position={[0, l.apr >= 0 ? h / 2 : -h / 2, 0]}>
              <cylinderGeometry args={[dx * 0.2, dx * 0.2, h, 12]} />
              <meshBasicMaterial color={col} toneMapped={false} transparent opacity={l.held ? 0.95 : 0.55} />
            </mesh>
            {l.held && (
              <Html position={[0, h + 0.35, 0]} center style={{ pointerEvents: "none" }}>
                <div className="scene-label scene-label--held">
                  <span className="scene-label__coin">{coin}</span>
                  <span>{l.apr.toFixed(0)}%</span>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

function Axes({ sc }: { sc: SceneData }) {
  const { xAt, zAt, nz, liveZ } = useLayout(sc);
  const ticks = useMemo(() => {
    const out: { j: number; label: string }[] = [];
    const step = Math.max(1, Math.round(nz / 6));
    for (let j = 0; j < nz; j += step) out.push({ j, label: sc.z[j]?.slice(0, 7) ?? "" });
    return out;
  }, [sc.z, nz]);
  const x0 = -X_SPAN / 2 - 0.3;
  return (
    <group>
      {sc.x.map((c, i) => (
        <Html key={c} position={[xAt(i), -0.25, liveZ + 0.7]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis scene-label--tilt">{c}</div>
        </Html>
      ))}
      {ticks.map((t) => (
        <Html key={t.j} position={[x0 - 0.2, 0, zAt(t.j)]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis">{t.label}</div>
        </Html>
      ))}
      <Html position={[x0 - 0.6, 0.2, liveZ]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title">TODAY →</div>
      </Html>
      <Html position={[0, Y_MAX * Y_PER * 1.05, -Z_SPAN / 2 - 1.2]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title">{(sc.title ?? "").toUpperCase()} · {sc.y_label?.toUpperCase()}</div>
      </Html>
      <Line points={[[x0, 0, -Z_SPAN / 2], [x0, 0, liveZ + 0.3]]} color="#2b3658" lineWidth={1} />
    </group>
  );
}

function Tooltip({ sc, c }: { sc: SceneData; c: Cell }) {
  const top = Math.max(0, c.v) * Y_PER + 0.25;
  return (
    <Html position={[c.x, top, c.z]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${c.x > 3 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">{sc.x[c.i]} · week of {sc.z[c.j]}</div>
        <div className="tooltip__row"><span>{sc.y_label ?? "value"}</span><b>{c.v.toFixed(1)}</b></div>
        {sc.glow && <div className="tooltip__row"><span>{sc.glow_label ?? "held"}</span><b>{Math.round(c.glow * 100)}%</b></div>}
      </div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 21 * Math.max(1, 1.7 / aspect);
    const dir = camera.position.clone().normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function IdeaScene({ scene, active = true }: { scene: SceneData | null | undefined; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<Cell | null>(null);
  const [spin, setSpin] = useState(true);
  return (
    <Canvas
      camera={{ position: [9, 9, 15], fov: 40 }}
      dpr={[1, 2]}
      frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#050a0c")}
      onPointerDown={() => setSpin(false)}
    >
      <CameraFit />
      <fog attach="fog" args={["#050a0c", 20, 60]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 12, 8]} intensity={1.6} color="#e8fff8" />
      <pointLight position={[-8, 4, 6]} intensity={30} color="#35f0c0" />
      <Stars radius={60} depth={30} count={1800} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={90} scale={[20, 6, 14]} size={1.5} speed={0.3} opacity={0.3} color="#ffc94d" />
      {scene && scene.kind === "terrain" ? (
        <group position={[0, -1.2, 0]}>
          <Terrain sc={scene} onHover={setHover} />
          {scene.ref_plane !== undefined && scene.ref_plane !== null && (
            <Plane value={scene.ref_plane} label={scene.ref_label ?? ""} color="#5cc3ee" opacity={0.07} />
          )}
          {scene.enter_line !== undefined && scene.enter_line !== null && (
            <Plane value={scene.enter_line} label={`${scene.enter_line}% entry line`} color="#ffc94d" opacity={0.04} />
          )}
          <LiveBeacons sc={scene} />
          <Axes sc={scene} />
          {hover && <Tooltip sc={scene} c={hover} />}
        </group>
      ) : (
        <Html center style={{ pointerEvents: "none" }}>
          <div className="scene-title">3D VIEW LANDS WITH THE NEXT SNAPSHOT</div>
        </Html>
      )}
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.3}
        minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.1} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.1} luminanceThreshold={0.35} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
