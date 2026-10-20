"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { PercentileDay, PercentileScene as SceneData } from "@/lib/types";

// Strategy 35 "Top-Third Momentum": the last 240 days run left to right. Each day is a pillar whose height is where
// the coin basket's 28-day return ranked against ALL its past 28-day returns (0 = worst ever, top = best ever).
// A glass sheet hangs at two-thirds height: pillars that break through it light up gold - those are the days a
// tranche bought the market. Below them the floor glows blue under the exposure the book actually held (mean of the
// 5 staggered 5-day tranches). On the right stands the "history tower": every past 28-day return, stacked from worst
// (bottom) to best (top), with the top third lit and a ring marking where today's return sits. The gold line above
// is the basket index.

const W = 22;
const P_H = 7.0;          // world units for percentile 0..1
const E_H = 1.6;          // floor glow height per 1x exposure
const C_IN = new THREE.Color("#ffc94d");
const C_OUT = new THREE.Color("#3a5f9e");
const C_EXP = new THREE.Color("#4dc3ff");

type Pt = { d: PercentileDay; x: number; i: number };

function usePts(sc: SceneData): Pt[] {
  return useMemo(() => {
    const ds = sc.days ?? [];
    const n = ds.length;
    return ds.map((d, i) => ({ d, i, x: -W / 2 + (n > 1 ? (W * i) / (n - 1) : 0) }));
  }, [sc]);
}

function Pillar({ p, thr, onHover }: { p: Pt; thr: number; onHover: (p: Pt | null) => void }) {
  const h = Math.max(0.04, p.d.pct * P_H);
  const hot = p.d.pct > thr;
  const col = hot ? C_IN.clone().multiplyScalar(1.6) : C_OUT.clone().lerp(new THREE.Color("#7fa8ff"), p.d.pct);
  return (
    <mesh position={[p.x, h / 2, 0]}
      onPointerOver={(e) => { e.stopPropagation(); onHover(p); }} onPointerOut={() => onHover(null)}>
      <boxGeometry args={[W / 280, h, 0.6]} />
      <meshBasicMaterial color={col} toneMapped={!hot} transparent opacity={hot ? 1 : 0.75} />
    </mesh>
  );
}

function Threshold({ thr }: { thr: number }) {
  const y = thr * P_H;
  return (
    <group>
      <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W + 1.2, 2.4]} />
        <meshBasicMaterial color="#ffe7a8" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={[[-W / 2 - 0.6, y, 1.2], [W / 2 + 0.6, y, 1.2]]} color="#ffd36b" lineWidth={1.4} dashed dashSize={0.4} gapSize={0.2} />
      <Html position={[-W / 2 - 1.6, y, 1.2]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9, color: "#ffd36b" }}>top third</div>
      </Html>
      <Html position={[-W / 2 - 1.6, P_H, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9 }}>best ever</div>
      </Html>
      <Html position={[-W / 2 - 1.6, 0.2, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9 }}>worst ever</div>
      </Html>
    </group>
  );
}

function ExposureFloor({ pts }: { pts: Pt[] }) {
  const geo = useMemo(() => {
    const pos: number[] = [];
    const z = 1.8;
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1];
      const ya = -0.2 - a.d.e * E_H, yb = -0.2 - b.d.e * E_H;
      pos.push(a.x, -0.2, z, b.x, -0.2, z, b.x, yb, z, a.x, -0.2, z, b.x, yb, z, a.x, ya, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [pts]);
  const line = useMemo(() => pts.map((p) => [p.x, -0.2 - p.d.e * E_H, 1.8] as [number, number, number]), [pts]);
  if (line.length < 2) return null;
  return (
    <group>
      <mesh geometry={geo}>
        <meshBasicMaterial color={C_EXP} transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={line} color={C_EXP} lineWidth={2.2} />
      <Html position={[-W / 2 - 1.6, -0.2 - E_H, 1.8]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9, color: "#7fd6ff" }}>in the market</div>
      </Html>
    </group>
  );
}

function IndexLine({ pts }: { pts: Pt[] }) {
  const line = useMemo(() => {
    const v = pts.map((p) => p.d.idx);
    if (v.length < 2) return [] as [number, number, number][];
    const lo = Math.min(...v), hi = Math.max(...v);
    return pts.map((p) => [p.x, P_H + 1.2 + ((p.d.idx - lo) / Math.max(1e-9, hi - lo)) * 2.0, -0.8] as [number, number, number]);
  }, [pts]);
  if (line.length < 2) return null;
  return (
    <group>
      <Line points={line} color="#ffd36b" lineWidth={1.8} transparent opacity={0.85} />
      <Html position={[line[0][0] - 1.1, line[0][1], -0.8]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9, color: "#ffd36b" }}>coin basket</div>
      </Html>
    </group>
  );
}

