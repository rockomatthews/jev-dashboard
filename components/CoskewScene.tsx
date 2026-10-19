"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { CoskewCoin, CoskewScene as SceneData } from "@/lib/types";

// Strategy 29 "Coskewness": how each alt fares when Bitcoin makes a BIG move (either way).
// x = altcoins, sorted from "hates the swings" (left, low coskewness: does worst on big BTC moves, the book is paid
// to hold these) to "loves the swings" (right, high coskewness: convex, lottery-like, the book shorts these);
// z = the last 16 Monday decisions (oldest at the back, this week at the front); bar height = coskewness.
// Green = held long that week, orange = held short. Above floats Bitcoin's "swing smile" (the m^2 curve the
// statistic weighs by): a glowing BTC orb swings along it, and the swing-loving coins flare as it reaches the edges.

const X_SPAN = 17;
const Z_STEP = 0.75;
const H_PER = 4.2; // world units per unit of coskewness
const C_LONG = new THREE.Color("#4dff8f");
const C_SHORT = new THREE.Color("#ff7a3d");
const C_FLAT = new THREE.Color("#4a5c8f");

type Cell = { coin: string; week: string; wi: number; x: number; z: number; c: CoskewCoin; front: boolean };

function useLayout(sc: SceneData) {
  return useMemo(() => {
    const weeks = (sc.weeks ?? []).slice(-16);
    const lastW = weeks.length ? weeks[weeks.length - 1] : null;
    const now: Record<string, { cs: number; side: number }> =
      sc.live && Object.keys(sc.live).length ? sc.live : (lastW ? lastW.coins : {});
    const coins = Object.keys(now).sort((a, b) => now[a].cs - now[b].cs || a.localeCompare(b));
    const n = coins.length;
    const xOf = (i: number) => -X_SPAN / 2 + (n > 1 ? (X_SPAN * i) / (n - 1) : 0);
    const cells: Cell[] = [];
    weeks.forEach((w, wi) => {
      const front = wi === weeks.length - 1;
      coins.forEach((coin, i) => {
        const c = front && sc.live && sc.live[coin] ? { ...w.coins[coin], ...sc.live[coin] } : w.coins[coin];
        if (!c) return;
        cells.push({ coin, week: w.t, wi, x: xOf(i), z: (wi - (weeks.length - 1)) * Z_STEP + 3, c, front });
      });
    });
    return { weeks, coins, xOf, cells, now };
  }, [sc]);
}

function Bar({ cell, onHover, flare }: { cell: Cell; onHover: (c: Cell | null) => void; flare: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const v = Math.max(-0.6, Math.min(1.6, cell.c.cs));
  const h = Math.max(0.04, Math.abs(v) * H_PER);
  const col = cell.c.side > 0 ? C_LONG : cell.c.side < 0 ? C_SHORT : C_FLAT;
  const w = cell.front ? 0.5 : 0.3;
  const base = cell.front ? 1.7 : 0.55 + 0.04 * cell.wi;
  useFrame(() => {
    if (!mat.current || !cell.front) return;
    // swing-loving (high coskew) coins flare when the BTC orb is at the edge of its swing
    const k = 1 + Math.max(0, v) * 0.9 * flare.current;
    mat.current.color.copy(col).multiplyScalar(base * k);
  });
  return (
    <mesh ref={ref} position={[cell.x, v >= 0 ? h / 2 : -h / 2, cell.z]}
      onPointerOver={(e) => { e.stopPropagation(); onHover(cell); }} onPointerOut={() => onHover(null)}>
      <boxGeometry args={[w, h, w]} />
      <meshBasicMaterial ref={mat} color={col.clone().multiplyScalar(base)} toneMapped={false}
        transparent opacity={cell.front ? 1 : 0.18 + 0.045 * cell.wi} />
    </mesh>
  );
}

function Smile({ flare }: { flare: React.MutableRefObject<number> }) {
  const orb = useRef<THREE.Mesh>(null);
  const pts = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let i = 0; i <= 60; i++) {
      const u = -1 + (2 * i) / 60;
      out.push([u * X_SPAN * 0.45, 8.4 + 2.6 * u * u, -9.5]);
    }
    return out;
  }, []);
  useFrame(({ clock }) => {
    const u = Math.sin(clock.getElapsedTime() * 0.7);
    flare.current = u * u * u * u;
    if (orb.current) orb.current.position.set(u * X_SPAN * 0.45, 8.4 + 2.6 * u * u, -9.5);
  });
  return (
    <group>
      <Line points={pts} color="#ffd36b" lineWidth={1.6} transparent opacity={0.75} />
      <mesh ref={orb}>
        <sphereGeometry args={[0.45, 24, 24]} />
        <meshBasicMaterial color={new THREE.Color("#ffb72b").multiplyScalar(2.4)} toneMapped={false} />
      </mesh>
      <Html position={[0, 7.6, -9.5]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9, color: "#ffd36b", textAlign: "center" }}>
          Bitcoin&apos;s big swings (either way)
        </div>
      </Html>
    </group>
  );
}

