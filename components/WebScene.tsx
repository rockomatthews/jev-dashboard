"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { WebScene as SceneData, WebNode } from "@/lib/types";

// Strategy 24 "Betting Against Correlation": a correlation web. Bitcoin is the glowing sun in the middle; every alt
// hangs on a thread from it. The thread's length is how little the coin moves with Bitcoin (1 - correlation): the
// herd sits close, the loners float far out. Height is the coin's annualised volatility. Green coins are this week's
// longs (loners), orange the shorts (the herd), grey not held; size grows with the position. Around the outside, a
// ring of bars shows the last 26 weekly results of the long-minus-short book.

const R_MIN = 1.6;
const R_PER = 16;       // world units per unit of (1 - corr)
const H_PER = 4.0;      // world units per 100% annualised vol
const RING_R = 12.5;
const C_LONG = new THREE.Color("#4dff8f");
const C_SHORT = new THREE.Color("#ff7a3d");
const C_FLAT = new THREE.Color("#6b7aa8");

type Pt = { c: string; n: WebNode; x: number; y: number; z: number };

function usePoints(sc: SceneData): Pt[] {
  return useMemo(() => {
    const names = Object.keys(sc.nodes ?? {}).sort();
    const n = names.length;
    return names.map((c, i) => {
      const node = sc.nodes[c];
      const a = (2 * Math.PI * i) / Math.max(1, n);
      const r = R_MIN + Math.max(0, 1 - (node.corr ?? 0)) * R_PER;
      const y = Math.min(8, (node.vol ?? 0) * H_PER);
      return { c, n: node, x: r * Math.cos(a), y, z: r * Math.sin(a) };
    });
  }, [sc]);
}

function colorOf(w: number) {
  return w > 0 ? C_LONG : w < 0 ? C_SHORT : C_FLAT;
}

