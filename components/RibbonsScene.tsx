"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { RibbonsScene as SceneData, RibbonCoin } from "@/lib/types";

// Strategy 27 "Basis-Momentum": premium ribbons. Each coin is a ribbon running from the back (8 weeks ago) to the
// front (this week). Its height is the coin's 7-day mean perp premium over the spot index, in basis points. The
// coins are lined up left to right by how much that premium rose over the last 4 weeks (the signal): risers on the
// right are this week's longs (green), fallers on the left the shorts (orange), the middle is not held (grey). A
// glowing bead marks the latest point. Behind it all, a row of bars shows the last 26 weekly results of the book.

const X_GAP = 1.15;
const Z_SPAN = 14;
const Y_PER_BP = 0.35;   // world units per bp of premium
const Y_CAP = 6;
const C_LONG = new THREE.Color("#4dff8f");
const C_SHORT = new THREE.Color("#ff7a3d");
const C_FLAT = new THREE.Color("#6b7aa8");

type Row = { c: string; r: RibbonCoin; x: number; pts: [number, number, number][] };

function colorOf(w: number) {
  return w > 0 ? C_LONG : w < 0 ? C_SHORT : C_FLAT;
}

function yOf(bp: number) {
  return Math.max(-Y_CAP, Math.min(Y_CAP, bp * Y_PER_BP));
}

function useRows(sc: SceneData): Row[] {
  return useMemo(() => {
    const names = Object.keys(sc.coins ?? {}).sort((a, b) => (sc.coins[a].bm_bp ?? 0) - (sc.coins[b].bm_bp ?? 0) || a.localeCompare(b));
    const n = names.length;
    return names.map((c, i) => {
      const r = sc.coins[c];
      const x = (i - (n - 1) / 2) * X_GAP;
      const path = r.path_bp ?? [];
      const m = path.length;
      const pts: [number, number, number][] = [];
      path.forEach((v, j) => {
        if (v === null || v === undefined) return;
        const z = -Z_SPAN / 2 + (Z_SPAN * j) / Math.max(1, m - 1);
        pts.push([x, yOf(v), z]);
      });
      return { c, r, x, pts };
    });
  }, [sc]);
}

function Ribbon({ row, onHover }: { row: Row; onHover: (r: Row | null) => void }) {
  const bead = useRef<THREE.Mesh>(null);
  const w = row.r.w ?? 0;
  const held = Math.abs(w) > 1e-9;
  const col = colorOf(w);
  const last = row.pts[row.pts.length - 1];
  useFrame(({ clock }) => {
    if (!bead.current || !held) return;
    const k = 1 + 0.18 * Math.sin(clock.getElapsedTime() * 2 + row.x);
    bead.current.scale.set(k, k, k);
  });
  if (row.pts.length < 2 || !last) return null;
  return (
    <group>
      <Line points={row.pts} color={`#${col.getHexString()}`} lineWidth={held ? 2.4 : 1.0} transparent opacity={held ? 0.95 : 0.4} />
      {row.pts.map((p, i) => (
        <Line key={i} points={[[p[0], 0, p[2]], p]} color="#2a3550" lineWidth={0.5} transparent opacity={0.35} />
      ))}
      <mesh ref={bead} position={last}
        onPointerOver={(e) => { e.stopPropagation(); onHover(row); }} onPointerOut={() => onHover(null)}>
        <sphereGeometry args={[held ? 0.3 : 0.2, 18, 18]} />
        <meshBasicMaterial color={col.clone().multiplyScalar(held ? 2.2 : 1.0)} toneMapped={false} />
      </mesh>
      <Html position={[row.x, Math.min(Y_CAP, Math.max(last[1], 0)) + 0.9, Z_SPAN / 2 + 0.8]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9, color: held ? (w > 0 ? "#7dffad" : "#ffa36e") : undefined }}>{row.c}</div>
      </Html>
    </group>
  );
}

