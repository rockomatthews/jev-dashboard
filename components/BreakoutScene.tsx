"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ChannelLane, ChannelScene } from "@/lib/types";

// Strategy 6 "Breakout canyons": one lane per coin, stacked in depth.
// x = the last 90 days (today on the right) · y = price inside its own 90-day range
// outer translucent wall = 90-day Donchian channel · inner bright wall = 20-day channel
// gold flares = breakouts that fired (bigger = longer lookback) · orange rings = trailing-stop exits
// right end: nine "breakout lights" (5 → 360 days, bottom to top) and a pillar for today's weight.

const X_SPAN = 18;
const LANE_GAP = 1.7;
const LANE_H = 2.4;

const C_LONG = new THREE.Color("#ffc94d");
const C_FLAT = new THREE.Color("#5b7bb0");
const C_OUTER = new THREE.Color("#6d4bd8");
const C_INNER = new THREE.Color("#35f0c0");
const C_EXIT = new THREE.Color("#ff7a3d");
const C_OFF = new THREE.Color("#1c2236");

type Pt = { x: number; y: number } | null;

function laneScale(l: ChannelLane) {
  const vals = [...l.close, ...l.upper90, ...l.lower90, ...l.upper20, ...l.lower20].filter((v): v is number => v !== null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = Math.max(1e-6, hi - lo);
  return (v: number | null) => (v === null ? null : ((v - lo) / span) * LANE_H);
}

function xAt(i: number, n: number) {
  return -X_SPAN / 2 + (X_SPAN * i) / Math.max(1, n - 1);
}

/** Filled band between two series (null-safe: gaps break the band). */
function Band({ upper, lower, z, color, opacity }: { upper: Pt[]; lower: Pt[]; z: number; color: THREE.Color; opacity: number }) {
  const geom = useMemo(() => {
    const pos: number[] = [];
    for (let i = 0; i < upper.length - 1; i++) {
      const a = upper[i], b = upper[i + 1], c = lower[i], d = lower[i + 1];
      if (!a || !b || !c || !d) continue;
      pos.push(a.x, a.y, z, c.x, c.y, z, b.x, b.y, z);
      pos.push(b.x, b.y, z, c.x, c.y, z, d.x, d.y, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [upper, lower, z]);
  const edgeU = upper.filter((p): p is { x: number; y: number } => p !== null).map((p) => [p.x, p.y, z] as [number, number, number]);
  const edgeL = lower.filter((p): p is { x: number; y: number } => p !== null).map((p) => [p.x, p.y, z] as [number, number, number]);
  const edge = color.clone().multiplyScalar(1.6);
  return (
    <group>
      <mesh geometry={geom}>
        <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false}
          blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {edgeU.length > 1 && <Line points={edgeU} color={edge} lineWidth={1} transparent opacity={0.7} toneMapped={false} />}
      {edgeL.length > 1 && <Line points={edgeL} color={edge} lineWidth={1} transparent opacity={0.7} toneMapped={false} />}
    </group>
  );
}

/** A scanning beam sweeps from 90 days ago to today; flares pop as it passes their day. */
function useBeam() {
  const beam = useRef(0);
  useFrame(({ clock }) => {
    beam.current = ((clock.getElapsedTime() * 0.12) % 1.15) - 0.05; // 0..1 of the window, short pause at the end
  });
  return beam;
}

function Flares({ lane, n, z, sy, beam }: {
  lane: ChannelLane; n: number; z: number; sy: (v: number | null) => number | null; beam: React.MutableRefObject<number>;
}) {
  const group = useRef<THREE.Group>(null);
  const items = useMemo(() => lane.events.map((e) => {
    const y = sy(lane.close[e.i] ?? null);
    return { ...e, x: xAt(e.i, n), y: y ?? 0, f: e.i / Math.max(1, n - 1) };
  }), [lane, n, sy]);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.getElapsedTime();
    group.current.children.forEach((child, k) => {
      const it = items[k];
      if (!it) return;
      const d = beam.current - it.f;
      const pop = d >= 0 && d < 0.06 ? 1 + 2.2 * (1 - d / 0.06) : 1; // flash as the beam passes
      const base = it.kind === "entry" ? 0.6 + 0.4 * Math.sin(t * 2 + k) * 0.25 : 1;
      child.scale.setScalar(pop * base);
      if (it.kind === "exit") child.rotation.z = t * 1.5;
    });
  });
  return (
    <group ref={group}>
      {items.map((e, k) => {
        const size = 0.05 + 0.03 * Math.log2(e.L / 5 + 1);
        return e.kind === "entry" ? (
          <mesh key={k} position={[e.x, e.y + size * 1.2, z]}>
            <coneGeometry args={[size, size * 3, 10]} />
            <meshBasicMaterial color={C_LONG.clone().multiplyScalar(2.4)} toneMapped={false} />
          </mesh>
        ) : (
          <mesh key={k} position={[e.x, e.y, z]}>
            <torusGeometry args={[size * 1.3, size * 0.25, 8, 20]} />
            <meshBasicMaterial color={C_EXIT.clone().multiplyScalar(2)} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}

function SignalStack({ lane, z, maxW, hovered }: { lane: ChannelLane; z: number; maxW: number; hovered: boolean }) {
  const x0 = X_SPAN / 2 + 0.75;
  const pillar = useRef<THREE.Mesh>(null);
  const h = Math.max(0.03, (Math.abs(lane.weight) / Math.max(1e-6, maxW)) * LANE_H * 1.1);
  useFrame(({ clock }) => {
    if (pillar.current) (pillar.current.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.25 * Math.sin(clock.getElapsedTime() * 2 + z);
  });
  return (
    <group position={[x0, 0, z]}>
      {lane.lights.map((on, k) => (
        <mesh key={k} position={[0, 0.12 + k * 0.26, 0]}>
          <boxGeometry args={[0.32, 0.18, 0.32]} />
          <meshBasicMaterial color={on ? C_LONG.clone().multiplyScalar(1.4 + k * 0.12) : C_OFF} toneMapped={false} />
        </mesh>
      ))}
      <mesh ref={pillar} position={[0.55, h / 2, 0]}>
        <boxGeometry args={[0.22, h, 0.22]} />
        <meshBasicMaterial color={C_INNER.clone().multiplyScalar(1.6)} transparent opacity={0.7} toneMapped={false} />
      </mesh>
      <Html position={[1.05, 0.25, 0]} style={{ pointerEvents: "none" }}>
        <div className={`scene-label scene-label--lane ${lane.signal > 0 ? "scene-label--held" : ""} ${hovered ? "scene-label--hot" : ""}`}>
          <span className="scene-label__coin">{lane.coin}</span>
          <span>{Math.round(lane.signal * 9)}/9 · {(lane.weight * 100).toFixed(1)}%</span>
        </div>
      </Html>
    </group>
  );
}

function LaneView({ lane, z, maxW, beam, hovered, onHover }: {
  lane: ChannelLane; z: number; maxW: number; beam: React.MutableRefObject<number>; hovered: boolean; onHover: (c: string | null) => void;
}) {
  const n = lane.close.length;
  const sy = useMemo(() => laneScale(lane), [lane]);
  const pts = (arr: (number | null)[]): Pt[] => arr.map((v, i) => { const y = sy(v); return y === null ? null : { x: xAt(i, n), y }; });
  const close = useMemo(() => pts(lane.close), [lane, sy]); // eslint-disable-line react-hooks/exhaustive-deps
  const u90 = useMemo(() => pts(lane.upper90), [lane, sy]); // eslint-disable-line react-hooks/exhaustive-deps
  const l90 = useMemo(() => pts(lane.lower90), [lane, sy]); // eslint-disable-line react-hooks/exhaustive-deps
  const u20 = useMemo(() => pts(lane.upper20), [lane, sy]); // eslint-disable-line react-hooks/exhaustive-deps
  const l20 = useMemo(() => pts(lane.lower20), [lane, sy]); // eslint-disable-line react-hooks/exhaustive-deps
  const line = close.filter((p): p is { x: number; y: number } => p !== null).map((p) => [p.x, p.y, z + 0.02] as [number, number, number]);
  const long = lane.signal > 0;
  const col = (long ? C_LONG : C_FLAT).clone().multiplyScalar(hovered ? 3 : long ? 2.2 : 1.2);
  const last = close[close.length - 1];
  return (
    <group>
      <Band upper={u90} lower={l90} z={z - 0.03} color={C_OUTER} opacity={hovered ? 0.2 : 0.1} />
      <Band upper={u20} lower={l20} z={z} color={C_INNER} opacity={hovered ? 0.16 : 0.07} />
      {line.length > 1 && <Line points={line} color={col} lineWidth={hovered ? 3 : 2} toneMapped={false} />}
      {last && (
        <mesh position={[last.x, last.y, z + 0.03]}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <meshBasicMaterial color={col} toneMapped={false} />
        </mesh>
      )}
      <Flares lane={lane} n={n} z={z + 0.04} sy={sy} beam={beam} />
      <SignalStack lane={lane} z={z} maxW={maxW} hovered={hovered} />
      {/* invisible hit plate for hover */}
      <mesh position={[0, LANE_H / 2, z]} onPointerOver={(e) => { e.stopPropagation(); onHover(lane.coin); }} onPointerOut={() => onHover(null)}>
        <planeGeometry args={[X_SPAN + 1, LANE_H + 0.4]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Beam({ beam, depth }: { beam: React.MutableRefObject<number>; depth: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!ref.current) return;
    const f = Math.min(1, Math.max(0, beam.current));
    ref.current.position.x = -X_SPAN / 2 + X_SPAN * f;
    (ref.current.material as THREE.MeshBasicMaterial).opacity = beam.current > 1 ? 0 : 0.12;
  });
  return (
    <mesh ref={ref} position={[0, LANE_H / 2, -depth / 2 + LANE_GAP / 2]} rotation={[0, Math.PI / 2, 0]}>
      <planeGeometry args={[depth + LANE_GAP, LANE_H + 1.2]} />
      <meshBasicMaterial color={C_INNER} transparent opacity={0.12} depthWrite={false} side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

function Tooltip({ lane, z }: { lane: ChannelLane; z: number }) {
  const lastC = lane.close[lane.close.length - 1];
  const u20 = lane.upper20[lane.upper20.length - 1];
  const u90 = lane.upper90[lane.upper90.length - 1];
  const dist = (u: number | null) => (u === null || lastC === null ? "—" : `${((Math.exp(lastC - u) - 1) * 100).toFixed(1)}%`);
  const entries = lane.events.filter((e) => e.kind === "entry").length;
  const exits = lane.events.length - entries;
  return (
    <Html position={[-X_SPAN / 2, LANE_H + 0.4, z]} style={{ pointerEvents: "none" }}>
      <div className="tooltip">
        <div className="tooltip__time">{lane.coin} · last 90 days</div>
        <div className="tooltip__row"><span>Systems long</span><b>{Math.round(lane.signal * 9)} of 9</b></div>
        <div className="tooltip__row"><span>Weight today</span><b>{(lane.weight * 100).toFixed(1)}% of equity</b></div>
        <div className="tooltip__row"><span>vs 20-day high</span><b>{dist(u20)}</b></div>
        <div className="tooltip__row"><span>vs 90-day high</span><b>{dist(u90)}</b></div>
        <div className="tooltip__row"><span>Breakouts / exits</span><b>{entries} / {exits}</b></div>
      </div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 22 * Math.max(1, 1.7 / aspect);
    const dir = camera.position.clone().normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function Canyons({ sc }: { sc: ChannelScene }) {
  const beam = useBeam();
  const [hover, setHover] = useState<string | null>(null);
  const lanes = sc.lanes;
  const depth = (lanes.length - 1) * LANE_GAP;
  const zAt = (k: number) => depth / 2 - k * LANE_GAP; // strongest signal in front
  const maxW = Math.max(1e-6, ...lanes.map((l) => Math.abs(l.weight)));
  return (
    <group position={[-0.8, -LANE_H / 2 + 0.2, 0]}>
      {lanes.map((l, k) => (
        <LaneView key={l.coin} lane={l} z={zAt(k)} maxW={maxW} beam={beam} hovered={hover === l.coin} onHover={setHover} />
      ))}
      <Beam beam={beam} depth={depth} />
      {hover && <Tooltip lane={lanes.find((l) => l.coin === hover)!} z={zAt(lanes.findIndex((l) => l.coin === hover))} />}
      <Html position={[-X_SPAN / 2, -0.35, depth / 2 + 0.9]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis">90 days ago</div>
      </Html>
      <Html position={[X_SPAN / 2, -0.35, depth / 2 + 0.9]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis">today ({sc.last_day})</div>
      </Html>
      <Html position={[X_SPAN / 2 + 0.75, LANE_H + 0.75, depth / 2]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title">BREAKOUT LIGHTS<br />5d ↑ 360d</div>
      </Html>
      <Html position={[0, LANE_H + 1.5, -depth / 2]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title scene-title--rocket">
          BREAKOUT CANYONS · book ×{sc.scale.toFixed(2)} · {sc.gross.toFixed(2)}x gross of {sc.gross_cap}x · target vol {sc.target_vol_pct}%
        </div>
      </Html>
      <Line points={[[-X_SPAN / 2, -0.05, depth / 2 + 0.5], [X_SPAN / 2, -0.05, depth / 2 + 0.5]]} color="#2b3658" lineWidth={1} />
    </group>
  );
}

export default function BreakoutScene({ scene, active = true }: { scene: ChannelScene; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [spin, setSpin] = useState(true);
  return (
    <Canvas
      camera={{ position: [7, 7.5, 18], fov: 40 }}
      dpr={[1, 2]}
      frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#07050f")}
      onPointerDown={() => setSpin(false)}
    >
      <CameraFit />
      <fog attach="fog" args={["#07050f", 22, 60]} />
      <ambientLight intensity={0.4} />
      <Stars radius={60} depth={30} count={2000} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={110} scale={[22, 8, 16]} size={1.6} speed={0.35} opacity={0.35} color="#ffc94d" />
      <Canyons sc={scene} />
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.25}
        minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.1} minAzimuthAngle={-Math.PI / 2.2} maxAzimuthAngle={Math.PI / 2.2}
        rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.2} luminanceThreshold={0.3} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
