"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitCoin, OrbitScene as SceneData } from "@/lib/types";

// Strategy 19 "Residual Momentum": Bitcoin is the sun. Every altcoin orbits it at a distance set by its beta - the
// harder Bitcoin pulls a coin (high beta), the closer it flies. Height is what is left after Bitcoin is stripped
// out: the coin's 20-day residual t-stat. The book buys the 3 highest planets (green) and shorts the 3 lowest
// (orange). Comet tails trace each coin's last 16 Monday readings.

const R_MIN = 2.2;    // radius for the highest beta
const R_PER = 1.9;    // world units per unit of beta (inverted: high beta = close)
const B_LO = -0.5;
const B_HI = 2.5;
const Y_PER = 0.32;   // world units per unit of residual t-stat
const S_LIM = 12;
const TRAIL_STEP = 0.045; // radians each older week trails behind
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const C_LONG = new THREE.Color("#4dff8f");
const C_SHORT = new THREE.Color("#ff7a3d");
const C_IDLE = new THREE.Color("#5b7bd6");
const C_SUN = new THREE.Color("#ffb52e");

type Planet = { coin: string; angle: number; now: OrbitCoin; trail: [number, number, number][]; last: number | null };

const radius = (b: number | null | undefined) => R_MIN + R_PER * (B_HI - clamp(typeof b === "number" ? b : 1, B_LO, B_HI));
const height = (s: number) => clamp(s, -S_LIM, S_LIM) * Y_PER;
const pos = (angle: number, b: number | null | undefined, s: number): [number, number, number] => {
  const r = radius(b);
  return [r * Math.cos(angle), height(s), r * Math.sin(angle)];
};
const colorOf = (side: number) => (side > 0 ? C_LONG : side < 0 ? C_SHORT : C_IDLE);

function usePlanets(sc: SceneData): Planet[] {
  return useMemo(() => {
    const weeks = sc.weeks ?? [];
    const lastWeek = weeks.length ? weeks[weeks.length - 1] : null;
    const coins = Array.from(new Set([...Object.keys(lastWeek?.coins ?? {}), ...Object.keys(sc.live ?? {})])).sort();
    const done = weeks.length >= 2 ? weeks[weeks.length - 2].t : null;
    return coins.map((coin, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, coins.length);
      const now = sc.live?.[coin] ?? lastWeek?.coins[coin] ?? { s: 0, b: 1, side: 0 };
      const trail: [number, number, number][] = [];
      weeks.forEach((w, j) => {
        const c = w.coins[coin];
        if (!c) return;
        const back = weeks.length - 1 - j;
        trail.push(pos(angle - back * TRAIL_STEP, c.b, c.s));
      });
      trail.push(pos(angle, now.b, now.s));
      const lastMove = done ? sc.next_week_resid_pct?.[done]?.[coin] : undefined;
      return { coin, angle, now, trail, last: typeof lastMove === "number" ? lastMove : null };
    });
  }, [sc]);
}

function Sun() {
  const core = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (core.current) core.current.rotation.y = t * 0.2;
    if (halo.current) halo.current.scale.setScalar(1 + 0.08 * Math.sin(t * 1.6));
  });
  return (
    <group>
      <mesh ref={core}>
        <icosahedronGeometry args={[0.75, 3]} />
        <meshBasicMaterial color={C_SUN.clone().multiplyScalar(2.2)} toneMapped={false} />
      </mesh>
      <mesh ref={halo}>
        <sphereGeometry args={[1.15, 32, 32]} />
        <meshBasicMaterial color={C_SUN} transparent opacity={0.12} depthWrite={false} toneMapped={false} />
      </mesh>
      <pointLight intensity={40} color="#ffcf7a" distance={30} />
      <Html position={[0, -1.15, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ color: "#ffcf7a", textAlign: "center" }}>
          BITCOIN<br />(its pull is removed)
        </div>
      </Html>
    </group>
  );
}

function Rings() {
  const rings = [0, 0.5, 1, 1.5, 2].map((b) => {
    const r = radius(b);
    const pts: [number, number, number][] = [];
    for (let k = 0; k <= 96; k++) {
      const a = (2 * Math.PI * k) / 96;
      pts.push([r * Math.cos(a), 0, r * Math.sin(a)]);
    }
    return { b, r, pts };
  });
  const outer = radius(B_LO) + 0.4;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[outer, 96]} />
        <meshBasicMaterial color="#1b2a55" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {rings.map((g) => (
        <group key={g.b}>
          <Line points={g.pts} color="#2d3f75" lineWidth={1} transparent opacity={0.6} />
          <Html position={[g.r, 0.05, 0]} center style={{ pointerEvents: "none" }}>
            <div className="scene-label scene-label--axis" style={{ fontSize: 9 }}>β {g.b}</div>
          </Html>
        </group>
      ))}
    </group>
  );
}

