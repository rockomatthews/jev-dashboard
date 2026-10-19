"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SectorCell, SectorScene as SceneData } from "@/lib/types";

// Strategy 30 "Sector Momentum": five crypto narratives as islands on a ring. Each island is a sector
// (L1, DeFi, L2, payments/meme, AI/venue); its coins stand on it as towers, height = the coin's 28-day return
// (below the island when negative). The winning sector's island rises and glows green (the book is long all its
// coins), the losing sector's sinks and glows orange (short). Behind the ring a 3D "bump chart" shows the race
// over the last 16 Mondays: each sector's rank week by week (top = best), so you can watch the narratives rotate.

const SECT_COL: Record<string, string> = { L1: "#6ea8ff", DeFi: "#c77dff", L2: "#ff5fa2", PAY: "#ffd36b", NEW: "#4dffd2" };
const SECT_NAME: Record<string, string> = { L1: "Layer 1s", DeFi: "DeFi", L2: "Layer 2s", PAY: "Payments & meme", NEW: "AI & venue" };
const C_LONG = new THREE.Color("#4dff8f");
const C_SHORT = new THREE.Color("#ff7a3d");
const C_FLAT = new THREE.Color("#4a5c8f");
const RING = 6.2;
const H_PER = 0.055; // world units per % of return
const ORDER = ["L1", "DeFi", "L2", "PAY", "NEW"];

type Hover = { sector: string; coin?: string; cell: SectorCell; r: number | null; fwd?: number | null } | null;

function colOf(side: number) {
  return side > 0 ? C_LONG : side < 0 ? C_SHORT : C_FLAT;
}

function Island({ name, cell, angle, onHover }: { name: string; cell: SectorCell; angle: number; onHover: (h: Hover) => void }) {
  const g = useRef<THREE.Group>(null);
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  const x = Math.sin(angle) * RING;
  const z = Math.cos(angle) * RING * 0.8;
  const lift = cell.side > 0 ? 1.4 : cell.side < 0 ? -0.9 : 0;
  const coins = Object.keys(cell.coins).sort();
  const sc = new THREE.Color(SECT_COL[name] ?? "#9fb0d8");
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (g.current) g.current.position.y = lift + (cell.side !== 0 ? Math.sin(t * 1.4 + angle) * 0.12 : 0);
    if (ring.current) ring.current.color.copy(colOf(cell.side)).multiplyScalar(cell.side !== 0 ? 1.6 + 0.6 * Math.sin(t * 2.2) : 0.7);
  });
  const rad = 1.25 + 0.12 * coins.length;
  return (
    <group ref={g} position={[x, lift, z]}>
      <mesh onPointerOver={(e) => { e.stopPropagation(); onHover({ sector: name, cell, r: cell.r }); }} onPointerOut={() => onHover(null)}>
        <cylinderGeometry args={[rad, rad * 1.08, 0.22, 48]} />
        <meshBasicMaterial color={sc.clone().multiplyScalar(0.35)} toneMapped={false} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[rad * 1.02, rad * 1.14, 64]} />
        <meshBasicMaterial ref={ring} color={colOf(cell.side)} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {coins.map((c, i) => {
        const v = cell.coins[c];
        const r = v.r ?? 0;
        const h = Math.max(0.06, Math.min(9, Math.abs(r) * H_PER));
        const a = (2 * Math.PI * i) / Math.max(1, coins.length);
        const rr = coins.length > 1 ? rad * 0.62 : 0;
        const cx = Math.sin(a) * rr, cz = Math.cos(a) * rr;
        const col = r >= 0 ? sc.clone().multiplyScalar(1.5) : sc.clone().multiplyScalar(0.55);
        return (
          <group key={c}>
            <mesh position={[cx, r >= 0 ? 0.11 + h / 2 : -0.11 - h / 2, cz]}
              onPointerOver={(e) => { e.stopPropagation(); onHover({ sector: name, coin: c, cell, r: v.r, fwd: v.fwd }); }}
              onPointerOut={() => onHover(null)}>
              <boxGeometry args={[0.32, h, 0.32]} />
              <meshBasicMaterial color={col} toneMapped={false} transparent opacity={r >= 0 ? 0.95 : 0.6} />
            </mesh>
            <Html position={[cx, (r >= 0 ? h + 0.45 : 0.45), cz]} center style={{ pointerEvents: "none" }}>
              <div className="scene-label" style={{ fontSize: 8, color: "#c9d4f2" }}>{c}</div>
            </Html>
          </group>
        );
      })}
      <Html position={[0, -0.75, rad + 0.4]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label" style={{ fontSize: 10, textAlign: "center", color: cell.side > 0 ? "#7dffad" : cell.side < 0 ? "#ffa36e" : SECT_COL[name] }}>
          <b>{SECT_NAME[name] ?? name}</b><br />{cell.r > 0 ? "+" : ""}{cell.r.toFixed(1)}% · {cell.side > 0 ? "LONG" : cell.side < 0 ? "SHORT" : "flat"}
        </div>
      </Html>
    </group>
  );
}

