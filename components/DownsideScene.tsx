"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { DownsideDay, DownsideScene as SceneData } from "@/lib/types";

// Strategy 32 "Downside-Vol Basket": the last 180 days run left to right. On the floor, one bar per day for the
// equal-weight coin basket's return (green up, red down; height = size of the move). Behind them two glowing
// walls: the red one is the 30-day DOWNSIDE volatility (only the falls), the green one the upside volatility.
// The book's size is set by the red wall alone, so a blue ribbon floating above traces the exposure it held
// that day - it sinks when the falls get violent and rises when the market only swings upward. The gold line is
// the basket index. The newest day carries a pulsing beacon with the live exposure.

const W = 22;            // world width of the 180 days
const R_H = 0.55;        // world units per % daily return
const V_H = 5.0;         // world units per 100% annualised vol
const E_H = 2.4;         // world units per 1x exposure
const C_UP = new THREE.Color("#4dff8f");
const C_DN = new THREE.Color("#ff4d6a");
const C_EXP = new THREE.Color("#4dc3ff");

type Pt = { d: DownsideDay; x: number; i: number };

function usePts(sc: SceneData): Pt[] {
  return useMemo(() => {
    const ds = sc.days ?? [];
    const n = ds.length;
    return ds.map((d, i) => ({ d, i, x: -W / 2 + (n > 1 ? (W * i) / (n - 1) : 0) }));
  }, [sc]);
}

function DayBar({ p, onHover }: { p: Pt; onHover: (p: Pt | null) => void }) {
  const h = Math.max(0.03, Math.min(6, Math.abs(p.d.r) * R_H));
  const col = p.d.r >= 0 ? C_UP : C_DN;
  return (
    <mesh position={[p.x, p.d.r >= 0 ? h / 2 : -h / 2, 1.6]}
      onPointerOver={(e) => { e.stopPropagation(); onHover(p); }} onPointerOut={() => onHover(null)}>
      <boxGeometry args={[W / 200, h, 0.5]} />
      <meshBasicMaterial color={col.clone().multiplyScalar(1.4)} toneMapped={false} transparent opacity={0.9} />
    </mesh>
  );
}