function CoinLabels({ coins, xOf, now }: { coins: string[]; xOf: (i: number) => number; now: Record<string, { cs: number; side: number }> }) {
  return (
    <group>
      {coins.map((c, i) => (
        <Html key={c} position={[xOf(i), -0.45, 3.6]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label" style={{ fontSize: 9, color: now[c]?.side > 0 ? "#7dffad" : now[c]?.side < 0 ? "#ffa36e" : "#9fb0d8" }}>
            {c}
          </div>
        </Html>
      ))}
      <Html position={[-X_SPAN / 2 - 0.6, 0.6, 3.6]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9, textAlign: "right" }}>← hates BTC&apos;s big swings</div>
      </Html>
      <Html position={[X_SPAN / 2 + 0.9, 0.6, 3.6]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9 }}>loves them →</div>
      </Html>
    </group>
  );
}

function Floor({ nWeeks }: { nWeeks: number }) {
  const z0 = 3 - (nWeeks - 1) * Z_STEP - 0.4;
  return (
    <group>
      <Line points={[[-X_SPAN / 2 - 0.5, 0, 3.4], [X_SPAN / 2 + 0.5, 0, 3.4]]} color="#8fa3d9" lineWidth={1.2} transparent opacity={0.6} />
      <Line points={[[-X_SPAN / 2 - 0.5, 0, z0], [X_SPAN / 2 + 0.5, 0, z0]]} color="#8fa3d9" lineWidth={0.8} transparent opacity={0.3} />
      <Html position={[-X_SPAN / 2 - 1.2, 0, z0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9 }}>{nWeeks} weeks ago</div>
      </Html>
    </group>
  );
}

function Tooltip({ cell }: { cell: Cell }) {
  const v = cell.c.cs;
  const y = (v >= 0 ? v : 0) * H_PER;
  return (
    <Html position={[cell.x, y, cell.z]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${cell.x > 3 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">{cell.coin} · week of {cell.week}</div>
        <div className="tooltip__row"><span>coskewness with BTC</span><b>{v.toFixed(2)}</b></div>
        <div className="tooltip__row"><span>position</span><b>{cell.c.side > 0 ? "long" : cell.c.side < 0 ? "short" : "none"}</b></div>
        {cell.c.fwd !== undefined && cell.c.fwd !== null && (
          <div className="tooltip__row"><span>that week</span><b>{cell.c.fwd > 0 ? "+" : ""}{cell.c.fwd}%</b></div>
        )}
      </div>
    </Html>
  );
}

function Title({ sc, coins, now }: { sc: SceneData; coins: string[]; now: Record<string, { cs: number; side: number }> }) {
  const longs = coins.filter((c) => now[c]?.side > 0).join(" ");
  const shorts = coins.filter((c) => now[c]?.side < 0).join(" ");
  return (
    <Html position={[0, 13.2, -9.5]} center style={{ pointerEvents: "none" }}>
      <div className="scene-title">{(sc.title ?? "Coskewness").toUpperCase()}</div>
      <div className="scene-label scene-label--axis" style={{ textAlign: "center", maxWidth: 560 }}>
        {sc.window_days}-day coskewness with Bitcoin · long the {sc.k} that hate big swings (paid to hold them), short the {sc.k} that love them
        {sc.leverage ? ` · ${sc.leverage}x` : ""}<br />
        <span style={{ color: "#7dffad" }}>LONG {longs || "-"}</span> · <span style={{ color: "#ffa36e" }}>SHORT {shorts || "-"}</span>
      </div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 26 * Math.max(1, 1.6 / aspect);
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function CoskewScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<Cell | null>(null);
  const [spin, setSpin] = useState(true);
  const flare = useRef(0);
  const { weeks, coins, xOf, cells, now } = useLayout(scene);
  return (
    <Canvas camera={{ position: [0, 10, 19], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05080d")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#05080d", 26, 66]} />
      <ambientLight intensity={0.4} />
      <Stars radius={60} depth={30} count={1800} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={80} scale={[22, 10, 16]} size={1.4} speed={0.25} opacity={0.3} color="#ffd36b" />
      <group position={[0, -2.6, 0]}>
        <Floor nWeeks={weeks.length} />
        {cells.map((c) => <Bar key={`${c.week}-${c.coin}`} cell={c} onHover={setHover} flare={flare} />)}
        <CoinLabels coins={coins} xOf={xOf} now={now} />
        <Smile flare={flare} />
        <Title sc={scene} coins={coins} now={now} />
        {hover && <Tooltip cell={hover} />}
      </group>
      <OrbitControls target={[0, 1, -1]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.25}
        minPolarAngle={Math.PI / 7} maxPolarAngle={Math.PI / 2.1} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.0} luminanceThreshold={0.35} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
