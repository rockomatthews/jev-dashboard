"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { EchoBar, EchoScene as SceneData } from "@/lib/types";

// Strategy 15 "Roll-Off Echo": the last 60 days as a field of 4h columns - one row per UTC day (oldest at the
// back), six columns per row (00, 04, ... 20 UTC). Column height = the market's 4h move (green up, orange down).
// The bar directly behind any column is the same 4h slot 24 hours earlier: the one rolling out of every
// exchange's "24h change". When that old bar was a 2-sigma move, a gold echo arc jumps forward one row to the
// traded bar, and an orb shows what the trade made (bright = won). Front: the live gauge for the current bar.

const X_SPAN = 9;
const Z_SPAN = 13;
const Y_PER = 0.55; // world units per 1% market move
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const DAY = 86_400_000;
const BAR = 4 * 3_600_000;

const C_UP = new THREE.Color("#35f0c0");
const C_DOWN = new THREE.Color("#d96b25");
const C_ECHO = new THREE.Color("#ffc94d");
const C_WIN = new THREE.Color("#4dff8f");
const C_LOSS = new THREE.Color("#ff5a5a");
const C_GRID = new THREE.Color("#1d2740");

type Cell = { b: EchoBar; col: number; row: number; x: number; z: number; h: number };

function useLayout(sc: SceneData) {
  return useMemo(() => {
    const bars = sc.bars ?? [];
    const d0 = bars.length ? Math.floor(bars[0].t / DAY) : 0;
    const d1 = bars.length ? Math.floor(bars[bars.length - 1].t / DAY) : 0;
    const rows = d1 - d0 + 1;
    const dx = X_SPAN / 6;
    const dz = Z_SPAN / Math.max(1, rows + 3);
    const xAt = (c: number) => -X_SPAN / 2 + dx * (c + 0.5);
    const zAt = (r: number) => -Z_SPAN / 2 + dz * (r + 0.5);
    const cells: Cell[] = bars.map((b) => {
      const row = Math.floor(b.t / DAY) - d0;
      const col = Math.floor((b.t % DAY) / BAR);
      const h = typeof b.m === "number" ? clamp(b.m, -8, 8) * Y_PER : 0;
      return { b, col, row, x: xAt(col), z: zAt(row), h };
    });
    const byT = new Map(cells.map((c) => [c.b.t, c]));
    return { cells, byT, dx, dz, xAt, zAt, rows, liveZ: zAt(rows + 1.6), d0 };
  }, [sc]);
}

function Columns({ sc, onHover }: { sc: SceneData; onHover: (c: Cell | null) => void }) {
  const { cells, dx, dz } = useLayout(sc);
  return (
    <group>
      {cells.map((c) => {
        if (typeof c.b.m !== "number") return null;
        const h = Math.max(0.02, Math.abs(c.h));
        const base = c.b.m >= 0 ? C_UP : C_DOWN;
        const col = C_GRID.clone().lerp(base, clamp(Math.abs(c.b.m) / 2.5, 0.25, 1));
        return (
          <mesh key={c.b.t} position={[c.x, c.h >= 0 ? h / 2 : -h / 2, c.z]}
            onPointerOver={(e) => { e.stopPropagation(); onHover(c); }} onPointerOut={() => onHover(null)}>
            <boxGeometry args={[dx * 0.62, h, dz * 0.62]} />
            <meshStandardMaterial color={col} emissive={col} emissiveIntensity={Math.abs(c.b.m) > 2 ? 0.9 : 0.25}
              transparent opacity={0.85} />
          </mesh>
        );
      })}
    </group>
  );
}