function BumpChart({ weeks }: { weeks: SceneData["weeks"] }) {
  const W = 16, H = 4.2, Z = -9.5, Y0 = 4.2;
  const n = weeks.length;
  const series = useMemo(() => {
    const out: Record<string, [number, number, number][]> = {};
    weeks.forEach((w, wi) => {
      const ks = Object.keys(w.sectors).sort((a, b) => w.sectors[b].r - w.sectors[a].r);
      ks.forEach((k, rank) => {
        const x = -W / 2 + (n > 1 ? (W * wi) / (n - 1) : 0);
        const y = Y0 + H - (ks.length > 1 ? (H * rank) / (ks.length - 1) : 0);
        (out[k] = out[k] ?? []).push([x, y, Z]);
      });
    });
    return out;
  }, [weeks, n]);
  const dot = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (dot.current) dot.current.children.forEach((m, i) => { m.scale.setScalar(1 + 0.25 * Math.sin(clock.getElapsedTime() * 3 + i)); });
  });
  return (
    <group>
      {Object.entries(series).map(([k, pts]) => (
        pts.length > 1 ? <Line key={k} points={pts} color={SECT_COL[k] ?? "#9fb0d8"} lineWidth={2.2} transparent opacity={0.85} /> : null
      ))}
      <group ref={dot}>
        {Object.entries(series).map(([k, pts]) => (
          <mesh key={k} position={pts[pts.length - 1]}>
            <sphereGeometry args={[0.2, 16, 16]} />
            <meshBasicMaterial color={new THREE.Color(SECT_COL[k] ?? "#9fb0d8").multiplyScalar(2)} toneMapped={false} />
          </mesh>
        ))}
      </group>
      <Html position={[-W / 2 - 0.4, Y0 + H + 0.6, Z]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9, whiteSpace: "nowrap" }}>
          sector rank, last {n} Mondays (top = best 28-day return) →
        </div>
      </Html>
      {weeks.length > 0 && (
        <Html position={[-W / 2, Y0 - 0.6, Z]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis" style={{ fontSize: 8 }}>{weeks[0].t}</div>
        </Html>
      )}
      {weeks.length > 0 && (
        <Html position={[W / 2, Y0 - 0.6, Z]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis" style={{ fontSize: 8 }}>{weeks[weeks.length - 1].t}</div>
        </Html>
      )}
    </group>
  );
}

function Tooltip({ h }: { h: NonNullable<Hover> }) {
  return (
    <Html position={[0, 9.6, 2]} center style={{ pointerEvents: "none" }}>
      <div className="tooltip">
        <div className="tooltip__time">{h.coin ? `${h.coin} · ` : ""}{SECT_NAME[h.sector] ?? h.sector}</div>
        <div className="tooltip__row"><span>{h.coin ? "coin" : "sector"} 28-day return</span>
          <b>{h.r === null || h.r === undefined ? "-" : `${h.r > 0 ? "+" : ""}${h.r.toFixed(1)}%`}</b></div>
        <div className="tooltip__row"><span>book</span><b>{h.cell.side > 0 ? "long this sector" : h.cell.side < 0 ? "short this sector" : "not held"}</b></div>
        {h.fwd !== undefined && h.fwd !== null && (
          <div className="tooltip__row"><span>the following week</span><b>{h.fwd > 0 ? "+" : ""}{h.fwd}%</b></div>
        )}
      </div>
    </Html>
  );
}

function Title({ sc, now }: { sc: SceneData; now: Record<string, SectorCell> }) {
  const longs = Object.keys(now).filter((k) => now[k].side > 0).map((k) => SECT_NAME[k] ?? k).join(", ");
  const shorts = Object.keys(now).filter((k) => now[k].side < 0).map((k) => SECT_NAME[k] ?? k).join(", ");
  return (
    <Html position={[0, 11.8, -9.5]} center style={{ pointerEvents: "none" }}>
      <div className="scene-title">{(sc.title ?? "Sector Momentum").toUpperCase()}</div>
      <div className="scene-label scene-label--axis" style={{ textAlign: "center", maxWidth: 580 }}>
        5 crypto sectors ranked on {sc.lookback_days}-day return · long every coin of the best, short every coin of the worst · weekly
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
    const dist = 25 * Math.max(1, 1.6 / aspect);
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function SectorScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<Hover>(null);
  const [spin, setSpin] = useState(true);
  const weeks = useMemo(() => (scene.weeks ?? []).slice(-16), [scene.weeks]);
  const now: Record<string, SectorCell> = useMemo(() => {
    if (scene.live && Object.keys(scene.live).length) return scene.live;
    return weeks.length ? weeks[weeks.length - 1].sectors : {};
  }, [scene.live, weeks]);
  const names = ORDER.filter((k) => now[k]).concat(Object.keys(now).filter((k) => !ORDER.includes(k)));
  return (
    <Canvas camera={{ position: [0, 9, 18], fov: 42 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05080d")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#05080d", 24, 62]} />
      <ambientLight intensity={0.4} />
      <Stars radius={60} depth={30} count={1800} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={90} scale={[22, 10, 18]} size={1.4} speed={0.25} opacity={0.3} color="#9fd8ff" />
      <group position={[0, -2.4, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.4, 0]}>
          <ringGeometry args={[RING - 0.1, RING + 0.05, 96]} />
          <meshBasicMaterial color="#2a3a66" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
        {names.map((k, i) => (
          <Island key={k} name={k} cell={now[k]} angle={(2 * Math.PI * i) / names.length + Math.PI / names.length} onHover={setHover} />
        ))}
        <BumpChart weeks={weeks} />
        <Title sc={scene} now={now} />
        {hover && <Tooltip h={hover} />}
      </group>
      <OrbitControls target={[0, 0.5, -1]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.3}
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