function HistoryTower({ sc, now }: { sc: SceneData; now: PercentileDay | null }) {
  const hist = sc.history_r28 ?? [];
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (ring.current) ring.current.rotation.z = clock.getElapsedTime() * 0.8; });
  const n = hist.length;
  if (!n) return null;
  const x0 = W / 2 + 3.2;
  const maxAbs = Math.max(...hist.map((v) => Math.abs(v)), 1);
  const yNow = now ? now.pct * P_H : 0;
  return (
    <group position={[x0, 0, 0]}>
      {hist.map((v, i) => {
        const y = ((i + 0.5) / n) * P_H;
        const top = (i + 1) / (n + 1) > sc.threshold;
        const r = 0.25 + (Math.abs(v) / maxAbs) * 1.1;
        const col = v >= 0 ? new THREE.Color(top ? "#ffc94d" : "#4dff8f") : new THREE.Color("#ff4d6a");
        return (
          <mesh key={i} position={[0, y, 0]}>
            <cylinderGeometry args={[r, r, (P_H / n) * 0.7, 28]} />
            <meshBasicMaterial color={col.multiplyScalar(top ? 1.5 : 0.9)} toneMapped={!top} transparent opacity={0.85} />
          </mesh>
        );
      })}
      {now && (
        <mesh ref={ring} position={[0, yNow, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.7, 0.07, 12, 48]} />
          <meshBasicMaterial color={C_EXP.clone().multiplyScalar(2.2)} toneMapped={false} />
        </mesh>
      )}
      <Html position={[0, P_H + 0.8, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label" style={{ textAlign: "center", fontSize: 10 }}>
          every past {sc.lookback_days}-day return<br /><span style={{ opacity: 0.75, fontSize: 9 }}>{n} blocks, worst → best</span>
        </div>
      </Html>
      {now && (
        <Html position={[2.2, yNow, 0]} style={{ pointerEvents: "none" }}>
          <div className="scene-label" style={{ fontSize: 9, color: "#7fd6ff", whiteSpace: "nowrap" }}>
            now {now.r28 > 0 ? "+" : ""}{now.r28}% · {(now.pct * 100).toFixed(0)}th pct
          </div>
        </Html>
      )}
    </group>
  );
}

function Beacon({ p, sc }: { p: Pt; sc: SceneData }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const k = 1 + 0.35 * Math.max(0, Math.sin(clock.getElapsedTime() * 2.4)) ** 4;
    ref.current.scale.set(k, k, k);
  });
  const lev = sc.leverage ?? 1;
  const e = sc.live?.exposure ?? p.d.e * lev;
  const tr = sc.live?.tranches ?? null;
  const nIn = tr ? tr.filter((x) => x[1] === 1).length : Math.round(p.d.e * sc.hold_days);
  const y = -0.2 - (e / lev) * E_H;
  return (
    <group position={[p.x + 0.5, y, 1.8]}>
      <mesh ref={ref}>
        <sphereGeometry args={[0.34, 24, 24]} />
        <meshBasicMaterial color={(e > 0 ? C_IN : C_EXP).clone().multiplyScalar(2.4)} toneMapped={false} />
      </mesh>
      <Html position={[0, -1.0, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label" style={{ textAlign: "center", fontSize: 11, color: e > 0 ? "#ffd36b" : "#7fd6ff" }}>
          NOW: {e > 0 ? `LONG ${e.toFixed(2)}x of the coin market` : "IN CASH"}<br />
          <span style={{ opacity: 0.8, fontSize: 9 }}>{nIn} of {sc.hold_days} tranches in{sc.live?.n_coins ? ` · ${sc.live.n_coins} coins` : ""}</span>
        </div>
      </Html>
    </group>
  );
}

function Tooltip({ p, lev }: { p: Pt; lev: number }) {
  return (
    <Html position={[p.x, p.d.pct * P_H + 0.4, 0]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${p.x > 3 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">{p.d.t}</div>
        <div className="tooltip__row"><span>basket, last 28 days</span><b>{p.d.r28 > 0 ? "+" : ""}{p.d.r28}%</b></div>
        <div className="tooltip__row"><span>rank vs history</span><b>{(p.d.pct * 100).toFixed(0)}th pct</b></div>
        <div className="tooltip__row"><span>that day&apos;s tranche</span><b>{p.d.s ? "BUY" : "cash"}</b></div>
        <div className="tooltip__row"><span>book exposure</span><b>{(p.d.e * lev).toFixed(2)}x</b></div>
      </div>
    </Html>
  );
}

function Title({ sc }: { sc: SceneData }) {
  const sub = `last ${sc.days?.length ?? 0} days · long the coin basket only when its ${sc.lookback_days}-day return ranks in the top third of its history · ${sc.hold_days} staggered ${sc.hold_days}-day tranches${sc.leverage ? ` · ${sc.leverage}x when fully in` : ""}`;
  return (
    <Html position={[1.5, P_H + 4.4, -0.8]} center style={{ pointerEvents: "none" }}>
      <div className="scene-title">{(sc.title ?? "Top-Third Momentum").toUpperCase()}</div>
      <div className="scene-label scene-label--axis" style={{ textAlign: "center", maxWidth: 600 }}>{sub}</div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 29 * Math.max(1, 1.6 / aspect);
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function PercentileScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<Pt | null>(null);
  const [spin, setSpin] = useState(true);
  const pts = usePts(scene);
  const last = pts.length ? pts[pts.length - 1] : null;
  const thr = scene.threshold ?? 2 / 3;
  return (
    <Canvas camera={{ position: [0, 7, 21], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05080d")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#05080d", 28, 72]} />
      <ambientLight intensity={0.4} />
      <Stars radius={60} depth={30} count={1800} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={80} scale={[26, 10, 10]} size={1.3} speed={0.25} opacity={0.3} color="#ffc94d" />
      <group position={[-1.5, -4.2, 0]}>
        <Line points={[[-W / 2, 0, 0.4], [W / 2, 0, 0.4]]} color="#8fa3d9" lineWidth={1} transparent opacity={0.6} />
        {pts.map((p) => <Pillar key={p.d.t} p={p} thr={thr} onHover={setHover} />)}
        <Threshold thr={thr} />
        <ExposureFloor pts={pts} />
        <IndexLine pts={pts} />
        <HistoryTower sc={scene} now={last ? last.d : null} />
        {last && <Beacon p={last} sc={scene} />}
        <Title sc={scene} />
        {hover && <Tooltip p={hover} lev={scene.leverage ?? 1} />}
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.22}
        minAzimuthAngle={-Math.PI / 3} maxAzimuthAngle={Math.PI / 3}
        minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.1} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.35} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
