"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

// Strategy 34 "The desk": five stations on one rail, left to right: the four scanners, VERIFY's hard checks,
// Grok's X read, EXECUTE and EXIT. Every recent lead is a bead that rides the rail from its scanner and stops
// where its task ended: beads that fail a hard check drop into the red pit under VERIFY, beads Grok turns down drop
// into the violet pit under the X read, and the few that fill reach EXECUTE. Open positions float over EXIT at the
// height of their move, with the stop plate under them and the ladder rungs above.

export type DeskTask = { time: string; ts: string; agent: string; step: string; mint: string; symbol: string; result: string; reason: string };
export type DeskPosition = {
  coin: string; mint: string; agent: string; entry: number; mark: number; cost: number; unrealized: number;
  unrealized_pct: number; opened: number; steps: number; peak: number; liq0: number; liq: number; url: string;
  stop_px: number; next_take_px: number | null; trail_px: number | null; liq_floor: number; time_stop_ms: number | null;
};
export type DeskReport = {
  balance_start: number; balance_now: number; multiple: number | null; tasks: number; leads: number; verified: number;
  passed_hard: number; grok_reads: number; fills: number; closes: number; skips: number; wins: number; losses: number;
  win_rate: number | null; profit: number; big: { time: string; agent: string; symbol: string; pnl: number; reason: string }[];
  big_share: number | null; small_count: number; small_share: number | null; skip_reasons: [string, number][];
  agents: Record<string, { leads: number; fills: number; pnl: number }>;
};
export type DeskInfo = {
  report: DeskReport; report_text: string; tasks: DeskTask[]; events: string[];
  session: { day: string; start: number; halted: boolean; halt_at: number };
  grok: { via: string; calls: number | null; searched: number | null; no_search: number | null; errors: number | null;
    last_error: string; calls_last_hour: number; budget_per_hour: number };
  source_errors: Record<string, number>;
  config: {
    model: string; start_balance: number; scanners: string[]; leads_per_run: number; scan_every_s: number; whales: number;
    skip_if: Record<string, number>; min_x_confidence: number; size_pct: number; min_ticket: number; max_ticket: number;
    max_open: number; session_loss_halt_pct: number;
    exit: { hard_stop_pct: number; ladder: [number, number][]; trail_pct: number; time_stop_min: number; time_stop_min_pct: number; liq_drop_pct: number };
    fees: { dex_fee: number; priority_fee_usd: number; latency_slip: number };
  };
  started_ms: number; source: string;
};

const X = { scan: -9, verify: -4, xread: 0.5, execute: 4.5, exit: 9 };
const C = {
  scan: new THREE.Color("#7aa2ff"), verify: new THREE.Color("#ff3355"), xread: new THREE.Color("#a879ff"),
  execute: new THREE.Color("#ffc94d"), exit: new THREE.Color("#3ecf8e"), rail: new THREE.Color("#1c2a4a"),
};

type Bead = { key: string; agentIdx: number; end: "verify" | "xread" | "execute"; symbol: string; reason: string; delay: number };

/** Where each recent lead ended, from the task rows (newest first in the payload). */
function beadsFrom(tasks: DeskTask[], scanners: string[]): Bead[] {
  const byMint: Record<string, DeskTask[]> = {};
  [...tasks].reverse().forEach((t) => { (byMint[t.mint] ||= []).push(t); });
  const out: Bead[] = [];
  Object.entries(byMint).forEach(([mint, rows], i) => {
    const scan = rows.find((r) => r.step === "scan");
    const ver = rows.find((r) => r.step === "verify");
    const exe = rows.find((r) => r.step === "execute");
    if (!scan && !ver) return;
    let end: Bead["end"] = "verify";
    if (exe && exe.result === "paper_fill") end = "execute";
    else if (ver && /^x_read|^grok_budget/.test(ver.reason)) end = "xread";
    out.push({ key: mint, agentIdx: Math.max(0, scanners.indexOf(scan?.agent ?? "")), end,
      symbol: ver?.symbol || exe?.symbol || mint.slice(0, 4), reason: exe?.reason || ver?.reason || "", delay: (i * 0.37) % 6 });
  });
  return out.slice(-48);
}

