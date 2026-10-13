"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { PulseScene as SceneData, PulseWeek } from "@/lib/types";

// Strategy 22 "Weekly Pulse": one bar per Monday for the last year, laid along a gentle arc like a heartbeat
// trace. A bar's height is Bitcoin's 4-week return at that Monday's decision (up = above the floor, down = below);
// its colour is the position the book took for the week (green long, orange short). A glowing line above traces
// the BTC price, and the newest week beats as a pulsing heart with the live position.

const N_MAX = 52;
const R_ARC = 13;
const ARC = Math.PI * 0.62;
const H_PER = 0.16;     // world units per % of 4-week return
const C_LONG = new THREE.Color("#4dff8f");
const C_SHORT = new THREE.Color("#ff7a3d");
const C_FLAT = new THREE.Color("#6b7aa8");

type Beat = { w: PulseWeek; x: number; z: number; rot: number; h: number; i: number };

function useBeats(sc: SceneData): Beat[] {
  return useMemo(() => {
    const ws = (sc.weeks ?? []).slice(-N_MAX);
    const n = ws.length;
    return ws.map((w, i) => {
      const a = -ARC / 2 + (n > 1 ? (ARC * i) / (n - 1) : 0);
      return { w, i, x: R_ARC * Math.sin(a), z: R_ARC - R_ARC * Math.cos(a) - 3, rot: -a,
               h: Math.max(-6, Math.min(6, w.r * H_PER)) };
    });
  }, [sc]);
}

function BeatBar({ b, onHover, last }: { b: Beat; onHover: (b: Beat | null) => void; last: boolean }) {
  const col = b.w.w > 0 ? C_LONG : b.w.w < 0 ? C_SHORT : C_FLAT;
  const h = Math.max(0.05, Math.abs(b.h));
  return (
    <group position={[b.x, 0, b.z]} rotation={[0, b.rot, 0]}>
      <mesh position={[0, b.h >= 0 ? h / 2 : -h / 2, 0]}
        onPointerOver={(e) => { e.stopPropagation(); onHover(b); }} onPointerOut={() => onHover(null)}>
        <boxGeometry args={[0.32, h, 0.32]} />
        <meshBasicMaterial color={col.clone().multiplyScalar(last ? 2.2 : 1.3)} toneMapped={false} transparent opacity={last ? 1 : 0.85} />
      </mesh>
    </group>
  );
}

function PriceLine({ beats }: { beats: Beat[] }) {
  const pts = useMemo(() => {
    const ps = beats.map((b) => b.w.px).filter((v) => v > 0);
    if (ps.length < 2) return [] as [number, number, number][];
    const lo = Math.min(...ps), hi = Math.max(...ps);
    return beats.map((b) => [b.x, 7.2 + ((b.w.px - lo) / Math.max(1e-9, hi - lo)) * 3, b.z] as [number, number, number]);
  }, [beats]);
  if (pts.length < 2) return null;
  return (
    <group>
      <Line points={pts} color="#ffd36b" lineWidth={2} transparent opacity={0.9} />
      <Html position={pts[0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9, color: "#ffd36b" }}>BTC price</div>
      </Html>
    </group>
  );
}

function Floor({ beats }: { beats: Beat[] }) {
  const pts = beats.map((b) => [b.x, 0, b.z] as [number, number, number]);
  if (pts.length < 2) return null;
  return (
    <group>
      <Line points={pts} color="#8fa3d9" lineWidth={1.2} transparent opacity={0.7} />
      <Html position={[pts[0][0] - 0.8, 0, pts[0][2]]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9 }}>a year ago</div>
      </Html>
    </group>
  );
}

function Heart({ b, sc }: { b: Beat; sc: SceneData }) {
  const ref = useRef<THREE.Mesh>(null);
  const w = sc.now?.w ?? b.w.w;
  const col = w > 0 ? C_LONG : w < 0 ? C_SHORT : C_FLAT;
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime() * 1.6;
    const beat = Math.max(0, Math.sin(t * Math.PI)) ** 8 + 0.6 * Math.max(0, Math.sin((t - 0.18) * Math.PI)) ** 8;
    const k = 1 + 0.45 * beat;
    ref.current.scale.set(k, k, k);
  });
  const y = (b.h >= 0 ? b.h : 0) + 1.0;
  const r = sc.now?.r ?? b.w.r;
  return (
    <group position={[b.x, y, b.z]}>
      <mesh ref={ref}>
        <sphereGeometry args={[0.42, 24, 24]} />
        <meshBasicMaterial color={col.clone().multiplyScalar(2.4)} toneMapped={false} />
      </mesh>
      <Html position={[0, 1.0, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label" style={{ textAlign: "center", fontSize: 11, color: w > 0 ? "#7dffad" : w < 0 ? "#ffa36e" : undefined }}>
          THIS WEEK: {w > 0 ? "LONG" : w < 0 ? "SHORT" : "FLAT"} {Math.abs(w).toFixed(2)}x<br />
          <span style={{ opacity: 0.8, fontSize: 9 }}>BTC {r > 0 ? "+" : ""}{r}% over 4 weeks</span>
        </div>
      </Html>
    </group>
  );
}

function Tooltip({ b }: { b: Beat }) {
  return (
    <Html position={[b.x, b.h, b.z]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${b.x > 3 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">week of {b.w.d}</div>
        <div className="tooltip__row"><span>BTC 4-week return</span><b>{b.w.r > 0 ? "+" : ""}{b.w.r}%</b></div>
        <div className="tooltip__row"><span>position</span><b>{b.w.w > 0 ? "long" : b.w.w < 0 ? "short" : "flat"} {Math.abs(b.w.w).toFixed(2)}x</b></div>
        <div className="tooltip__row"><span>BTC</span><b>${Math.round(b.w.px).toLocaleString()}</b></div>
      </div>
    </Html>
  );
}

function Title({ sc, beats }: { sc: SceneData; beats: Beat[] }) {
  const longs = beats.filter((b) => b.w.w > 0).length;
  const sub = `last ${beats.length} Mondays: ${longs} long · ${beats.length - longs} short · ${sc.lookback_weeks}-week lookback${sc.leverage ? ` · ${sc.leverage}x` : ""}${sc.asof ? ` · as of ${sc.asof}` : ""}`;
  return (
    <Html position={[0, 11.6, 0]} center style={{ pointerEvents: "none" }}>
      <div className="scene-title">{(sc.title ?? "Weekly Pulse").toUpperCase()}</div>
      <div className="scene-label scene-label--axis" style={{ textAlign: "center", maxWidth: 520 }}>{sub}</div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 24 * Math.max(1, 1.6 / aspect);
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function PulseScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<Beat | null>(null);
  const [spin, setSpin] = useState(true);
  const beats = useBeats(scene);
  const last = beats.length ? beats[beats.length - 1] : null;
  return (
    <Canvas camera={{ position: [0, 9, 18], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05080d")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#05080d", 24, 64]} />
      <ambientLight intensity={0.4} />
      <Stars radius={60} depth={30} count={1800} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={90} scale={[22, 8, 14]} size={1.4} speed={0.25} opacity={0.3} color="#4dff8f" />
      <group position={[0, -2.2, 0]}>
        <Floor beats={beats} />
        {beats.map((b) => <BeatBar key={b.w.d} b={b} onHover={setHover} last={b === last} />)}
        <PriceLine beats={beats} />
        {last && <Heart b={last} sc={scene} />}
        <Title sc={scene} beats={beats} />
        {hover && <Tooltip b={hover} />}
      </group>
      <OrbitControls target={[0, 0, 2]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.25}
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