function VolWall({ pts, key2, color, z, label }: { pts: Pt[]; key2: "dn" | "up"; color: THREE.Color; z: number; label: string }) {
  const geo = useMemo(() => {
    const ok = pts.filter((p) => p.d[key2] > 0);
    const pos: number[] = [];
    for (let k = 0; k + 1 < ok.length; k++) {
      const a = ok[k], b = ok[k + 1];
      const ya = a.d[key2] * V_H, yb = b.d[key2] * V_H;
      pos.push(a.x, 0, z, b.x, 0, z, b.x, yb, z, a.x, 0, z, b.x, yb, z, a.x, ya, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [pts, key2, z]);
  const line = useMemo(() => pts.filter((p) => p.d[key2] > 0).map((p) => [p.x, p.d[key2] * V_H, z] as [number, number, number]), [pts, key2, z]);
  if (line.length < 2) return null;
  return (
    <group>
      <mesh geometry={geo}>
        <meshBasicMaterial color={color} transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={line} color={color} lineWidth={2.2} transparent opacity={0.95} />
      <Html position={[line[0][0] - 0.4, line[0][1] + 0.4, z]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9, color: `#${color.getHexString()}` }}>{label}</div>
      </Html>
    </group>
  );
}

function ExposureRibbon({ pts }: { pts: Pt[] }) {
  const line = useMemo(() => pts.filter((p) => p.d.w > 0).map((p) => [p.x, 6.2 + p.d.w * E_H, -0.6] as [number, number, number]), [pts]);
  if (line.length < 2) return null;
  return (
    <group>
      <Line points={line} color={C_EXP} lineWidth={3} transparent opacity={0.95} />
      <Line points={[[-W / 2, 6.2 + E_H, -0.6], [W / 2, 6.2 + E_H, -0.6]]} color="#8fa3d9" lineWidth={0.8} dashed dashSize={0.3} gapSize={0.2} transparent opacity={0.5} />
      <Html position={[-W / 2 - 1.1, 6.2 + E_H, -0.6]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9, color: "#7fd6ff" }}>exposure 1x</div>
      </Html>
    </group>
  );
}

function IndexLine({ pts }: { pts: Pt[] }) {
  const line = useMemo(() => {
    const v = pts.map((p) => p.d.idx);
    if (v.length < 2) return [] as [number, number, number][];
    const lo = Math.min(...v), hi = Math.max(...v);
    return pts.map((p) => [p.x, 11.0 + ((p.d.idx - lo) / Math.max(1e-9, hi - lo)) * 2.2, -0.6] as [number, number, number]);
  }, [pts]);
  if (line.length < 2) return null;
  return (
    <group>
      <Line points={line} color="#ffd36b" lineWidth={1.8} transparent opacity={0.9} />
      <Html position={[line[0][0] - 1.0, line[0][1], -0.6]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9, color: "#ffd36b" }}>coin basket</div>
      </Html>
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
  const e = sc.live?.exposure ?? p.d.w * lev;
  const dn = sc.live?.drv ?? p.d.dn;
  const up = sc.live?.upv ?? p.d.up;
  const y = 6.2 + (e / lev) * E_H;
  return (
    <group position={[p.x + 0.4, y, -0.6]}>
      <mesh ref={ref}>
        <sphereGeometry args={[0.36, 24, 24]} />
        <meshBasicMaterial color={C_EXP.clone().multiplyScalar(2.4)} toneMapped={false} />
      </mesh>
      <Html position={[0, 1.0, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label" style={{ textAlign: "center", fontSize: 11, color: "#7fd6ff" }}>
          NOW: LONG {e.toFixed(2)}x of the coin market<br />
          <span style={{ opacity: 0.8, fontSize: 9 }}>downside vol {(dn * 100).toFixed(0)}% · upside {(up * 100).toFixed(0)}%{sc.live?.n_coins ? ` · ${sc.live.n_coins} coins` : ""}</span>
        </div>
      </Html>
    </group>
  );
}

function Tooltip({ p, lev }: { p: Pt; lev: number }) {
  return (
    <Html position={[p.x, 0.5, 1.6]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${p.x > 3 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">{p.d.t}</div>
        <div className="tooltip__row"><span>basket return</span><b>{p.d.r > 0 ? "+" : ""}{p.d.r}%</b></div>
        <div className="tooltip__row"><span>downside vol (30d)</span><b>{(p.d.dn * 100).toFixed(0)}%</b></div>
        <div className="tooltip__row"><span>upside vol (30d)</span><b>{(p.d.up * 100).toFixed(0)}%</b></div>
        <div className="tooltip__row"><span>exposure set that night</span><b>{(p.d.w * lev).toFixed(2)}x</b></div>
      </div>
    </Html>
  );
}

function Title({ sc }: { sc: SceneData }) {
  const sub = `last ${sc.days?.length ?? 0} days · exposure = min(${sc.cap}, ${sc.target} / ${sc.window_days}-day downside vol)${sc.leverage ? ` × ${sc.leverage}` : ""} · long every coin, equal weight`;
  return (
    <Html position={[0, 15.0, -0.6]} center style={{ pointerEvents: "none" }}>
      <div className="scene-title">{(sc.title ?? "Downside-Vol Basket").toUpperCase()}</div>
      <div className="scene-label scene-label--axis" style={{ textAlign: "center", maxWidth: 560 }}>{sub}</div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 27 * Math.max(1, 1.6 / aspect);
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function DownsideScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<Pt | null>(null);
  const [spin, setSpin] = useState(true);
  const pts = usePts(scene);
  const last = pts.length ? pts[pts.length - 1] : null;
  return (
    <Canvas camera={{ position: [0, 8, 20], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05080d")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#05080d", 26, 70]} />
      <ambientLight intensity={0.4} />
      <Stars radius={60} depth={30} count={1800} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={80} scale={[24, 10, 10]} size={1.3} speed={0.25} opacity={0.3} color="#4dc3ff" />
      <group position={[0, -5.5, 0]}>
        <Line points={[[-W / 2, 0, 1.6], [W / 2, 0, 1.6]]} color="#8fa3d9" lineWidth={1} transparent opacity={0.6} />
        {pts.map((p) => <DayBar key={p.d.t} p={p} onHover={setHover} />)}
        <VolWall pts={pts} key2="up" color={C_UP} z={-2.6} label="upside vol" />
        <VolWall pts={pts} key2="dn" color={C_DN} z={-1.8} label="downside vol" />
        <ExposureRibbon pts={pts} />
        <IndexLine pts={pts} />
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
