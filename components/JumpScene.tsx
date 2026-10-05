"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { JumpEvent, JumpScene as SceneData } from "@/lib/types";

// Strategy 11 "Breakaway Alts": one lane per altcoin (x), the last 120 days running toward the viewer (z).
// Each lane is a seismograph of the coin's move after stripping out Bitcoin (in sigmas). When it pierces the
// jump plane, a spire rises and an arc traces the coin's own drift over the next days (green up, orange down);
// the gold segments are the days the book held it. Front row: today's readings (held coins glow, with days left).

const X_SPAN = 16;
const Z_SPAN = 12;
const Y_PER = 0.42;   // world units per sigma
const Y_MIN = -4;
const Y_MAX = 8;
const D_PER = 0.06;   // world units per % of drift
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const C_LANE = new THREE.Color("#1b9bd0");
const C_JUMP = new THREE.Color("#35f0c0");
const C_UP = new THREE.Color("#4dff8f");
const C_DOWN = new THREE.Color("#d96b25");
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
    const lanes = sc.x.map((_, i) => {
      const pts: [number, number, number][] = [];
      const heldSegs: [number, number, number][][] = [];
      let seg: [number, number, number][] = [];
      for (let j = 0; j < nz; j++) {
        const v = sc.y[j]?.[i];
        if (v === null || v === undefined) continue;
        const p: [number, number, number] = [xAt(i), yAt(v), zAt(j)];
        pts.push(p);
        if (sc.held?.[j]?.[i]) seg.push(p);
        else if (seg.length) { heldSegs.push(seg); seg = []; }
      }
      if (seg.length) heldSegs.push(seg);
      return { pts, heldSegs };
    });
    return { dx, dz, xAt, zAt, yAt, lanes, liveZ: zAt(nz + 3.5), nz };
  }, [sc]);
}

function Lanes({ sc }: { sc: SceneData }) {
  const { lanes } = useLayout(sc);
  return (
    <group>
      {lanes.map((l, i) => (
        <group key={sc.x[i]}>
          {l.pts.length > 1 && <Line points={l.pts} color={C_LANE} lineWidth={1} transparent opacity={0.55} />}
          {l.heldSegs.map((s, k) => s.length > 1 ? (
            <Line key={k} points={s} color={C_HELD.clone().multiplyScalar(2)} lineWidth={2.6} toneMapped={false} />
          ) : null)}
        </group>
      ))}
    </group>
  );
}

function Spire({ sc, ev, onHover }: { sc: SceneData; ev: JumpEvent; onHover: (e: JumpEvent | null) => void }) {
  const { xAt, zAt, yAt, dz } = useLayout(sc);
  const x = xAt(ev.i);
  const z0 = zAt(ev.j);
  const top = yAt(ev.z);
  const last = ev.drift_pct.length ? ev.drift_pct[ev.drift_pct.length - 1] : 0;
  const col = ev.drift_pct.length ? (last >= 0 ? C_UP : C_DOWN) : C_JUMP;
  const arc = useMemo(() => {
    const pts: [number, number, number][] = [[x, top, z0]];
    ev.drift_pct.forEach((d, h) => pts.push([x, top + clamp(d, -40, 80) * D_PER, z0 + dz * (h + 1)]));
    return pts;
  }, [x, top, z0, dz, ev.drift_pct]);
  return (
    <group>
      <mesh position={[x, top / 2, z0]} onPointerOver={(e) => { e.stopPropagation(); onHover(ev); }} onPointerOut={() => onHover(null)}>
        <coneGeometry args={[0.09, Math.max(0.05, top), 10]} />
        <meshBasicMaterial color={C_JUMP.clone().multiplyScalar(1.8)} toneMapped={false} transparent opacity={0.85} />
      </mesh>
      <mesh position={[x, top, z0]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshBasicMaterial color={col.clone().multiplyScalar(2.5)} toneMapped={false} />
      </mesh>
      {arc.length > 1 && <Line points={arc} color={col.clone().multiplyScalar(1.8)} lineWidth={2} toneMapped={false} />}
    </group>
  );
}

function ThresholdPlane({ sc }: { sc: SceneData }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const y = sc.threshold * Y_PER;
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.06 * (0.8 + 0.2 * Math.sin(clock.getElapsedTime() * 1.3));
  });
  return (
    <group>
      <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[X_SPAN + 0.4, Z_SPAN]} />
        <meshBasicMaterial ref={mat} color="#35f0c0" transparent opacity={0.06} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Html position={[X_SPAN / 2 + 0.5, y, -Z_SPAN / 2]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ color: "#35f0c0" }}>{sc.threshold}σ jump line</div>
      </Html>
    </group>
  );
}