function Floor({ n }: { n: number }) {
  const half = ((n - 1) / 2) * X_GAP + 0.8;
  const lines: [number, number, number][][] = [];
  for (const bp of [-10, -5, 0, 5, 10]) {
    lines.push([[-half, yOf(bp), Z_SPAN / 2 + 0.3], [half, yOf(bp), Z_SPAN / 2 + 0.3]]);
  }
  return (
    <group>
      {lines.map((l, i) => <Line key={i} points={l} color={i === 2 ? "#5a6a99" : "#26324f"} lineWidth={i === 2 ? 1.2 : 0.6} transparent opacity={0.6} />)}
      {[-10, -5, 0, 5, 10].map((bp) => (
        <Html key={bp} position={[half + 0.9, yOf(bp), Z_SPAN / 2 + 0.3]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis" style={{ fontSize: 8 }}>{bp} bp</div>
        </Html>
      ))}
      <Html position={[-half - 1.2, 0, -Z_SPAN / 2]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 8 }}>8 weeks ago</div>
      </Html>
      <Html position={[-half - 1.2, 0, Z_SPAN / 2]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 8 }}>this week</div>
      </Html>
    </group>
  );
}

function WeekBars({ sc, n }: { sc: SceneData; n: number }) {
  const ws = (sc.weeks ?? []).slice(-26);
  const m = ws.length;
  const width = Math.max(10, ((n - 1) * X_GAP));
  return (
    <group position={[0, 0, -Z_SPAN / 2 - 3]}>
      {ws.map((wk, i) => {
        const x = -width / 2 + (width * i) / Math.max(1, m - 1);
        const h = Math.max(0.05, Math.min(5, Math.abs(wk.ret_pct) * 0.6));
        const up = wk.ret_pct >= 0;
        return (
          <mesh key={wk.t} position={[x, up ? h / 2 : -h / 2, 0]}>
            <boxGeometry args={[0.3, h, 0.3]} />
            <meshBasicMaterial color={(up ? C_LONG : C_SHORT).clone().multiplyScalar(i === m - 1 ? 2.2 : 1.1)}
              toneMapped={false} transparent opacity={0.8} />
          </mesh>
        );
      })}
      {m > 0 && (
        <Html position={[0, 4.2, 0]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis" style={{ fontSize: 9 }}>last {m} weeks of the book (1x)</div>
        </Html>
      )}
    </group>
  );
}

function Tooltip({ row }: { row: Row }) {
  const w = row.r.w ?? 0;
  const p = row.pts[row.pts.length - 1];
  const path = (row.r.path_bp ?? []).filter((v): v is number => v !== null && v !== undefined);
  return (
    <Html position={p} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${row.x > 2 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">{row.c}</div>
        <div className="tooltip__row"><span>premium now (7-day mean)</span><b>{path.length ? `${path[path.length - 1].toFixed(2)} bp` : "-"}</b></div>
        <div className="tooltip__row"><span>change over 4 weeks (signal)</span><b>{(row.r.bm_bp ?? 0).toFixed(2)} bp</b></div>
        <div className="tooltip__row"><span>this week</span><b>{w > 0 ? "long" : w < 0 ? "short" : "not held"}{w ? ` ${(Math.abs(w) * 100).toFixed(1)}%` : ""}</b></div>
      </div>
    </Html>
  );
}

function Title({ sc, rows }: { sc: SceneData; rows: Row[] }) {
  const longs = rows.filter((r) => (r.r.w ?? 0) > 0).length;
  const shorts = rows.filter((r) => (r.r.w ?? 0) < 0).length;
  const sub = `${longs} rising premiums long · ${shorts} falling premiums short · height = perp premium over spot (bp) · back = 8 weeks ago, front = now${sc.leverage ? ` · ${sc.leverage}x` : ""}${sc.decided ? ` · book of ${sc.decided}` : ""}`;
  return (
    <Html position={[0, 9.5, 0]} center style={{ pointerEvents: "none" }}>
      <div className="scene-title">{(sc.title ?? "Basis-Momentum").toUpperCase()}</div>
      <div className="scene-label scene-label--axis" style={{ textAlign: "center", maxWidth: 560 }}>{sub}</div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 32 * Math.max(1, 1.6 / aspect);
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function RibbonsScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<Row | null>(null);
  const [spin, setSpin] = useState(true);
  const rows = useRows(scene);
  return (
    <Canvas camera={{ position: [10, 12, 24], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05080d")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#05080d", 32, 85]} />
      <ambientLight intensity={0.4} />
      <Stars radius={70} depth={30} count={1600} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={90} scale={[30, 8, 24]} size={1.3} speed={0.25} opacity={0.3} color="#7dd3ff" />
      <group position={[0, -1.5, 0]}>
        <Floor n={rows.length} />
        {rows.map((r) => <Ribbon key={r.c} row={r} onHover={setHover} />)}
        <WeekBars sc={scene} n={rows.length} />
        <Title sc={scene} rows={rows} />
        {hover && <Tooltip row={hover} />}
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.25}
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
