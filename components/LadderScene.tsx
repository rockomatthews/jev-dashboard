"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { LadderCoin, LadderScene as SceneData } from "@/lib/types";

// Strategy 18 "Grid Ladder" (passivbot's martingale grid). Each coin the forager is watching stands as a ladder.
// Height = % from the coin's reference price (its average entry when held, today's price when not).
// Held ladders glow gold: lit rungs are fills (each 10% below the last, each 0.67x the position so far); the cyan
// rung is the next buy; the green halo is the take-profit (average + markup) where the whole ladder is sold.
// Flat coins are dim: the cyan ring is the bait (EMA band - 1.9%) the price bead has to sink to.
// The back wall replays the backtest: the rule (gold) vs the same ladder with random entries (violet) vs holding (orange).

const X_SPAN = 15;
const Y_PER = 0.13;          // world units per % of price
const PCT_MIN = -45;
const PCT_MAX = 8;
const WALL_Z = -5.5;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const C_RAIL = new THREE.Color("#2b3d66");
const C_HELD = new THREE.Color("#ffc94d");
const C_NEXT = new THREE.Color("#35f0c0");
const C_TP = new THREE.Color("#4dff8f");
const C_BAIT = new THREE.Color("#1b9bd0");
const C_DOWN = new THREE.Color("#d96b25");
const C_PLACEBO = new THREE.Color("#9b7bff");

type Lay = { c: LadderCoin; x: number; ref: number; y: (px: number | null | undefined) => number | null };

function useLayout(sc: SceneData) {
  return useMemo(() => {
    const n = Math.max(1, sc.coins.length);
    const dx = X_SPAN / n;
    const lays: Lay[] = sc.coins.map((c, i) => {
      const ref = (c.held && c.avg ? c.avg : c.price) || 1;
      const y = (px: number | null | undefined) =>
        typeof px === "number" && px > 0 ? clamp((px / ref - 1) * 100, PCT_MIN, PCT_MAX) * Y_PER : null;
      return { c, x: -X_SPAN / 2 + dx * (i + 0.5), ref, y };
    });
    return { lays, dx };
  }, [sc]);
}

function rungsFor(c: LadderCoin, stepPct: number): { px: number; filled: boolean; next: boolean }[] {
  const top = c.fills.length ? c.fills[0] : c.entry_level ?? c.price;
  if (!top) return [];
  const out: { px: number; filled: boolean; next: boolean }[] = [];
  const filled = new Set<number>();
  c.fills.forEach((f) => filled.add(Math.round(f * 1e8)));
  // the grid trails the LAST fill, so after the first rung the levels follow the real fills, then 10% steps
  const levels: number[] = c.fills.length ? [...c.fills] : [];
  let p = c.fills.length ? c.fills[c.fills.length - 1] : top;
  for (let k = 0; k < 6; k++) {
    p = p * (1 - stepPct / 100);
    levels.push(p);
  }
  levels.forEach((px, k) => out.push({ px, filled: k < c.fills.length, next: c.held && k === c.fills.length }));
  return out;
}

