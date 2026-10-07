"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SpotlightEvent, SpotlightScene as SceneData } from "@/lib/types";

// Strategy 13 "Volume Spotlight": a stage of volume columns - one row per altcoin (x), the last 90 days running
// toward the viewer (z), column height = log2(volume / its 30-day normal). Columns that break through the 2x
// plane and rank in the day's top 20% get a searchlight from above, and an arc traces the coin's move vs Bitcoin
// over the next 7 days (green up, orange down). Gold columns are days the book held the coin. Front row: today.

const X_SPAN = 16;
const Z_SPAN = 12;
const Y_PER = 0.55;   // world units per doubling of volume
const Y_MIN = -3;
const Y_MAX = 4;
const D_PER = 0.05;   // world units per % of drift
const LIGHT_Y = 5.2;  // height of the searchlights
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const C_LOW = new THREE.Color("#1a2a5c");
const C_HIGH = new THREE.Color("#c86bff");
const C_BEAM = new THREE.Color("#fff3c4");
const C_UP = new THREE.Color("#4dff8f");
const C_DOWN = new THREE.Color("#ff7a3d");
const C_HELD = new THREE.Color("#ffc94d");

function useLayout(sc: SceneData) {
  return useMemo(() => {
    const nx = sc.x.length;
    const nz = sc.z.length;
    const dx = X_SPAN / Math.max(1, nx);
    const dz = Z_SPAN / Math.max(1, nz + 6);
    const xAt = (i: number) => -X_SPAN / 2 + dx * (i + 0.5);
    const zAt = (j: number) => -Z_SPAN / 2 + dz * (j + 0.5);
    const yAt = (v: number | null | undefined) => (typeof v === "number" ? clamp(v, Y_MIN, Y_MAX) * Y_PER : 0);
    return { dx, dz, xAt, zAt, yAt, liveZ: zAt(nz + 3.5), nz };
  }, [sc]);
}

function Columns({ sc }: { sc: SceneData }) {
  const { dx, dz, xAt, zAt, yAt } = useLayout(sc);
  const cells = useMemo(() => {
    const out: { x: number; z: number; h: number; c: THREE.Color }[] = [];
    sc.y.forEach((row, j) => row.forEach((v, i) => {
      if (typeof v !== "number") return;
      const y = yAt(v);
      const t = clamp((v - Y_MIN) / (Y_MAX - Y_MIN), 0, 1);
      const held = !!sc.held?.[j]?.[i];
      const c = held ? C_HELD.clone().multiplyScalar(1.6) : C_LOW.clone().lerp(C_HIGH, t * t).multiplyScalar(0.6 + 1.4 * t);
      out.push({ x: xAt(i), z: zAt(j), h: y, c });
    }));
    return out;
  }, [sc, xAt, zAt, yAt]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    cells.forEach((c, k) => {
      const h = Math.max(0.02, Math.abs(c.h));
      o.position.set(c.x, c.h >= 0 ? h / 2 : -h / 2, c.z);
      o.scale.set(dx * 0.55, h, dz * 0.7);
      o.updateMatrix();
      m.setMatrixAt(k, o.matrix);
      m.setColorAt(k, c.c);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [cells, dx, dz]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, cells.length)]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial toneMapped={false} transparent opacity={0.85} />
    </instancedMesh>
  );
}

function Beam({ sc, ev, onHover }: { sc: SceneData; ev: SpotlightEvent; onHover: (e: SpotlightEvent | null) => void }) {
  const { xAt, zAt, yAt, dz, dx } = useLayout(sc);
  const x = xAt(ev.i);
  const z0 = zAt(ev.j);
  const top = yAt(Math.log2(Math.max(ev.av, 1e-3)));
  const last = ev.drift_pct.length ? ev.drift_pct[ev.drift_pct.length - 1] : 0;
  const col = ev.drift_pct.length ? (last >= 0 ? C_UP : C_DOWN) : C_BEAM;
  const beamH = LIGHT_Y - top;
  const arc = useMemo(() => {
    const pts: [number, number, number][] = [[x, top + 0.05, z0]];
    ev.drift_pct.forEach((d, h) => pts.push([x, top + 0.05 + clamp(d, -40, 60) * D_PER, z0 + dz * (h + 1)]));
    return pts;
  }, [x, top, z0, dz, ev.drift_pct]);
  return (
    <group>
      <mesh position={[x, top + beamH / 2, z0]} onPointerOver={(e) => { e.stopPropagation(); onHover(ev); }}
        onPointerOut={() => onHover(null)}>
        <coneGeometry args={[dx * 0.45, beamH, 16, 1, true]} />
        <meshBasicMaterial color={C_BEAM} transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[x, top + 0.05, z0]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshBasicMaterial color={col.clone().multiplyScalar(2.5)} toneMapped={false} />
      </mesh>
      {arc.length > 1 && <Line points={arc} color={col.clone().multiplyScalar(1.8)} lineWidth={2} toneMapped={false} />}
    </group>
  );
}

function ThresholdPlane({ sc }: { sc: SceneData }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const y = Math.log2(sc.threshold) * Y_PER;
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.07 * (0.8 + 0.2 * Math.sin(clock.getElapsedTime() * 1.1));
  });
  return (
    <group>
      <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[X_SPAN + 0.4, Z_SPAN]} />
        <meshBasicMaterial ref={mat} color="#c86bff" transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Html position={[X_SPAN / 2 + 0.5, y, -Z_SPAN / 2]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ color: "#c86bff" }}>{sc.threshold}x normal volume</div>
      </Html>
    </group>
  );
}