function Live({ sc }: { sc: SceneData }) {
  const { xAt, liveZ, dx, yAt } = useLayout(sc);
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    g.current?.children.forEach((c, k) => { c.scale.x = c.scale.z = 1 + 0.15 * Math.sin(clock.getElapsedTime() * 2.4 + k); });
  });
  if (!sc.live) return null;
  return (
    <group ref={g}>
      {sc.x.map((coin, i) => {
        const l = sc.live?.[coin];
        const v = l ? l[sc.live_key ?? "z"] : undefined;
        if (!l || typeof v !== "number") return null;
        const h = Math.max(0.03, Math.abs(yAt(v)));
        const col = l.held ? C_HELD.clone().multiplyScalar(2.4) : (v >= sc.threshold ? C_JUMP : C_LANE).clone().multiplyScalar(1.3);
        return (
          <group key={coin} position={[xAt(i), 0, liveZ]}>
            <mesh position={[0, v >= 0 ? h / 2 : -h / 2, 0]}>
              <cylinderGeometry args={[dx * 0.2, dx * 0.2, h, 12]} />
              <meshBasicMaterial color={col} toneMapped={false} transparent opacity={l.held ? 0.95 : 0.5} />
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
    sc.avg_drift_pct !== null && sc.avg_drift_pct !== undefined ? `avg ${sc.hold_days}-day drift after a jump ${sc.avg_drift_pct > 0 ? "+" : ""}${sc.avg_drift_pct}%` : null,
    sc.hit_rate_pct !== null && sc.hit_rate_pct !== undefined ? `${sc.hit_rate_pct}% of jumps kept rising` : null,
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
      <Html position={[0, Y_MAX * Y_PER * 0.95, -Z_SPAN / 2 - 1.2]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title">{(sc.title ?? "").toUpperCase()}</div>
        {sub && <div className="scene-label scene-label--axis" style={{ textAlign: "center" }}>{sub}</div>}
      </Html>
      <Line points={[[x0, 0, -Z_SPAN / 2], [x0, 0, liveZ + 0.3]]} color="#2b3658" lineWidth={1} />
    </group>
  );
}

function Tooltip({ sc, ev }: { sc: SceneData; ev: JumpEvent }) {
  const { xAt, zAt, yAt } = useLayout(sc);
  const x = xAt(ev.i);
  const last = ev.drift_pct.length ? ev.drift_pct[ev.drift_pct.length - 1] : null;
  return (
    <Html position={[x, yAt(ev.z) + 0.3, zAt(ev.j)]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${x > 3 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">{sc.x[ev.i]} · {sc.z[ev.j]}</div>
        <div className="tooltip__row"><span>jump beyond Bitcoin</span><b>{ev.jump_pct > 0 ? "+" : ""}{ev.jump_pct}%</b></div>
        <div className="tooltip__row"><span>size</span><b>{ev.z.toFixed(1)}σ</b></div>
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

export default function JumpScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<JumpEvent | null>(null);
  const [spin, setSpin] = useState(true);
  return (
    <Canvas camera={{ position: [9, 9, 15], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#04080b")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#04080b", 20, 60]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 12, 8]} intensity={1.4} color="#e8fff8" />
      <pointLight position={[-8, 4, 6]} intensity={28} color="#35f0c0" />
      <Stars radius={60} depth={30} count={1800} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={100} scale={[20, 6, 14]} size={1.5} speed={0.35} opacity={0.3} color="#35f0c0" />
      <group position={[0, -1.0, 0]}>
        <Lanes sc={scene} />
        <ThresholdPlane sc={scene} />
        {scene.events.map((ev, k) => <Spire key={k} sc={scene} ev={ev} onHover={setHover} />)}
        <Live sc={scene} />
        <Axes sc={scene} />
        {hover && <Tooltip sc={scene} ev={hover} />}
      </group>
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
