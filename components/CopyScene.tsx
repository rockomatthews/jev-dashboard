"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

// Strategy 25 "Copy relay": every trader the desk watches is a star on an outer ring. Gold stars are the leaders
// we copy, blue ones are candidates whose trades only feed the tape. Each buy a trader makes flies in as a comet
// toward the gate at the centre: two rings, the outer one Rugcheck's facts, the inner one Grok's verdict.
// Copied buys pass through and become planets orbiting above the gate (size = ticket, green = up, orange = down).
// Buys the gate refused stop at the ring they failed and drop away as red sparks.

export type CopyCandidate = {
  key?: string; sol?: string | null; evm?: string | null; last_tx?: Record<string, number>;
  handle: string | null; name?: string | null; wallet: string; leader: boolean; source?: string | null;
  on_board?: boolean; followers?: number | null; pnl24h_usd?: number | null; trades?: number | null;
  observed_days?: number; buys?: number; sells?: number; closed_trades?: number; win_rate?: number | null;
  pnl_30d_usd?: number | null; pnl_7d_usd?: number | null; avg_hold_minutes?: number | null;
};
export type CopyEvent = {
  ts: number; handle: string; key?: string | null; chain?: string; wallet: string; mint: string; side: "BUY" | "SELL"; usd: number;
  status: string; why: string; symbol?: string | null; confidence?: number | null;
};
export type CopyBlock = {
  leaders: { handle: string; wallet: string; why?: string; risk?: string; rank?: number }[];
  leaders_source: string; last_pick_ms: number; next_pick_ms: number | null;
  candidates: CopyCandidate[]; events: CopyEvent[]; counts: Record<string, number>; pick_log: string[];
  tape_swaps: number; missed_tx: number;
  rpc: { calls: number; errors: number; last_error: string; endpoint: string | null };
  grok: { via: string; calls_last_hour: number; budget_per_hour: number };
  rules: { min_leader_usd: number; max_signal_age_s: number; min_confidence: number; mirror_min_frac: number;
    trader: { min_closed_trades: number; min_win_rate: number; max_top_coin_share: number; min_pnl_7d_usd: number } };
};
export type CopyHolding = { key: string; symbol: string; cost_usd: number; ret: number; leader?: string; confidence?: number };
export type CopyInfo = { copy?: CopyBlock; holdings: CopyHolding[] };

const R = 9;          // trader ring
const GATE_FACTS = 2.4;
const GATE_GROK = 1.4;
const C_LEAD = new THREE.Color("#ffc94d");
const C_CAND = new THREE.Color("#4f8fe8");
const C_FACT = new THREE.Color("#35f0c0");
const C_GROK = new THREE.Color("#c38bff");
const C_WIN = new THREE.Color("#3ecf8e");
const C_LOSS = new THREE.Color("#ff7a3d");
const C_SKIP = new THREE.Color("#ff4d6d");

function seat(i: number, n: number) {
  const a = (i / Math.max(1, n)) * Math.PI * 2 + Math.PI / 2;
  return new THREE.Vector3(Math.cos(a) * R, 0.6 * Math.sin(i * 1.7), Math.sin(a) * R);
}