function BeadMesh({ b, onHover }: { b: Bead; onHover: (s: string | null) => void }) {
  const m = useRef<THREE.Mesh>(null);
  const endX = X[b.end];
  const col = b.end === "execute" ? C.execute : b.end === "xread" ? C.xread : C.verify;
  const startZ = (b.agentIdx - 1.5) * 1.1;
  useFrame(({ clock }) => {
    if (!m.current) return;
    const T = 7;
    const k = ((clock.getElapsedTime() + b.delay) % T) / T;           // 0..1 loop
    const travel = Math.min(1, k / 0.6);
    const x = X.scan + (endX - X.scan) * travel;
    const z = startZ * (1 - Math.min(1, travel * 2));
    let y = 0.35;
    if (k > 0.6) {
      const f = (k - 0.6) / 0.4;
      y = b.end === "execute" ? 0.35 + f * 1.4 : 0.35 - f * f * 3.2;  // fills rise to EXIT, skips drop into the pit
    }
    m.current.position.set(b.end === "execute" && k > 0.6 ? endX + (X.exit - endX) * ((k - 0.6) / 0.4) : x, y, z);
    (m.current.material as THREE.MeshBasicMaterial).opacity = k > 0.9 ? (1 - k) * 10 : 1;
  });
  return (
    <mesh ref={m} onPointerOver={(e) => { e.stopPropagation(); onHover(`${b.symbol}: ${b.reason}`); }} onPointerOut={() => onHover(null)}>
      <sphereGeometry args={[b.end === "execute" ? 0.16 : 0.1, 12, 12]} />
      <meshBasicMaterial color={col.clone().multiplyScalar(b.end === "execute" ? 2.6 : 1.8)} transparent toneMapped={false} />
    </mesh>
  );
}

