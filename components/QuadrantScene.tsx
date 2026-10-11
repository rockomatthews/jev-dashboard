"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { QuadrantCoin, QuadrantScene as SceneData } from "@/lib/types";

// Strategy 21 "Turning Points": every coin stands on a floor split by two trend clocks. Left/right is the fast
// (14-day) trend, back/front is the slow (90-day) trend. The four quadrants are the paper's market states:
// Bull (both up), Bear (both down), Correction (slow up, fast down) and Rebound (slow down, fast up). Each coin is a
// pillar whose height is its position in the book - green long, orange short. At the turning points the book
// leans the way history says, shown on the quadrant's sign. A ribbon at the back shows how the 22 coins have been
// spread across the four states over the last 180 days.

const HALF = 6.5;
const H_PER = 55;    // world units per unit of book weight
// signed square-root squash so +5% and +150% both fit
const squash = (pct: number, ref: number) => Math.sign(pct) * Math.min(1, Math.sqrt(Math.abs(pct) / ref)) * HALF;

const STATE_COL: Record<number, string> = { 1: "#3ddc84", 2: "#ff6b4a", 3: "#ffc94d", 4: "#5cc3ee" };
const STATE_NAME: Record<number, string> = { 1: "BULL", 2: "BEAR", 3: "CORRECTION", 4: "REBOUND" };
const C_LONG = new THREE.Color("#4dff8f");
const C_SHORT = new THREE.Color("#ff7a3d");
const C_FLAT = new THREE.Color("#6b7aa8");

type Pillar = { q: QuadrantCoin; x: number; z: number; h: number };

function usePillars(sc: SceneData): Pillar[] {
  return useMemo(() => (sc.coins ?? []).map((q) => ({
    q,
    x: squash(q.fast, 40),
    z: -squash(q.slow, 150),   // slow up = towards the back
    h: Math.max(0.06, Math.abs(q.w) * H_PER),
  })), [sc]);
}

function Floor({ sc }: { sc: SceneData }) {
  const quads = [
    { s: 1, x: HALF / 2, z: -HALF / 2 },   // fast up, slow up
    { s: 3, x: -HALF / 2, z: -HALF / 2 },  // fast down, slow up
    { s: 4, x: HALF / 2, z: HALF / 2 },    // fast up, slow down
    { s: 2, x: -HALF / 2, z: HALF / 2 },   // fast down, slow down
  ];
  const lean = (s: number) => {
    if (s === 1) return "long";
    if (s === 2) return "short";
    const t = s === 3 ? sc.tilt?.correction : sc.tilt?.rebound;
    if (typeof t !== "number" || Math.abs(t) < 0.01) return "flat (no history yet)";
    return `lean ${t > 0 ? "long" : "short"} ${Math.abs(t).toFixed(2)}`;
  };
  return (
    <group>
      {quads.map((q) => (
        <group key={q.s}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[q.x, 0, q.z]}>
            <planeGeometry args={[HALF - 0.08, HALF - 0.08]} />
            <meshBasicMaterial color={STATE_COL[q.s]} transparent opacity={0.09} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <Html position={[q.x + (q.x > 0 ? 1.6 : -1.6), 0.05, q.z + (q.z > 0 ? 2.6 : -2.6)]} center style={{ pointerEvents: "none" }}>
            <div className="scene-label scene-label--axis" style={{ color: STATE_COL[q.s], textAlign: "center", fontSize: 11 }}>
              {STATE_NAME[q.s]}<br /><span style={{ opacity: 0.8, fontSize: 9 }}>{lean(q.s)}</span>
            </div>
          </Html>
        </group>
      ))}
      <Line points={[[-HALF, 0.01, 0], [HALF, 0.01, 0]]} color="#8fa3d9" lineWidth={1.2} transparent opacity={0.7} />
      <Line points={[[0, 0.01, -HALF], [0, 0.01, HALF]]} color="#8fa3d9" lineWidth={1.2} transparent opacity={0.7} />
      <Html position={[HALF + 0.6, 0, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9 }}>{sc.fast_days}d trend +</div>
      </Html>
      <Html position={[-HALF - 0.6, 0, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9 }}>{sc.fast_days}d trend −</div>
      </Html>
      <Html position={[0, 0, -HALF - 0.5]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9 }}>{sc.slow_days}d trend +</div>
      </Html>
      <Html position={[0, 0, HALF + 0.5]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9 }}>{sc.slow_days}d trend −</div>
      </Html>
    </group>
  );
}