function PlanetView({ p, onHover }: { p: Planet; onHover: (p: Planet | null) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const [x, y, z] = pos(p.angle, p.now.b, p.now.s);
  const held = p.now.side !== 0;
  const col = colorOf(p.now.side);
  useFrame(({ clock }) => {
    if (ref.current && held) ref.current.scale.setScalar(1 + 0.18 * Math.sin(clock.getElapsedTime() * 2.4 + p.angle * 3));
  });
  return (
    <group>
      <Line points={p.trail} color={col.clone().multiplyScalar(held ? 1.6 : 0.8)} lineWidth={held ? 2 : 1}
        transparent opacity={held ? 0.9 : 0.45} />
      <Line points={[[x, 0, z], [x, y, z]]} color={col} lineWidth={1} transparent opacity={0.35} dashed dashSize={0.08} gapSize={0.06} />
      <mesh ref={ref} position={[x, y, z]} onPointerOver={(e) => { e.stopPropagation(); onHover(p); }} onPointerOut={() => onHover(null)}>
        <sphereGeometry args={[held ? 0.26 : 0.15, 24, 24]} />
        <meshBasicMaterial color={col.clone().multiplyScalar(held ? 2.6 : 1.1)} toneMapped={false} />
      </mesh>
      <Html position={[x, y + (held ? 0.55 : 0.32), z]} center style={{ pointerEvents: "none" }}>
        {held ? (
          <div className="scene-label scene-label--held">
            <span className="scene-label__coin" style={{ color: p.now.side > 0 ? "#7dffad" : "#ffa36e" }}>{p.coin}</span>
            <span>{p.now.side > 0 ? "LONG" : "SHORT"} · {p.now.s > 0 ? "+" : ""}{p.now.s.toFixed(1)}</span>
          </div>
        ) : (
          <div className="scene-label scene-label--axis" style={{ fontSize: 10 }}>{p.coin}</div>
        )}
      </Html>
    </group>
  );
}

function Tooltip({ p }: { p: Planet }) {
  const [x, y, z] = pos(p.angle, p.now.b, p.now.s);
  return (
    <Html position={[x, y, z]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${x > 2 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">{p.coin}</div>
        <div className="tooltip__row"><span>residual score</span><b>{p.now.s > 0 ? "+" : ""}{p.now.s.toFixed(2)}</b></div>
        <div className="tooltip__row"><span>beta to Bitcoin</span><b>{typeof p.now.b === "number" ? p.now.b.toFixed(2) : "-"}</b></div>
        <div className="tooltip__row"><span>this week</span><b>{p.now.side > 0 ? "long" : p.now.side < 0 ? "short" : "not held"}</b></div>
        {p.last !== null && (
          <div className="tooltip__row"><span>last week ex-BTC</span><b>{p.last > 0 ? "+" : ""}{p.last}%</b></div>
        )}
      </div>
    </Html>
  );
}

function Title({ sc, planets }: { sc: SceneData; planets: Planet[] }) {
  const weeks = sc.weeks ?? [];
  const done = weeks.length >= 2 ? weeks[weeks.length - 2] : null;
  let sub = `long top ${sc.k} · short bottom ${sc.k} · ${sc.lookback_days}-day residual t-stat${sc.leverage ? ` · ${sc.leverage}x` : ""}`;
  if (done) {
    const mv = sc.next_week_resid_pct?.[done.t] ?? {};
    const L = Object.entries(done.coins).filter(([, c]) => c.side > 0).map(([k]) => mv[k]).filter((v): v is number => typeof v === "number");
    const S = Object.entries(done.coins).filter(([, c]) => c.side < 0).map(([k]) => mv[k]).filter((v): v is number => typeof v === "number");
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    if (L.length && S.length) {
      const spread = avg(L) - avg(S);
      sub += ` · week of ${done.t.slice(5)}: longs ${avg(L) > 0 ? "+" : ""}${avg(L).toFixed(1)}% vs shorts ${avg(S) > 0 ? "+" : ""}${avg(S).toFixed(1)}% ex-BTC (${spread > 0 ? "+" : ""}${spread.toFixed(1)} pts)`;
    }
  }
  const top = Math.max(1.5, ...planets.map((p) => pos(p.angle, p.now.b, p.now.s)[1])) + 1.4;
  return (
    <Html position={[0, top, 0]} center style={{ pointerEvents: "none" }}>
      <div className="scene-title">{(sc.title ?? "Residual Momentum").toUpperCase()}</div>
      <div className="scene-label scene-label--axis" style={{ textAlign: "center", maxWidth: 520 }}>{sub}</div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 20 * Math.max(1, 1.6 / aspect);
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function OrbitScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<Planet | null>(null);
  const [spin, setSpin] = useState(true);
  const planets = usePlanets(scene);
  return (
    <Canvas camera={{ position: [0, 9, 16], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#04060f")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#04060f", 22, 60]} />
      <ambientLight intensity={0.35} />
      <Stars radius={60} depth={30} count={2200} factor={3} saturation={0} fade speed={0.5} />
      <Sparkles count={140} scale={[18, 8, 18]} size={1.4} speed={0.25} opacity={0.3} color="#ffcf7a" />
      <group position={[0, -0.6, 0]}>
        <Sun />
        <Rings />
        {planets.map((p) => <PlanetView key={p.coin} p={p} onHover={setHover} />)}
        <Title sc={scene} planets={planets} />
        {hover && <Tooltip p={hover} />}
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.35}
        minPolarAngle={Math.PI / 7} maxPolarAngle={Math.PI / 2.05} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.1} luminanceThreshold={0.35} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