function Live({ sc }: { sc: SceneData }) {
  const { xAt, liveZ, dx, yAt } = useLayout(sc);
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    g.current?.children.forEach((c, k) => { c.scale.x = c.scale.z = 1 + 0.15 * Math.sin(clock.getElapsedTime() * 2.2 + k); });
  });
  if (!sc.live) return null;
  return (
    <group ref={g}>
      {sc.x.map((coin, i) => {
        const l = sc.live?.[coin];
        const raw = l ? l[sc.live_key ?? "av"] : undefined;
        if (!l || typeof raw !== "number" || raw <= 0) return null;
        const v = Math.log2(raw);
        const h = Math.max(0.03, Math.abs(yAt(v)));
        const col = l.held ? C_HELD.clone().multiplyScalar(2.4) : (raw >= sc.threshold ? C_HIGH : C_LOW).clone().multiplyScalar(1.6);
        return (
          <group key={coin} position={[xAt(i), 0, liveZ]}>
            <mesh position={[0, v >= 0 ? h / 2 : -h / 2, 0]}>
              <boxGeometry args={[dx * 0.5, h, dx * 0.5]} />
              <meshBasicMaterial color={col} toneMapped={false} transparent opacity={l.held ? 0.95 : 0.55} />
            </mesh>
            {l.held && (
              <Html position={[0, Math.max(0, yAt(v)) + 0.5, 0]} center style={{ pointerEvents: "none" }}>
                <div className="scene-label scene-label--held">
                  <span className="scene-label__coin">{coin}</span>
                  <span>{l.days_left ?? "?"}d left</span>
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
    for (let j = 0; j < nz; j += step) out.push({ j, label: sc.z[j]?.slice(5, 10) ?? "" });
    return out;
  }, [sc.z, nz]);
  const x0 = -X_SPAN / 2 - 0.3;
  const sub = [
    sc.avg_drift_pct !== null && sc.avg_drift_pct !== undefined ? `avg ${sc.hold_days}-day move vs BTC after a spotlight ${sc.avg_drift_pct > 0 ? "+" : ""}${sc.avg_drift_pct}%` : null,
    sc.hit_rate_pct !== null && sc.hit_rate_pct !== undefined ? `${sc.hit_rate_pct}% beat Bitcoin` : null,
    typeof sc.live_btc_hedge === "number" && sc.live_btc_hedge > 0 ? `BTC hedge ${sc.live_btc_hedge.toFixed(2)}x` : null,
  ].filter(Boolean).join(" · ");
  return (
    <group>
      {sc.x.map((c, i) => (
        <Html key={c} position={[xAt(i), -0.3, liveZ + 0.8]} center style={{ pointerEvents: "none" }}>
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
      <Html position={[0, LIGHT_Y + 0.6, -Z_SPAN / 2 - 1.2]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title">{(sc.title ?? "").toUpperCase()}</div>
        {sub && <div className="scene-label scene-label--axis" style={{ textAlign: "center" }}>{sub}</div>}
      </Html>
      <Line points={[[x0, 0, -Z_SPAN / 2], [x0, 0, liveZ + 0.3]]} color="#2b3658" lineWidth={1} />
    </group>
  );
}

function Tooltip({ sc, ev }: { sc: SceneData; ev: SpotlightEvent }) {
  const { xAt, zAt, yAt } = useLayout(sc);
  const x = xAt(ev.i);
  const last = ev.drift_pct.length ? ev.drift_pct[ev.drift_pct.length - 1] : null;
  return (
    <Html position={[x, yAt(Math.log2(Math.max(ev.av, 1e-3))) + 0.3, zAt(ev.j)]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${x > 3 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">{sc.x[ev.i]} · {sc.z[ev.j]}</div>
        <div className="tooltip__row"><span>volume vs normal</span><b>{ev.av.toFixed(1)}x</b></div>
        <div className="tooltip__row"><span>that day&apos;s move</span><b>{ev.day_ret_pct > 0 ? "+" : ""}{ev.day_ret_pct}%</b></div>
        <div className="tooltip__row"><span>next {ev.drift_pct.length} days (vs BTC)</span>
          <b>{last === null ? "pending" : `${last > 0 ? "+" : ""}${last}%`}</b></div>
      </div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 21 * Math.max(1, 1.7 / aspect);
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function SpotlightScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<SpotlightEvent | null>(null);
  const [spin, setSpin] = useState(true);
  return (
    <Canvas camera={{ position: [9, 10, 15], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#07050d")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#07050d", 20, 60]} />
      <ambientLight intensity={0.4} />
      <pointLight position={[0, 8, 0]} intensity={30} color="#fff3c4" />
      <Stars radius={60} depth={30} count={1500} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={120} scale={[20, 7, 14]} size={1.6} speed={0.3} opacity={0.3} color="#c86bff" />
      <group position={[0, -1.2, 0]}>
        <Columns sc={scene} />
        <ThresholdPlane sc={scene} />
        {scene.events.map((ev, k) => <Beam key={k} sc={scene} ev={ev} onHover={setHover} />)}
        <Live sc={scene} />
        <Axes sc={scene} />
        {hover && <Tooltip sc={scene} ev={hover} />}
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.3}
        minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.1} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.0} luminanceThreshold={0.4} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