function Echoes({ sc }: { sc: SceneData }) {
  const { cells, byT } = useLayout(sc);
  const lag = sc.lag_bars ?? 6;
  return (
    <group>
      {cells.filter((c) => c.b.side !== 0).map((c) => {
        const src = byT.get(c.b.t - lag * BAR);
        const won = (c.b.pnl ?? 0) > 0;
        const orbY = Math.max(c.h, 0) + 0.35;
        const pts: [number, number, number][] = [];
        if (src) {
          const y0 = src.h;
          for (let k = 0; k <= 16; k++) {
            const f = k / 16;
            pts.push([src.x + (c.x - src.x) * f, y0 + (orbY - y0) * f + Math.sin(Math.PI * f) * 1.4, src.z + (c.z - src.z) * f]);
          }
        }
        const col = (c.b.pnl === null ? C_ECHO : won ? C_WIN : C_LOSS).clone().multiplyScalar(2.2);
        return (
          <group key={c.b.t}>
            {pts.length > 1 && <Line points={pts} color={C_ECHO.clone().multiplyScalar(1.8)} lineWidth={2} toneMapped={false} transparent opacity={0.85} />}
            <mesh position={[c.x, orbY, c.z]}>
              <sphereGeometry args={[0.11 + clamp(Math.abs(c.b.pnl ?? 0), 0, 6) * 0.025, 14, 14]} />
              <meshBasicMaterial color={col} toneMapped={false} />
            </mesh>
            <Html position={[c.x, orbY + 0.32, c.z]} center style={{ pointerEvents: "none" }}>
              <div className="scene-label scene-label--held">
                <span className="scene-label__coin">{c.b.side > 0 ? "BUY" : "SHORT"}</span>
                {c.b.pnl !== null && <span>{c.b.pnl > 0 ? "+" : ""}{c.b.pnl.toFixed(1)}%</span>}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function LiveGauge({ sc }: { sc: SceneData }) {
  const { xAt, liveZ, zAt, rows } = useLayout(sc);
  const ring = useRef<THREE.Mesh>(null);
  const live = sc.live;
  const bar = live?.bar ?? null;
  const col = bar !== null ? Math.floor((bar % DAY) / BAR) : 0;
  const z = live?.z ?? null;
  const side = live?.side ?? 0;
  useFrame(({ clock }) => {
    if (ring.current) ring.current.rotation.z = clock.getElapsedTime() * (side ? 1.6 : 0.4);
  });
  if (!live || bar === null) return null;
  const thr = sc.thr ?? 2;
  const fill = clamp(Math.abs(z ?? 0) / thr, 0, 1.6);
  const tone = (side ? C_ECHO : z !== null && Math.abs(z) > thr * 0.6 ? C_UP : C_GRID.clone().lerp(C_UP, 0.5)).clone().multiplyScalar(side ? 2.4 : 1.4);
  const x = xAt(col);
  const word = side > 0 ? "BUYING the echo" : side < 0 ? "SHORTING the echo" : "flat - no big bar rolling out";
  return (
    <group position={[x, 0, liveZ]}>
      <mesh ref={ring} rotation={[0, 0, 0]} position={[0, 0.9, 0]}>
        <torusGeometry args={[0.55, 0.05, 12, 64, Math.PI * 2 * Math.min(1, fill)]} />
        <meshBasicMaterial color={tone} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.9, 0]}>
        <torusGeometry args={[0.55, 0.012, 8, 64]} />
        <meshBasicMaterial color="#2b3658" />
      </mesh>
      <Line points={[[0, 0.9, 0], [0, 0.2, zAt(rows - 1) - liveZ]]} color={tone} lineWidth={1} dashed dashSize={0.15} gapSize={0.1} />
      <Html position={[0, 1.75, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--held">
          <span className="scene-label__coin">NOW</span>
          <span>z {z === null ? "?" : z.toFixed(2)} / ±{thr}</span>
          <span>{word}</span>
        </div>
      </Html>
    </group>
  );
}

function Axes({ sc }: { sc: SceneData }) {
  const { xAt, zAt, rows, d0, liveZ } = useLayout(sc);
  const ticks = useMemo(() => {
    const out: { r: number; label: string }[] = [];
    const step = Math.max(1, Math.round(rows / 6));
    for (let r = 0; r < rows; r += step) out.push({ r, label: new Date((d0 + r) * DAY).toISOString().slice(5, 10) });
    return out;
  }, [rows, d0]);
  const x0 = -X_SPAN / 2 - 0.4;
  const sub = [
    typeof sc.events_total === "number" ? `${sc.events_total} echo trades since Jul 2024` : null,
    typeof sc.hit_rate_pct === "number" ? `${sc.hit_rate_pct}% won` : null,
    typeof sc.avg_event_net_pct === "number" ? `avg ${sc.avg_event_net_pct > 0 ? "+" : ""}${(sc.avg_event_net_pct * 100).toFixed(0)} bp per trade after costs (1x)` : null,
  ].filter(Boolean).join(" · ");
  return (
    <group>
      {[0, 1, 2, 3, 4, 5].map((c) => (
        <Html key={c} position={[xAt(c), -0.3, liveZ + 1.0]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis">{String(c * 4).padStart(2, "0")}h</div>
        </Html>
      ))}
      {ticks.map((t) => (
        <Html key={t.r} position={[x0 - 0.3, 0, zAt(t.r)]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis">{t.label}</div>
        </Html>
      ))}
      <Html position={[0, 4.4, -Z_SPAN / 2 - 1.0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title">{(sc.title ?? "Roll-Off Echo").toUpperCase()}</div>
        {sub && <div className="scene-label scene-label--axis" style={{ textAlign: "center" }}>{sub}</div>}
      </Html>
      <Line points={[[x0, 0, -Z_SPAN / 2], [x0, 0, liveZ + 0.4]]} color="#2b3658" lineWidth={1} />
    </group>
  );
}

function Tooltip({ c, sc }: { c: Cell; sc: SceneData }) {
  const when = new Date(c.b.t).toISOString().slice(5, 16).replace("T", " ");
  return (
    <Html position={[c.x, Math.max(c.h, 0) + 0.4, c.z]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${c.x > 1 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">{when} UTC (4h bar)</div>
        <div className="tooltip__row"><span>market move</span><b>{c.b.m === null ? "open" : `${c.b.m > 0 ? "+" : ""}${c.b.m.toFixed(2)}%`}</b></div>
        <div className="tooltip__row"><span>bar 24h earlier</span><b>{c.b.z === null ? "?" : `${c.b.z.toFixed(1)}σ`}</b></div>
        <div className="tooltip__row"><span>book</span><b>{c.b.side === 0 ? "flat" : `${c.b.side > 0 ? "long" : "short"} ${sc.lev ?? 3}x · ${c.b.pnl === null ? "open" : `${c.b.pnl > 0 ? "+" : ""}${c.b.pnl.toFixed(2)}%`}`}</b></div>
      </div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 19 * Math.max(1, 1.6 / aspect);
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function EchoScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<Cell | null>(null);
  const [spin, setSpin] = useState(true);
  return (
    <Canvas camera={{ position: [10, 9, 13], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05070c")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#05070c", 20, 60]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[6, 12, 8]} intensity={1.4} color="#fff6e0" />
      <pointLight position={[-8, 5, 6]} intensity={26} color="#ffc94d" />
      <Stars radius={60} depth={30} count={1600} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={80} scale={[16, 6, 16]} size={1.5} speed={0.3} opacity={0.3} color="#ffc94d" />
      <group position={[0, -1.0, 0]}>
        <Columns sc={scene} onHover={setHover} />
        <Echoes sc={scene} />
        <LiveGauge sc={scene} />
        <Axes sc={scene} />
        {hover && <Tooltip c={hover} sc={scene} />}
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.3}
        minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.1} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.0} luminanceThreshold={0.4} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