function PillarView({ p, onHover }: { p: Pillar; onHover: (p: Pillar | null) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const col = p.q.w > 0 ? C_LONG : p.q.w < 0 ? C_SHORT : C_FLAT;
  useFrame(({ clock }) => {
    if (ref.current) {
      const k = 1 + 0.05 * Math.sin(clock.getElapsedTime() * 2 + p.x * 1.7 + p.z);
      ref.current.scale.set(1, k, 1);
    }
  });
  return (
    <group position={[p.x, 0, p.z]}>
      <mesh ref={ref} position={[0, p.h / 2, 0]} onPointerOver={(e) => { e.stopPropagation(); onHover(p); }} onPointerOut={() => onHover(null)}>
        <cylinderGeometry args={[0.16, 0.2, p.h, 20]} />
        <meshBasicMaterial color={col.clone().multiplyScalar(1.8)} toneMapped={false} />
      </mesh>
      <mesh position={[0, p.h + 0.08, 0]}>
        <sphereGeometry args={[0.13, 16, 16]} />
        <meshBasicMaterial color={STATE_COL[p.q.state] ?? "#ffffff"} toneMapped={false} />
      </mesh>
      <Html position={[0, p.h + 0.42, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 10, color: p.q.w > 0 ? "#7dffad" : p.q.w < 0 ? "#ffa36e" : undefined }}>{p.q.c}</div>
      </Html>
    </group>
  );
}

function Ribbon({ mix }: { mix: number[][] }) {
  // stacked state counts per day along the back wall
  const bars = useMemo(() => {
    const out: { x: number; y: number; h: number; s: number }[] = [];
    const n = mix.length;
    if (!n) return out;
    const tot = Math.max(1, ...mix.map((m) => m.reduce((a, b) => a + b, 0)));
    mix.forEach((m, i) => {
      const x = -HALF + (2 * HALF * (i + 0.5)) / n;
      let y = 0;
      [1, 3, 4, 2].forEach((s) => {
        const h = (m[s - 1] / tot) * 2.4;
        if (h > 0) out.push({ x, y: y + h / 2, h, s });
        y += h;
      });
    });
    return out;
  }, [mix]);
  const w = (2 * HALF) / Math.max(1, mix.length);
  return (
    <group position={[0, 0, -HALF - 1.4]}>
      {bars.map((b, i) => (
        <mesh key={i} position={[b.x, b.y, 0]}>
          <boxGeometry args={[w * 0.92, b.h, 0.08]} />
          <meshBasicMaterial color={STATE_COL[b.s]} transparent opacity={0.55} toneMapped={false} />
        </mesh>
      ))}
      <Html position={[0, 2.75, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9 }}>states of the 22 coins, last 180 days →</div>
      </Html>
    </group>
  );
}

function Tooltip({ p }: { p: Pillar }) {
  return (
    <Html position={[p.x, p.h, p.z]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${p.x > 2 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">{p.q.c} · {STATE_NAME[p.q.state] ?? "-"}</div>
        <div className="tooltip__row"><span>slow trend</span><b>{p.q.slow > 0 ? "+" : ""}{p.q.slow}%</b></div>
        <div className="tooltip__row"><span>fast trend</span><b>{p.q.fast > 0 ? "+" : ""}{p.q.fast}%</b></div>
        <div className="tooltip__row"><span>book weight</span><b>{(p.q.w * 100).toFixed(1)}%</b></div>
      </div>
    </Html>
  );
}

function Title({ sc, pillars }: { sc: SceneData; pillars: Pillar[] }) {
  const net = pillars.reduce((a, p) => a + p.q.w, 0);
  const gross = pillars.reduce((a, p) => a + Math.abs(p.q.w), 0);
  const counts = [1, 2, 3, 4].map((s) => pillars.filter((p) => p.q.state === s).length);
  const sub = `${counts[0]} bull · ${counts[1]} bear · ${counts[2]} correction · ${counts[3]} rebound · gross ${(gross * 100).toFixed(0)}% · net ${net >= 0 ? "+" : ""}${(net * 100).toFixed(0)}%${sc.leverage ? ` · ${sc.leverage}x` : ""}`;
  const top = Math.max(2.5, ...pillars.map((p) => p.h)) + 1.6;
  return (
    <Html position={[0, top, 0]} center style={{ pointerEvents: "none" }}>
      <div className="scene-title">{(sc.title ?? "Turning Points").toUpperCase()}</div>
      <div className="scene-label scene-label--axis" style={{ textAlign: "center", maxWidth: 520 }}>{sub}</div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 21 * Math.max(1, 1.6 / aspect);
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function QuadrantScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<Pillar | null>(null);
  const [spin, setSpin] = useState(true);
  const pillars = usePillars(scene);
  return (
    <Canvas camera={{ position: [0, 10, 15], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05080d")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#05080d", 22, 60]} />
      <ambientLight intensity={0.4} />
      <Stars radius={60} depth={30} count={1800} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={100} scale={[18, 6, 18]} size={1.4} speed={0.25} opacity={0.3} color="#ffc94d" />
      <group position={[0, -1.2, 0]}>
        <Floor sc={scene} />
        {pillars.map((p) => <PillarView key={p.q.c} p={p} onHover={setHover} />)}
        {scene.mix_180d && scene.mix_180d.length > 0 && <Ribbon mix={scene.mix_180d} />}
        <Title sc={scene} pillars={pillars} />
        {hover && <Tooltip p={hover} />}
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.3}
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
