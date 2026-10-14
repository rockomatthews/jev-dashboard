"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

// Strategy 26 "Lot elevator": every coin the lot engine trades is a glass tube standing on a ring. The cyan halo is
// the coin's live price. Each $50 lot is a disc inside the tube at the height of its entry price relative to now
// (2% per unit), with a thin gold tick above it at its maker target. Discs above the halo are winners waiting to be
// lifted; discs below it are bags the never-loss rule is holding (orange, brighter the deeper). Lots that just sold
// fly up out of the tube as green sparks.

export type LotCoin = {
  coin: string; bid: number | null; ask: number | null; chg24: number | null; closed: number; net: number;
  blocked: string | null; spark: number[];
  lots: { id: string; entry: number; target: number; age_s: number; pnl: number }[];
};
export type LotClosed = { coin: string; id: string; open: number; close: number; hold_s: number; entry: number; exit: number; net: number; target_p: number };
export type LotSummary = {
  lots_closed: number; realized: number; wins: number; held_lots: number; held_cost: number; held_value: number;
  held_pnl: number; hold_median_s: number | null; net_per_lot: number | null; flow_limit: number; entries: number;
  blocked_crash: number; blocked_flow: number;
};
export type LotBacktest = {
  days: number; coins: number; lots_closed: number; realized: number; fees: number; net_per_lot: number | null;
  hold_median_s: number | null; held_lots: number; held_cost: number; held_value: number; held_pnl: number;
  final_equity: number; return_pct: number; max_drawdown: number; curve: [number, number][];
  per_coin: { coin: string; closed: number; net: number }[]; method: string; generated_ms: number;
};
export type LotRun5 = {
  start_ms: number; snap_ms: number; hours: number; capital: number; lots_closed: number; slices: number; wins: number;
  realized: number; net_per_lot_median: number | null; hold_median_s: number | null; hold_p90_s: number | null;
  held_lots: number; held_cost: number; held_value: number; held_pnl: number; net_after_bags: number; coins: number;
  taker_entries: number; cap: [number, number][];
  by_coin: { coin: string; lots: number; net: number; held: number; held_pnl: number }[];
  settings: Record<string, unknown>;
};
export type LotInfo = {
  coins: LotCoin[]; closed: LotClosed[]; summary: LotSummary; config: Record<string, unknown>;
  kill_reason: string; last_error: string; last_step_ms: number; backtest: LotBacktest | null; run5: LotRun5 | null;
};

const R = 8.5;
const UNIT = 0.02;          // 2% of price per scene unit
const TUBE_H = 5;
const C_HALO = new THREE.Color("#35d8f0");
const C_WIN = new THREE.Color("#3ecf8e");
const C_BAG = new THREE.Color("#ff7a3d");
const C_TGT = new THREE.Color("#ffc94d");

const yOf = (px: number, now: number) => Math.max(-TUBE_H / 2, Math.min(TUBE_H / 2, (px / now - 1) / UNIT));