function Station({ x, color, title, lines, ring = true, pit = false }: {
  x: number; color: THREE.Color; title: string; lines: string[]; ring?: boolean; pit?: boolean;
}) {
  const r = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (r.current) r.current.rotation.z = clock.getElapsedTime() * 0.5; });
  return (
    <group position={[x, 0, 0]}>
      {ring && (
        <mesh ref={r} position={[0, 0.35, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[1.0, 0.05, 10, 64]} />
          <meshBasicMaterial color={color.clone().multiplyScalar(2.2)} toneMapped={false} />
        </mesh>
      )}
      {pit && (
        <mesh position={[0, -2.9, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.3, 1.2, 40]} />
          <meshBasicMaterial color={color.clone().multiplyScalar(1.2)} side={THREE.DoubleSide} transparent opacity={0.7} toneMapped={false} />
        </mesh>
      )}
      <Html position={[0, 2.2, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label">
          <span className="scene-label__coin">{title}</span>
          {lines.map((l) => <span key={l}>{l}</span>)}
        </div>
      </Html>
    </group>
  );
}

function ExitZone({ positions, ladder, stopPct, onHover }: {
  positions: DeskPosition[]; ladder: [number, number][]; stopPct: number; onHover: (s: string | null) => void;
}) {
  const yOf = (pct: number) => 1.75 + Math.max(-1.6, Math.min(3.2, pct / 35));
  return (
    <group position={[X.exit, 0, 0]}>
      {/* stop plate, entry line, ladder rungs */}
      <mesh position={[0, yOf(stopPct), 0]}>
        <boxGeometry args={[2.6, 0.04, 2.6]} />
        <meshBasicMaterial color={C.verify.clone().multiplyScalar(1.4)} transparent opacity={0.8} toneMapped={false} />
      </mesh>
      <Line points={[[-1.4, yOf(0), 0], [1.4, yOf(0), 0]]} color="#9fb4d8" lineWidth={1} dashed dashSize={0.12} gapSize={0.08} />
      {ladder.map(([at]) => (
        <mesh key={at} position={[0, yOf(at), 0]}>
          <boxGeometry args={[2.6, 0.03, 0.12]} />
          <meshBasicMaterial color={C.execute.clone().multiplyScalar(2)} toneMapped={false} />
        </mesh>
      ))}
      {positions.map((p, i) => {
        const a = (i / Math.max(1, positions.length)) * Math.PI * 2;
        const pct = p.unrealized_pct * 100;
        return (
          <mesh key={p.mint} position={[Math.cos(a) * 0.8, yOf(pct), Math.sin(a) * 0.8]}
            onPointerOver={(e) => { e.stopPropagation(); onHover(`${p.coin} ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% · $${p.cost.toFixed(2)} in · rung ${p.steps}/${ladder.length} · lead from ${p.agent}`); }}
            onPointerOut={() => onHover(null)}>
            <sphereGeometry args={[0.24, 20, 20]} />
            <meshBasicMaterial color={(pct >= 0 ? C.exit : new THREE.Color("#ff7a3d")).clone().multiplyScalar(2.4)} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 21 * Math.max(1, 1.7 / aspect);
    const dir = camera.position.clone().normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function DeskScene({ info, positions, active = true }: { info: DeskInfo; positions: DeskPosition[]; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<string | null>(null);
  const [spin, setSpin] = useState(false);
  const r = info.report;
  const beads = useMemo(() => beadsFrom(info.tasks, info.config.scanners), [info.tasks, info.config.scanners]);
  const hardSkips = Math.max(0, r.verified - r.passed_hard);
  const grokSkips = Math.max(0, r.passed_hard - r.fills);
  return (
    <Canvas camera={{ position: [0, 6, 18], fov: 42 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05070c")}
      onPointerDown={() => setSpin(false)} onDoubleClick={() => setSpin((s) => !s)}>
      <CameraFit />
      <fog attach="fog" args={["#05070c", 22, 55]} />
      <ambientLight intensity={0.6} />
      <pointLight position={[0, 8, 6]} intensity={30} color="#9fd8ff" />
      <Stars radius={60} depth={30} count={1500} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={60} scale={[24, 6, 8]} size={1.2} speed={0.2} opacity={0.25} color="#a879ff" />
      <group position={[0, -0.8, 0]}>
        {/* the rail */}
        <mesh position={[0, 0.0, 0]}>
          <boxGeometry args={[20, 0.06, 0.5]} />
          <meshStandardMaterial color={C.rail} emissive="#0e1830" />
        </mesh>
        {/* four scanner dishes */}
        {info.config.scanners.map((s, i) => (
          <group key={s} position={[X.scan, 0.35, (i - 1.5) * 1.1]}>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <coneGeometry args={[0.35, 0.3, 20, 1, true]} />
              <meshBasicMaterial color={C.scan.clone().multiplyScalar(1.8)} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>
            <Html position={[-0.9, 0, 0]} center style={{ pointerEvents: "none" }}>
              <div className="moon-rung">{s} <em>{r.agents[s]?.leads ?? 0}</em></div>
            </Html>
          </group>
        ))}
        <Station x={X.scan} color={C.scan} title="SCAN" lines={[`${r.leads} leads`]} ring={false} />
        <Station x={X.verify} color={C.verify} title="VERIFY · code" lines={[`${hardSkips} hard skips`]} pit />
        <Station x={X.xread} color={C.xread} title="VERIFY · Grok on X" lines={[`${grokSkips} skipped`]} pit />
        <Station x={X.execute} color={C.execute} title="EXECUTE" lines={[`${r.fills} fills`]} />
        <Station x={X.exit} color={C.exit} title="EXIT" lines={[`${positions.length} open · ${r.closes} sells`]} ring={false} />
        <ExitZone positions={positions} ladder={info.config.exit.ladder} stopPct={info.config.exit.hard_stop_pct} onHover={setHover} />
        {beads.map((b) => <BeadMesh key={b.key} b={b} onHover={setHover} />)}
        {beads.length === 0 && (
          <Html position={[0, 1.4, 0]} center style={{ pointerEvents: "none" }}>
            <div className="scene-title scene-title--zone">FIRST SCAN WITHIN 5 MINUTES…</div>
          </Html>
        )}
        {hover && (
          <Html position={[0, 4.2, 0]} center style={{ pointerEvents: "none" }}>
            <div className="tooltip"><div className="tooltip__row"><b>{hover}</b></div></div>
          </Html>
        )}
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