function fmtUsd(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}k` : `$${a.toFixed(0)}`;
  return v < 0 ? `−${s}` : s;
}

function Trader({ c, pos, hovered, onHover }: { c: CopyCandidate; pos: THREE.Vector3; hovered: boolean; onHover: (w: string | null) => void }) {
  const core = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const size = 0.28 + Math.min(0.5, Math.log10(1 + (c.followers ?? 0)) * 0.08);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (core.current) core.current.scale.setScalar(1 + 0.08 * Math.sin(t * 2 + pos.x));
    if (halo.current) {
      halo.current.rotation.z = t * (c.leader ? 0.6 : 0.2);
      (halo.current.material as THREE.MeshBasicMaterial).opacity = c.leader ? 0.55 + 0.25 * Math.sin(t * 3) : 0.18;
    }
  });
  const col = c.leader ? C_LEAD : C_CAND;
  return (
    <group position={pos}>
      <mesh ref={core} onPointerOver={(e) => { e.stopPropagation(); onHover(c.wallet); }} onPointerOut={() => onHover(null)}>
        <sphereGeometry args={[size, 32, 32]} />
        <meshBasicMaterial color={col.clone().multiplyScalar(c.leader ? 2.2 : 1.1)} toneMapped={false} />
      </mesh>
      <mesh ref={halo} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[size * 1.9, 0.025, 8, 64]} />
        <meshBasicMaterial color={col.clone().multiplyScalar(2)} transparent opacity={0.4} toneMapped={false} />
      </mesh>
      <Html position={[0, size + 0.55, 0]} center style={{ pointerEvents: "none" }}>
        <div className={`scene-label ${c.leader ? "scene-label--held" : ""}`}>
          <span className="scene-label__coin">@{c.handle ?? c.wallet.slice(0, 6)}</span>
          {c.leader && <span className="scene-label--axis">leader</span>}
        </div>
      </Html>
      {hovered && (
        <Html position={[0, size + 2.4, 0]} center style={{ pointerEvents: "none" }}>
          <div className="tooltip">
            <div className="tooltip__time">@{c.handle} · {c.leader ? "leader (copied)" : "candidate (tape only)"}</div>
            <div className="tooltip__row"><span>Chains active</span><b>{Object.keys(c.last_tx ?? {}).join(" · ") || "—"}</b></div>
            <div className="tooltip__row"><span>Source</span><b>{c.source ?? "—"}{c.on_board ? " · on board now" : ""}</b></div>
            <div className="tooltip__row"><span>fomo 24h PnL · followers</span><b>{fmtUsd(c.pnl24h_usd)} · {(c.followers ?? 0).toLocaleString()}</b></div>
            <div className="tooltip__row"><span>Seen on-chain</span><b>{c.buys ?? 0} buys · {c.sells ?? 0} sells · {c.observed_days ?? 0}d</b></div>
            <div className="tooltip__row"><span>Closed · win rate</span><b>{c.closed_trades ?? 0} · {c.win_rate === null || c.win_rate === undefined ? "—" : `${Math.round(c.win_rate * 100)}%`}</b></div>
            <div className="tooltip__row"><span>Measured PnL 7d / all</span><b>{fmtUsd(c.pnl_7d_usd)} / {fmtUsd(c.pnl_30d_usd)}</b></div>
            <div className="tooltip__row"><span>Avg hold</span><b>{c.avg_hold_minutes === null || c.avg_hold_minutes === undefined ? "—" : `${Math.round(c.avg_hold_minutes)} min`}</b></div>
          </div>
        </Html>
      )}
    </group>
  );
}

// one buy: a comet from the trader to the gate, looping; refused ones stop at their ring and fall
function Comet({ from, ev, k }: { from: THREE.Vector3; ev: CopyEvent; k: number }) {
  const head = useRef<THREE.Mesh>(null);
  const copied = ev.status === "COPY";
  const facts = ev.why.startsWith("facts") || ev.why.startsWith("no DexScreener");
  const pre = !copied && !facts && !ev.why.startsWith("grok");      // small / late / cooldown: never reached the gate
  const stopR = copied ? 0 : facts ? GATE_FACTS : pre ? R * 0.55 : GATE_GROK;
  const col = copied ? C_WIN : facts ? C_FACT : pre ? C_CAND : C_GROK;
  const { end, path } = useMemo(() => {
    const e = from.clone().setY(0).normalize().multiplyScalar(stopR);
    return { end: e, path: [from.toArray(), e.toArray()] as [number, number, number][] };
  }, [from, stopR]);
  useFrame(({ clock }) => {
    if (!head.current) return;
    const t = (clock.getElapsedTime() * 0.22 + k * 0.137) % 1;
    const p = from.clone().lerp(end, Math.min(1, t * 1.25));
    if (t * 1.25 > 1 && !copied) p.y -= (t * 1.25 - 1) * 6;           // refused: drop below the gate
    if (t * 1.25 > 1 && copied) p.y += (t * 1.25 - 1) * 8;            // copied: rise into the book
    head.current.position.copy(p);
    const m = head.current.material as THREE.MeshBasicMaterial;
    m.opacity = t * 1.25 > 1 ? Math.max(0, 1 - (t * 1.25 - 1) * 4) : 0.95;
  });
  return (
    <group>
      <Line points={path} color={col.getStyle()} lineWidth={copied ? 1.6 : 0.6} transparent opacity={copied ? 0.55 : 0.18} dashed={!copied} dashSize={0.25} gapSize={0.2} />
      <mesh ref={head}>
        <sphereGeometry args={[0.06 + Math.min(0.16, Math.log10(1 + ev.usd) * 0.03), 12, 12]} />
        <meshBasicMaterial color={(copied ? col : !pre ? C_SKIP : col).clone().multiplyScalar(2.4)} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

function Gate({ counts }: { counts: Record<string, number> }) {
  const outer = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (outer.current) outer.current.rotation.z = t * 0.25;
    if (inner.current) inner.current.rotation.z = -t * 0.45;
  });
  const copied = counts.COPY ?? 0;
  const seen = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <group>
      <mesh ref={outer} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[GATE_FACTS, 0.06, 12, 96]} />
        <meshBasicMaterial color={C_FACT.clone().multiplyScalar(2)} toneMapped={false} />
      </mesh>
      <mesh ref={inner} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[GATE_GROK, 0.05, 12, 96]} />
        <meshBasicMaterial color={C_GROK.clone().multiplyScalar(2)} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[GATE_GROK - 0.1, 48]} />
        <meshBasicMaterial color="#0d1830" transparent opacity={0.85} />
      </mesh>
      <Html position={[GATE_FACTS + 0.3, 0.4, 0]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis">Rugcheck facts</div>
      </Html>
      <Html position={[0, -0.9, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis">Grok verdict · {copied}/{seen} copied</div>
      </Html>
    </group>
  );
}

function Planet({ h, i, n }: { h: CopyHolding; i: number; n: number }) {
  const ref = useRef<THREE.Group>(null);
  const r = 0.9 + (i % 3) * 0.55;
  const size = 0.18 + Math.min(0.35, Math.log10(1 + h.cost_usd) * 0.09);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const a = clock.getElapsedTime() * (0.5 - (i % 3) * 0.12) + (i / Math.max(1, n)) * Math.PI * 2;
    ref.current.position.set(Math.cos(a) * r, 3 + (i % 2) * 0.6, Math.sin(a) * r);
  });
  const col = h.ret >= 0 ? C_WIN : C_LOSS;
  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[size, 24, 24]} />
        <meshBasicMaterial color={col.clone().multiplyScalar(2)} toneMapped={false} />
      </mesh>
      <Html position={[0, size + 0.35, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--held">
          <span className="scene-label__coin">${h.symbol}</span>
          <span className={`pol pol--${h.ret >= 0 ? "gain" : "loss"}`}>{h.ret >= 0 ? "+" : ""}{(h.ret * 100).toFixed(0)}%</span>
        </div>
      </Html>
    </group>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 21 * Math.max(1, 1.6 / aspect);
    const dir = camera.position.clone().normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function CopyScene({ info, active = true }: { info: CopyInfo; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<string | null>(null);
  const [spin, setSpin] = useState(true);
  const cands = info.copy?.candidates ?? [];
  const seats = useMemo(() => {
    const out: Record<string, THREE.Vector3> = {};
    cands.forEach((c, i) => { out[c.key ?? c.handle ?? c.wallet] = seat(i, cands.length); });
    return out;
  }, [cands]);
  const seatOf = (e: CopyEvent) => seats[e.key ?? ""] ?? seats[e.handle] ?? seats[e.wallet];
  const buys = (info.copy?.events ?? []).filter((e) => e.side === "BUY" && seatOf(e)).slice(0, 30);
  const sells = (info.copy?.events ?? []).filter((e) => e.status === "MIRROR").length;
  return (
    <Canvas
      camera={{ position: [0, 9, 17], fov: 42 }}
      dpr={[1, 2]}
      frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#04070d")}
      onPointerDown={() => setSpin(false)}
    >
      <CameraFit />
      <fog attach="fog" args={["#04070d", 22, 60]} />
      <ambientLight intensity={0.5} />
      <Stars radius={60} depth={30} count={2200} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={90} scale={[22, 8, 22]} size={1.4} speed={0.25} opacity={0.3} color="#ffc94d" />
      <group position={[0, -1.2, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]}>
          <ringGeometry args={[R - 0.05, R + 0.05, 128]} />
          <meshBasicMaterial color="#22304f" side={THREE.DoubleSide} />
        </mesh>
        <Gate counts={info.copy?.counts ?? {}} />
        {cands.map((c) => (
          <Trader key={c.key ?? c.wallet} c={c} pos={seats[c.key ?? c.handle ?? c.wallet]} hovered={hover === c.wallet} onHover={setHover} />
        ))}
        {buys.map((e, k) => <Comet key={`${e.ts}-${e.mint}-${k}`} from={seatOf(e)} ev={e} k={k} />)}
        {info.holdings.map((h, i) => <Planet key={h.key} h={h} i={i} n={info.holdings.length} />)}
        {cands.length === 0 && (
          <Html position={[0, 2, 0]} center style={{ pointerEvents: "none" }}>
            <div className="scene-title scene-title--zone">WAITING FOR FOMO&apos;S TOP WALLETS…</div>
          </Html>
        )}
        <Html position={[0, 6.2, 0]} center style={{ pointerEvents: "none" }}>
          <div className="kalshi-hud">
            <div><span>leaders copied</span><b className="pol pol--flat">{info.copy?.leaders.length ?? 0}</b><em>{info.copy?.leaders_source ?? "—"}</em></div>
            <div><span>buys copied / seen</span><b className="pol pol--gain">{info.copy?.counts.COPY ?? 0} / {Object.values(info.copy?.counts ?? {}).reduce((a, b) => a + b, 0)}</b><em>{sells} mirrored exits</em></div>
          </div>
        </Html>
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.35}
        minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.1} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.2} luminanceThreshold={0.3} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