function Tube({ c, pos, hovered, onHover, recent }: {
  c: LotCoin; pos: THREE.Vector3; hovered: boolean; onHover: (k: string | null) => void; recent: LotClosed[];
}) {
  const halo = useRef<THREE.Mesh>(null);
  const sparks = useRef<THREE.Group>(null);
  const now = c.bid ?? c.lots[0]?.entry ?? 1;
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (halo.current) halo.current.rotation.z = t * 0.6;
    if (sparks.current) {
      sparks.current.children.forEach((m, i) => {
        const k = (t * 0.5 + i * 0.37) % 1;
        m.position.y = TUBE_H / 2 * 0.2 + k * TUBE_H * 0.9;
        ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 1 - k;
      });
    }
  });
  const bagDepth = (l: LotCoin["lots"][number]) => Math.min(1, Math.max(0, (1 - now / l.entry) / 0.08));  // 8% under = darkest
  return (
    <group position={pos}>
      {/* glass tube */}
      <mesh onPointerOver={(e) => { e.stopPropagation(); onHover(c.coin); }} onPointerOut={() => onHover(null)}>
        <cylinderGeometry args={[0.32, 0.32, TUBE_H, 24, 1, true]} />
        <meshStandardMaterial color="#16223c" emissive={hovered ? "#2a4170" : "#101a30"} transparent opacity={0.35}
          side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* live price halo */}
      <mesh ref={halo} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.46, 0.03, 8, 48]} />
        <meshBasicMaterial color={(c.blocked ? C_BAG : C_HALO).clone().multiplyScalar(2.2)} toneMapped={false} />
      </mesh>
      {/* lots: discs at entry, ticks at target */}
      {c.lots.map((l) => {
        const y = yOf(l.entry, now);
        const ty = yOf(l.target, now);
        const bag = l.pnl < 0;
        const col = bag ? C_BAG.clone().lerp(new THREE.Color("#ff3355"), bagDepth(l)) : C_WIN;
        return (
          <group key={l.id}>
            <mesh position={[0, y, 0]}>
              <cylinderGeometry args={[0.27, 0.27, 0.06, 24]} />
              <meshBasicMaterial color={col.clone().multiplyScalar(bag ? 1.6 : 2.2)} toneMapped={false} />
            </mesh>
            <Line points={[[0, y, 0], [0, ty, 0]]} color={C_TGT.getStyle()} lineWidth={0.6} transparent opacity={0.35} />
            <mesh position={[0, ty, 0]}>
              <boxGeometry args={[0.2, 0.015, 0.2]} />
              <meshBasicMaterial color={C_TGT.clone().multiplyScalar(1.8)} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
      {/* recent sells fly out of the top */}
      <group ref={sparks}>
        {recent.slice(-5).map((x) => (
          <mesh key={x.id}>
            <sphereGeometry args={[0.07, 10, 10]} />
            <meshBasicMaterial color={C_WIN.clone().multiplyScalar(2.6)} transparent toneMapped={false} />
          </mesh>
        ))}
      </group>
      <Html position={[0, -TUBE_H / 2 - 0.45, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label">
          <span className="scene-label__coin">{c.coin.replace("-USDT", "").replace("-USDC", "·c")}</span>
          <span className={`pol pol--${c.net > 0 ? "gain" : "flat"}`}>{c.lots.length}/6</span>
        </div>
      </Html>
      {hovered && (
        <Html position={[0, TUBE_H / 2 + 1.6, 0]} center style={{ pointerEvents: "none" }}>
          <div className="tooltip">
            <div className="tooltip__time">{c.coin}{c.blocked ? ` · ${c.blocked}` : ""}</div>
            <div className="tooltip__row"><span>Bid / 24h</span><b>{c.bid ?? "—"} · {c.chg24 === null ? "—" : `${(c.chg24 * 100).toFixed(1)}%`}</b></div>
            <div className="tooltip__row"><span>Lots held</span><b>{c.lots.length} · {c.lots.filter((l) => l.pnl < 0).length} under water</b></div>
            <div className="tooltip__row"><span>Bags P&amp;L</span><b>{c.lots.reduce((a, l) => a + l.pnl, 0).toFixed(2)}</b></div>
            <div className="tooltip__row"><span>Closed · net</span><b>{c.closed} · +${c.net.toFixed(2)}</b></div>
          </div>
        </Html>
      )}
    </group>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 20 * Math.max(1, 1.6 / aspect);
    const dir = camera.position.clone().normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function LotScene({ info, active = true }: { info: LotInfo; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<string | null>(null);
  const [spin, setSpin] = useState(true);
  const coins = useMemo(() => [...info.coins].sort((a, b) => b.lots.length - a.lots.length || b.net - a.net).slice(0, 36), [info.coins]);
  const recentBy = useMemo(() => {
    const out: Record<string, LotClosed[]> = {};
    const cut = (info.last_step_ms || Date.now()) - 15 * 60_000;
    info.closed.filter((x) => x.close >= cut).forEach((x) => { (out[x.coin] ||= []).push(x); });
    return out;
  }, [info.closed, info.last_step_ms]);
  const s = info.summary;
  return (
    <Canvas camera={{ position: [0, 7, 17], fov: 42 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05070c")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#05070c", 20, 55]} />
      <ambientLight intensity={0.6} />
      <pointLight position={[0, 9, 6]} intensity={30} color="#9fd8ff" />
      <Stars radius={60} depth={30} count={1800} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={80} scale={[22, 8, 22]} size={1.3} speed={0.25} opacity={0.3} color="#ffc94d" />
      <group position={[0, -0.6, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -TUBE_H / 2 - 0.05, 0]}>
          <ringGeometry args={[R - 0.5, R + 0.5, 128]} />
          <meshBasicMaterial color="#121c33" side={THREE.DoubleSide} />
        </mesh>
        {coins.map((c, i) => {
          const a = (i / Math.max(1, coins.length)) * Math.PI * 2;
          return <Tube key={c.coin} c={c} pos={new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R)}
            hovered={hover === c.coin} onHover={setHover} recent={recentBy[c.coin] ?? []} />;
        })}
        {coins.length === 0 && (
          <Html position={[0, 0, 0]} center style={{ pointerEvents: "none" }}>
            <div className="scene-title scene-title--zone">WAITING FOR OKX PRICES…</div>
          </Html>
        )}
        <Html position={[0, TUBE_H / 2 + 1.3, 0]} center style={{ pointerEvents: "none" }}>
          <div className="kalshi-hud">
            <div><span>realized (lots sold)</span><b className="pol pol--gain">+${s.realized.toFixed(2)}</b><em>{s.lots_closed} lots</em></div>
            <div><span>bags (held, at the bid)</span><b className={`pol pol--${s.held_pnl < 0 ? "loss" : "gain"}`}>{s.held_pnl < 0 ? "−" : "+"}${Math.abs(s.held_pnl).toFixed(2)}</b><em>{s.held_lots} lots · ${s.held_cost.toFixed(0)} in</em></div>
          </div>
        </Html>
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.3}
        minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.05} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.1} luminanceThreshold={0.3} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