function Sun() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const k = 1 + 0.06 * Math.sin(clock.getElapsedTime() * 1.5);
    ref.current.scale.set(k, k, k);
  });
  return (
    <group position={[0, 2.2, 0]}>
      <mesh ref={ref}>
        <sphereGeometry args={[0.85, 32, 32]} />
        <meshBasicMaterial color={new THREE.Color("#ffc94d").multiplyScalar(2.2)} toneMapped={false} />
      </mesh>
      <Html position={[0, 1.4, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label" style={{ color: "#ffd36b", fontSize: 11 }}>BTC</div>
      </Html>
    </group>
  );
}

function Node({ p, onHover }: { p: Pt; onHover: (p: Pt | null) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const w = p.n.w ?? 0;
  const held = Math.abs(w) > 1e-9;
  const size = held ? 0.28 + Math.min(0.5, Math.abs(w) * 2.2) : 0.2;
  useFrame(({ clock }) => {
    if (!ref.current || !held) return;
    ref.current.position.y = p.y + 0.12 * Math.sin(clock.getElapsedTime() * 1.2 + p.x);
  });
  const col = colorOf(w);
  return (
    <group>
      <Line points={[[0, 2.2, 0], [p.x, p.y, p.z]]} color={held ? `#${col.getHexString()}` : "#3a4566"}
        lineWidth={held ? 1.6 : 0.8} transparent opacity={held ? 0.75 : 0.3} />
      <Line points={[[p.x, 0, p.z], [p.x, p.y, p.z]]} color="#2a3550" lineWidth={0.6} transparent opacity={0.4} />
      <mesh ref={ref} position={[p.x, p.y, p.z]}
        onPointerOver={(e) => { e.stopPropagation(); onHover(p); }} onPointerOut={() => onHover(null)}>
        <sphereGeometry args={[size, 20, 20]} />
        <meshBasicMaterial color={col.clone().multiplyScalar(held ? 2.0 : 1.0)} toneMapped={false} transparent opacity={held ? 1 : 0.7} />
      </mesh>
      <Html position={[p.x, p.y + size + 0.35, p.z]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9, color: held ? (w > 0 ? "#7dffad" : "#ffa36e") : undefined }}>{p.c}</div>
      </Html>
    </group>
  );
}

function Rings() {
  const rings = [0.9, 0.7, 0.5, 0.3];
  return (
    <group>
      {rings.map((c) => {
        const r = R_MIN + (1 - c) * R_PER;
        const pts: [number, number, number][] = [];
        for (let i = 0; i <= 96; i++) {
          const a = (2 * Math.PI * i) / 96;
          pts.push([r * Math.cos(a), 0, r * Math.sin(a)]);
        }
        return (
          <group key={c}>
            <Line points={pts} color="#2f3d63" lineWidth={0.8} transparent opacity={0.6} />
            <Html position={[r, 0.1, 0]} center style={{ pointerEvents: "none" }}>
              <div className="scene-label scene-label--axis" style={{ fontSize: 8 }}>corr {c}</div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function WeekRing({ sc }: { sc: SceneData }) {
  const ws = (sc.weeks ?? []).slice(-26);
  const n = ws.length;
  return (
    <group>
      {ws.map((wk, i) => {
        const a = Math.PI * 0.15 + (Math.PI * 0.7 * i) / Math.max(1, n - 1) + Math.PI;
        const h = Math.max(0.05, Math.min(5, Math.abs(wk.ret_pct) * 0.35));
        const up = wk.ret_pct >= 0;
        return (
          <mesh key={wk.t} position={[RING_R * 1.45 * Math.cos(a), up ? h / 2 : -h / 2, RING_R * 1.45 * Math.sin(a)]}
            rotation={[0, -a, 0]}>
            <boxGeometry args={[0.35, h, 0.35]} />
            <meshBasicMaterial color={(up ? C_LONG : C_SHORT).clone().multiplyScalar(i === n - 1 ? 2.2 : 1.2)}
              toneMapped={false} transparent opacity={0.85} />
          </mesh>
        );
      })}
      {n > 0 && (
        <Html position={[RING_R * 1.45 * Math.cos(Math.PI * 1.5), 5.6, RING_R * 1.45 * Math.sin(Math.PI * 1.5)]} center
          style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis" style={{ fontSize: 9 }}>last {n} weeks of the book (1x)</div>
        </Html>
      )}
    </group>
  );
}

function Tooltip({ p }: { p: Pt }) {
  const w = p.n.w ?? 0;
  return (
    <Html position={[p.x, p.y, p.z]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${p.x > 3 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">{p.c}</div>
        <div className="tooltip__row"><span>correlation with BTC (180d)</span><b>{(p.n.corr ?? 0).toFixed(2)}</b></div>
        <div className="tooltip__row"><span>volatility (annualised)</span><b>{Math.round((p.n.vol ?? 0) * 100)}%</b></div>
        <div className="tooltip__row"><span>beta to BTC</span><b>{p.n.beta ?? "-"}</b></div>
        <div className="tooltip__row"><span>this week</span><b>{w > 0 ? "long" : w < 0 ? "short" : "not held"}{w ? ` ${(Math.abs(w) * 100).toFixed(1)}%` : ""}</b></div>
      </div>
    </Html>
  );
}

function Title({ sc, pts }: { sc: SceneData; pts: Pt[] }) {
  const longs = pts.filter((p) => (p.n.w ?? 0) > 0).length;
  const shorts = pts.filter((p) => (p.n.w ?? 0) < 0).length;
  const sub = `${longs} loners long · ${shorts} herd coins short · near = moves with Bitcoin, far = moves alone · height = volatility${sc.leverage ? ` · ${sc.leverage}x` : ""}${sc.decided ? ` · book of ${sc.decided}` : ""}`;
  return (
    <Html position={[0, 10.5, 0]} center style={{ pointerEvents: "none" }}>
      <div className="scene-title">{(sc.title ?? "Betting Against Correlation").toUpperCase()}</div>
      <div className="scene-label scene-label--axis" style={{ textAlign: "center", maxWidth: 560 }}>{sub}</div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 30 * Math.max(1, 1.6 / aspect);
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function WebScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<Pt | null>(null);
  const [spin, setSpin] = useState(true);
  const pts = usePoints(scene);
  return (
    <Canvas camera={{ position: [0, 14, 22], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05080d")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#05080d", 30, 80]} />
      <ambientLight intensity={0.4} />
      <Stars radius={70} depth={30} count={1800} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={110} scale={[30, 8, 30]} size={1.4} speed={0.25} opacity={0.3} color="#ffc94d" />
      <group position={[0, -2.5, 0]}>
        <Rings />
        <Sun />
        {pts.map((p) => <Node key={p.c} p={p} onHover={setHover} />)}
        <WeekRing sc={scene} />
        <Title sc={scene} pts={pts} />
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