function Ladder({ sc, l, dx, onHover }: { sc: SceneData; l: Lay; dx: number; onHover: (c: LadderCoin | null) => void }) {
  const bead = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const w = Math.min(0.9, dx * 0.55);
  const yTop = PCT_MAX * Y_PER;
  const yBot = PCT_MIN * Y_PER;
  const held = l.c.held;
  const yPx = l.y(l.c.price) ?? 0;
  const rungs = useMemo(() => rungsFor(l.c, sc.step_pct), [l.c, sc.step_pct]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (bead.current) bead.current.position.y = yPx + 0.04 * Math.sin(t * 2.2 + l.x);
    if (halo.current) {
      const s = 1 + 0.12 * Math.sin(t * 2.8 + l.x);
      halo.current.scale.set(s, s, s);
    }
  });
  const railCol = held ? C_HELD.clone().multiplyScalar(0.9) : C_RAIL;
  const yTp = l.y(l.c.tp);
  const yAvg = l.y(l.c.avg);
  const yBait = held ? null : l.y(l.c.entry_level);
  const under = held && l.c.avg ? l.c.price < l.c.avg : false;
  return (
    <group position={[l.x, 0, 0]}>
      {[-w / 2, w / 2].map((ox) => (
        <Line key={ox} points={[[ox, yBot, 0], [ox, yTop, 0]]} color={railCol} lineWidth={held ? 2 : 1}
          transparent opacity={held ? 0.9 : 0.45} />
      ))}
      {rungs.map((r, k) => {
        const y = l.y(r.px);
        if (y === null || y <= yBot + 0.001) return null;
        const col = r.filled ? C_HELD.clone().multiplyScalar(2.6) : r.next ? C_NEXT.clone().multiplyScalar(2.2) : C_RAIL;
        return (
          <mesh key={k} position={[0, y, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[r.filled || r.next ? 0.045 : 0.022, r.filled || r.next ? 0.045 : 0.022, w, 8]} />
            <meshBasicMaterial color={col} toneMapped={false} transparent opacity={r.filled || r.next ? 1 : 0.5} />
          </mesh>
        );
      })}
      {yTp !== null && (
        <mesh ref={halo} position={[0, yTp, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[w * 0.75, 0.035, 10, 40]} />
          <meshBasicMaterial color={C_TP.clone().multiplyScalar(2.4)} toneMapped={false} />
        </mesh>
      )}
      {yBait !== null && (
        <mesh ref={halo} position={[0, yBait, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[w * 0.6, 0.025, 8, 36]} />
          <meshBasicMaterial color={C_BAIT.clone().multiplyScalar(1.8)} toneMapped={false} transparent opacity={0.8} />
        </mesh>
      )}
      {yAvg !== null && yAvg !== yPx && (
        <Line points={[[0, yAvg, 0], [0, yPx, 0]]} color={(under ? C_DOWN : C_TP).clone().multiplyScalar(1.6)}
          lineWidth={3} toneMapped={false} />
      )}
      <mesh ref={bead} position={[0, yPx, 0]}
        onPointerOver={(e) => { e.stopPropagation(); onHover(l.c); }} onPointerOut={() => onHover(null)}>
        <sphereGeometry args={[held ? 0.16 : 0.11, 16, 16]} />
        <meshBasicMaterial color={(held ? new THREE.Color("#ffffff") : C_BAIT).clone().multiplyScalar(held ? 2.6 : 1.4)}
          toneMapped={false} />
      </mesh>
      <mesh position={[0, (yTop + yBot) / 2, 0]} visible={false}
        onPointerOver={(e) => { e.stopPropagation(); onHover(l.c); }} onPointerOut={() => onHover(null)}>
        <boxGeometry args={[w * 1.2, yTop - yBot, 0.4]} />
      </mesh>
      <Html position={[0, yBot - 0.35, 0]} center style={{ pointerEvents: "none" }}>
        <div className={held ? "scene-label scene-label--held" : "scene-label scene-label--axis"}>
          <span className="scene-label__coin">{l.c.coin}</span>
          {held && <span>{l.c.fills.length} rung{l.c.fills.length === 1 ? "" : "s"}</span>}
        </div>
      </Html>
    </group>
  );
}

function Wall({ sc }: { sc: SceneData }) {
  const curves = useMemo(() => {
    const n = sc.equity_pct.length;
    if (n < 2) return null;
    const all = [...sc.equity_pct, ...sc.placebo_pct, ...sc.hold_pct];
    const lo = Math.min(...all, -10);
    const hi = Math.max(...all, 10);
    const H = 4.2;
    const y0 = 1.6;
    const map = (arr: number[]) => arr.map((v, k) =>
      [-X_SPAN / 2 + (X_SPAN * k) / (n - 1), y0 + ((v - lo) / (hi - lo)) * H, WALL_Z] as [number, number, number]);
    return { s: map(sc.equity_pct), p: map(sc.placebo_pct), h: map(sc.hold_pct), zero: y0 + ((0 - lo) / (hi - lo)) * H, top: y0 + H };
  }, [sc]);
  if (!curves) return null;
  const last = (a: number[]) => (a.length ? a[a.length - 1] : 0);
  const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`;
  return (
    <group>
      <mesh position={[0, (curves.top + 1.4) / 2, WALL_Z - 0.05]}>
        <planeGeometry args={[X_SPAN + 1, curves.top - 1.2]} />
        <meshBasicMaterial color="#070d18" transparent opacity={0.55} />
      </mesh>
      <Line points={[[-X_SPAN / 2, curves.zero, WALL_Z], [X_SPAN / 2, curves.zero, WALL_Z]]} color="#2b3658" lineWidth={1} />
      <Line points={curves.h} color={C_DOWN.clone().multiplyScalar(1.3)} lineWidth={1.4} toneMapped={false} transparent opacity={0.8} />
      <Line points={curves.p} color={C_PLACEBO.clone().multiplyScalar(1.4)} lineWidth={1.4} toneMapped={false} transparent opacity={0.85} />
      <Line points={curves.s} color={C_HELD.clone().multiplyScalar(2.2)} lineWidth={2.6} toneMapped={false} />
      <Html position={[X_SPAN / 2 + 0.3, curves.s[curves.s.length - 1][1], WALL_Z]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ color: "#ffc94d" }}>grid {fmt(last(sc.equity_pct))}</div>
      </Html>
      <Html position={[X_SPAN / 2 + 0.3, curves.p[curves.p.length - 1][1] - 0.25, WALL_Z]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ color: "#9b7bff" }}>random entries {fmt(last(sc.placebo_pct))}</div>
      </Html>
      <Html position={[X_SPAN / 2 + 0.3, curves.h[curves.h.length - 1][1], WALL_Z]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ color: "#d96b25" }}>hold all {fmt(last(sc.hold_pct))}</div>
      </Html>
      <Html position={[-X_SPAN / 2, curves.top + 0.25, WALL_Z]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis">backtest {sc.weeks[0]} → {sc.weeks[sc.weeks.length - 1]} (1x, after costs)</div>
      </Html>
    </group>
  );
}

function DepthBars({ sc }: { sc: SceneData }) {
  // closed backtest cycles by how many rungs they needed: the martingale's tail, on the floor
  const keys = Object.keys(sc.fills_hist).sort((a, b) => Number(a) - Number(b));
  const max = Math.max(1, ...keys.map((k) => sc.fills_hist[k]));
  const z = 3.2;
  return (
    <group position={[0, PCT_MIN * Y_PER, z]}>
      {keys.map((k, i) => {
        const v = sc.fills_hist[k];
        const h = 0.08 + (Math.log1p(v) / Math.log1p(max)) * 1.6;
        const x = -X_SPAN / 2 + 0.6 + i * 0.75;
        const col = C_HELD.clone().lerp(C_DOWN, i / Math.max(1, keys.length - 1)).multiplyScalar(1.6);
        return (
          <group key={k} position={[x, 0, 0]}>
            <mesh position={[0, h / 2, 0]}>
              <boxGeometry args={[0.45, h, 0.45]} />
              <meshBasicMaterial color={col} toneMapped={false} transparent opacity={0.85} />
            </mesh>
            <Html position={[0, h + 0.25, 0]} center style={{ pointerEvents: "none" }}>
              <div className="scene-label scene-label--axis">{v}</div>
            </Html>
            <Html position={[0, -0.25, 0.3]} center style={{ pointerEvents: "none" }}>
              <div className="scene-label scene-label--axis">{k}</div>
            </Html>
          </group>
        );
      })}
      <Html position={[-X_SPAN / 2 + 0.3, -0.7, 0.3]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis">backtest cycles by rungs filled</div>
      </Html>
    </group>
  );
}

function Axes({ sc }: { sc: SceneData }) {
  const x0 = -X_SPAN / 2 - 0.6;
  const ticks = [5, 0, -10, -20, -30, -40];
  const lv = sc.live;
  const sub = [
    `step ${sc.step_pct}% · add ${sc.ddf}x · sell at avg +${sc.markup_pct}%`,
    `${sc.cycles} backtest cycles, ${sc.win_rate_pct}% green, avg ${sc.avg_fills} rungs`,
    lv ? `live: ${lv.cycles} closed (${lv.wins} green) · gross ${(lv.gross_x ?? 0).toFixed(2)}x · random-entry twin $${(lv.shadow_equity ?? 10000).toFixed(0)}` : null,
  ].filter(Boolean);
  return (
    <group>
      {ticks.map((t) => (
        <group key={t}>
          <Html position={[x0, t * Y_PER, 0]} center style={{ pointerEvents: "none" }}>
            <div className="scene-label scene-label--axis">{t > 0 ? "+" : ""}{t}%</div>
          </Html>
          <Line points={[[x0 + 0.3, t * Y_PER, 0], [X_SPAN / 2, t * Y_PER, 0]]} color={t === 0 ? "#3a4a78" : "#16203a"}
            lineWidth={t === 0 ? 1.2 : 0.8} transparent opacity={0.6} />
        </group>
      ))}
      <Html position={[0, PCT_MAX * Y_PER + 1.0, WALL_Z + 0.5]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title">{(sc.title ?? "Grid Ladder").toUpperCase()}</div>
        {sub.map((s, k) => (
          <div key={k} className="scene-label scene-label--axis" style={{ textAlign: "center" }}>{s}</div>
        ))}
      </Html>
      {!sc.coins.length && (
        <Html position={[0, 0, 0]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis">waiting for the first hourly check…</div>
        </Html>
      )}
    </group>
  );
}

function Tooltip({ l }: { l: Lay }) {
  const c = l.c;
  const f = (v?: number | null) => (typeof v === "number" ? (v >= 100 ? v.toFixed(2) : v.toPrecision(5)) : "–");
  const pct = (v?: number | null) => (typeof v === "number" && c.price ? `${((v / c.price - 1) * 100).toFixed(1)}%` : "");
  return (
    <Html position={[l.x, (l.y(c.price) ?? 0) + 0.3, 0]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${l.x > 3 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">{c.coin} · {c.held ? `held ${c.age_h ?? 0}h` : "watching"}</div>
        <div className="tooltip__row"><span>price</span><b>{f(c.price)}</b></div>
        {c.held ? (
          <>
            <div className="tooltip__row"><span>average entry</span><b>{f(c.avg)}</b></div>
            <div className="tooltip__row"><span>sell all at</span><b>{f(c.tp)} ({pct(c.tp)})</b></div>
            <div className="tooltip__row"><span>next rung</span><b>{f(c.next)} ({pct(c.next)})</b></div>
            <div className="tooltip__row"><span>rungs filled</span><b>{c.fills.length}</b></div>
            <div className="tooltip__row"><span>size</span><b>${(c.usd ?? 0).toFixed(0)}</b></div>
            <div className="tooltip__row"><span>worst vs average</span><b>{(c.worst_pct ?? 0).toFixed(1)}%</b></div>
          </>
        ) : (
          <div className="tooltip__row"><span>buys at</span><b>{f(c.entry_level)} ({pct(c.entry_level)})</b></div>
        )}
      </div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 20 * Math.max(1, 1.7 / aspect);
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function LadderScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<LadderCoin | null>(null);
  const { lays, dx } = useLayout(scene);
  const hov = hover ? lays.find((l) => l.c.coin === hover.coin) : undefined;
  return (
    <Canvas camera={{ position: [7, 4, 16], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#04080b")}>
      <CameraFit />
      <fog attach="fog" args={["#04080b", 20, 60]} />
      <ambientLight intensity={0.45} />
      <pointLight position={[-8, 4, 6]} intensity={24} color="#ffc94d" />
      <Stars radius={60} depth={30} count={1600} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={90} scale={[18, 8, 12]} size={1.4} speed={0.3} opacity={0.3} color="#ffc94d" />
      <group position={[0, 0.6, 0]}>
        <Wall sc={scene} />
        {lays.map((l) => <Ladder key={l.c.coin} sc={scene} l={l} dx={dx} onHover={setHover} />)}
        <DepthBars sc={scene} />
        <Axes sc={scene} />
        {hov && <Tooltip l={hov} />}
      </group>
      <OrbitControls target={[0, 0.2, 0]} enablePan={false} enableZoom={false} autoRotate={false}
        minAzimuthAngle={-Math.PI / 3} maxAzimuthAngle={Math.PI / 3}
        minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 2.05} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.05} luminanceThreshold={0.35} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
