"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

// Strategy 30 "Launch towers": one tower per lane, standing on a launch pad. Height is the stake on a log scale,
// $100 on the pad to $1,000,000 at the moon hanging over the towers. Each rung is a step the lane must win (10x, 2x or
// 100x), and it glows brighter the more tries have reached it. The rocket rides the tower at the stake's live value
// (stake x the multiple a close would pay right now under Papertrade's rules); the gold ring above it is the take
// profit, the red plate under the pad is the bust. Every bust leaves a small red ember in the crater around the pad.

export type MoonPosition = {
  side: number; entry: number; lev: number; margin: number; tp: number; bust: number; opened_ms: number; step: number;
};
export type MoonTry = { start: number; end: number; steps: number; peak: number; result: "bust" | "moon" };
export type MoonLane = {
  key: string; name: string; lev: number; step_mult: number; steps_needed: number; take_profit_move: number;
  bust_move: number; equity: number; step: number; tries: number; busts: number; moons: number; paid_in: number;
  paid_out: number; net: number; best_equity: number; steps_won: Record<string, number>; position: MoonPosition | null;
  live_multiple: number | null; history: MoonTry[];
};
export type MoonInfo = {
  lanes: MoonLane[]; mid: number; mid_ms: number; mids: [number, number][]; started_ms: number; stake_usd: number;
  goal_usd: number; feed_errors: number; last_error: string;
  rules: { deadband_bp: number; base_rate: number; rate_multiplier: number; reference_notional: number;
    position_multiplier: number; win_fee: number; bust_buffer_bp: number; max_notional: number };
  backtest: Record<string, string>; source: string;
};

const H = 10;                 // tower height: $100 at 0, $1M at H
const GAP = 6;                // spacing between towers
const C_ROCKET = new THREE.Color("#35d8f0");
const C_TP = new THREE.Color("#ffc94d");
const C_BUST = new THREE.Color("#ff3355");
const C_RUNG = new THREE.Color("#7aa2ff");
const C_MOON = new THREE.Color("#fff3c4");

export const yOfUsd = (usd: number, stake = 100, goal = 1_000_000) =>
  (Math.log10(Math.max(usd, 1)) - Math.log10(stake)) / (Math.log10(goal) - Math.log10(stake)) * H;

/** How many tries reached at least `k` won steps. */
export function reachedAtLeast(steps_won: Record<string, number>, k: number): number {
  return Object.entries(steps_won).reduce((a, [s, n]) => a + (Number(s) >= k ? n : 0), 0);
}

const money = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : `$${v.toFixed(0)}`);

function Tower({ lane, x, info, hovered, onHover }: {
  lane: MoonLane; x: number; info: MoonInfo; hovered: boolean; onHover: (k: string | null) => void;
}) {
  const rocket = useRef<THREE.Group>(null);
  const flame = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const stake = info.stake_usd;
  const goal = info.goal_usd;
  // rung values: $100, then each step's target until the goal
  const rungs = useMemo(() => {
    const out: number[] = [];
    let v = stake;
    for (let k = 0; k <= lane.steps_needed; k++) {
      out.push(Math.min(v, goal));
      v *= lane.step_mult;
    }
    return out;
  }, [stake, goal, lane.step_mult, lane.steps_needed]);
  const totalTries = Math.max(1, lane.tries);
  const live = lane.equity * (lane.live_multiple ?? 1);
  const yLive = Math.max(-0.6, yOfUsd(Math.max(live, stake * 0.05), stake, goal));
  const yTp = yOfUsd(Math.min(goal, lane.equity * lane.step_mult), stake, goal);
  const yNow = yOfUsd(lane.equity, stake, goal);
  const p = lane.position;
  const danger = p && info.mid ? Math.max(0, Math.min(1, 1 - Math.abs(info.mid - p.bust) / Math.max(1e-9, Math.abs(p.entry - p.bust)))) : 0;
  const busts = Math.min(lane.busts, 160);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (rocket.current) {
      rocket.current.position.y += (yLive - rocket.current.position.y) * 0.08;
      rocket.current.rotation.y = t * 0.8;
      rocket.current.position.x = Math.sin(t * 40) * 0.02 * danger;   // shakes as it nears the bust
    }
    if (flame.current) {
      const s = 0.7 + Math.sin(t * 22) * 0.15 + Math.random() * 0.1;
      flame.current.scale.set(1, s, 1);
    }
    if (ring.current) ring.current.rotation.z = t * 0.7;
  });

  return (
    <group position={[x, 0, 0]}>
      {/* the tower: two rails */}
      {[-0.55, 0.55].map((dx) => (
        <mesh key={dx} position={[dx, H / 2, 0]}>
          <boxGeometry args={[0.06, H, 0.06]} />
          <meshStandardMaterial color="#1c2a4a" emissive={hovered ? "#2d4a86" : "#121c33"} toneMapped={false} />
        </mesh>
      ))}
      {/* hover target */}
      <mesh position={[0, H / 2, 0]} onPointerOver={(e) => { e.stopPropagation(); onHover(lane.key); }} onPointerOut={() => onHover(null)}>
        <boxGeometry args={[1.6, H + 1, 1.6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* rungs: brightness = share of tries that got this far */}
      {rungs.map((v, k) => {
        const y = yOfUsd(v, stake, goal);
        const share = k === 0 ? 1 : reachedAtLeast(lane.steps_won, k) / totalTries;
        const reachedThisTry = k <= lane.step;
        const col = (reachedThisTry ? C_ROCKET : C_RUNG).clone().multiplyScalar(0.25 + 2.2 * Math.sqrt(share));
        return (
          <group key={k} position={[0, y, 0]}>
            <mesh>
              <boxGeometry args={[1.2, 0.05, 0.12]} />
              <meshBasicMaterial color={col} toneMapped={false} />
            </mesh>
            {(hovered || k === 0 || k === lane.steps_needed || lane.steps_needed <= 4) && (
              <Html position={[0.95, 0, 0]} style={{ pointerEvents: "none" }}>
                <div className="moon-rung">{money(v)}{k > 0 ? <em> {reachedAtLeast(lane.steps_won, k)}</em> : null}</div>
              </Html>
            )}
          </group>
        );
      })}
      {/* take-profit ring */}
      {p && (
        <mesh ref={ring} position={[0, yTp, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.7, 0.035, 8, 48]} />
          <meshBasicMaterial color={C_TP.clone().multiplyScalar(2.2)} toneMapped={false} />
        </mesh>
      )}
      {/* entry marker */}
      {p && (
        <Line points={[[-0.8, yNow, 0], [0.8, yNow, 0]]} color="#9fb4d8" lineWidth={1} dashed dashSize={0.1} gapSize={0.08} />
      )}
      {/* the rocket */}
      <group ref={rocket} position={[0, yLive, 0]}>
        <mesh position={[0, 0.35, 0]}>
          <coneGeometry args={[0.18, 0.5, 16]} />
          <meshBasicMaterial color={C_ROCKET.clone().lerp(C_BUST, danger).multiplyScalar(2.4)} toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.02, 0]}>
          <cylinderGeometry args={[0.18, 0.18, 0.28, 16]} />
          <meshStandardMaterial color="#d6e4ff" emissive="#4d6aa8" toneMapped={false} />
        </mesh>
        <mesh ref={flame} position={[0, -0.32, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.12, 0.4, 12]} />
          <meshBasicMaterial color={C_TP.clone().multiplyScalar(2.6)} transparent opacity={0.85} toneMapped={false} />
        </mesh>
      </group>
      {/* bust plate under the pad */}
      <mesh position={[0, -0.75, 0]}>
        <boxGeometry args={[1.5, 0.05, 1.5]} />
        <meshBasicMaterial color={C_BUST.clone().multiplyScalar(0.6 + 1.6 * danger)} toneMapped={false} />
      </mesh>
      {/* launch pad */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <circleGeometry args={[1.0, 40]} />
        <meshStandardMaterial color="#121c33" emissive="#0c1426" />
      </mesh>
      {/* crater: one ember per bust */}
      {Array.from({ length: busts }, (_, i) => {
        const a = i * 2.39996;
        const r = 1.25 + (i % 7) * 0.12 + Math.floor(i / 7) * 0.02;
        return (
          <mesh key={i} position={[Math.cos(a) * r, -0.02, Math.sin(a) * r]}>
            <sphereGeometry args={[0.045, 6, 6]} />
            <meshBasicMaterial color={C_BUST.clone().multiplyScalar(1.4)} toneMapped={false} />
          </mesh>
        );
      })}
      <Html position={[0, -1.4, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label">
          <span className="scene-label__coin">{lane.key.toUpperCase()} · {lane.lev}x</span>
          <span className={`pol pol--${lane.moons ? "gain" : lane.busts ? "loss" : "flat"}`}>try {lane.tries + 1} · {lane.busts} bust{lane.busts === 1 ? "" : "s"}</span>
        </div>
      </Html>
      {hovered && (
        <Html position={[0, H + 1.2, 0]} center style={{ pointerEvents: "none" }}>
          <div className="tooltip">
            <div className="tooltip__time">{lane.name}</div>
            <div className="tooltip__row"><span>This try</span><b>step {lane.step}/{lane.steps_needed} · stake {money(lane.equity)}</b></div>
            <div className="tooltip__row"><span>Live value</span><b>{money(live)} ({(lane.live_multiple ?? 1).toFixed(2)}x)</b></div>
            {p && <div className="tooltip__row"><span>{p.side > 0 ? "Long" : "Short"} BTC</span><b>{p.entry.toFixed(0)} → TP {p.tp.toFixed(0)} · bust {p.bust.toFixed(0)}</b></div>}
            <div className="tooltip__row"><span>Tries · busts · $1M</span><b>{lane.tries} · {lane.busts} · {lane.moons}</b></div>
            <div className="tooltip__row"><span>Paid in · out</span><b>{money(lane.paid_in)} · {money(lane.paid_out)}</b></div>
          </div>
        </Html>
      )}
    </group>
  );
}

function Moon({ y, lit }: { y: number; lit: boolean }) {
  const m = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (m.current) m.current.rotation.y = clock.getElapsedTime() * 0.05; });
  return (
    <group position={[0, y, -2]}>
      <mesh ref={m}>
        <sphereGeometry args={[1.5, 48, 48]} />
        <meshStandardMaterial color="#d9d2b8" emissive={C_MOON} emissiveIntensity={lit ? 1.4 : 0.45} roughness={0.9} toneMapped={false} />
      </mesh>
      <Html position={[0, 2.1, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title scene-title--zone">$1,000,000</div>
      </Html>
    </group>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 21 * Math.max(1, 1.5 / aspect);
    const dir = camera.position.clone().normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function MoonshotScene({ info, active = true }: { info: MoonInfo; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<string | null>(null);
  const [spin, setSpin] = useState(true);
  const lanes = info.lanes;
  const tries = lanes.reduce((a, l) => a + l.tries, 0);
  const busts = lanes.reduce((a, l) => a + l.busts, 0);
  const moons = lanes.reduce((a, l) => a + l.moons, 0);
  const paidIn = lanes.reduce((a, l) => a + l.paid_in, 0);
  const paidOut = lanes.reduce((a, l) => a + l.paid_out, 0);
  return (
    <Canvas camera={{ position: [0, 9, 18], fov: 42 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#04050b")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#04050b", 22, 60]} />
      <ambientLight intensity={0.55} />
      <pointLight position={[0, H + 4, 6]} intensity={40} color="#fff3c4" />
      <Stars radius={70} depth={40} count={2600} factor={3.4} saturation={0} fade speed={0.5} />
      <Sparkles count={60} scale={[20, H, 8]} position={[0, H / 2, 0]} size={1.2} speed={0.3} opacity={0.25} color="#35d8f0" />
      <group position={[0, -H / 2 + 0.6, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
          <planeGeometry args={[GAP * lanes.length + 6, 7]} />
          <meshStandardMaterial color="#0a1020" emissive="#060a16" />
        </mesh>
        {lanes.map((l, i) => (
          <Tower key={l.key} lane={l} info={info} x={(i - (lanes.length - 1) / 2) * GAP}
            hovered={hover === l.key} onHover={setHover} />
        ))}
        <Moon y={H + 1.8} lit={moons > 0} />
        {lanes.length === 0 && (
          <Html position={[0, H / 2, 0]} center style={{ pointerEvents: "none" }}>
            <div className="scene-title scene-title--zone">WAITING FOR THE BTC BOOK…</div>
          </Html>
        )}
        <Html position={[-(GAP * lanes.length) / 2 - 1.5, H * 0.75, 0]} center style={{ pointerEvents: "none" }}>
          <div className="kalshi-hud">
            <div><span>BTC mid (Hyperliquid)</span><b>{info.mid ? info.mid.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}</b><em>Papertrade&apos;s price</em></div>
            <div><span>tries · busts · $1M</span><b>{tries} · {busts} · {moons}</b><em>{lanes.length} lanes</em></div>
            <div><span>paid in → out</span><b className={`pol pol--${paidOut - paidIn < 0 ? "loss" : "gain"}`}>{money(paidIn)} → {money(paidOut)}</b><em>$100 per try</em></div>
          </div>
        </Html>
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.25}
        minPolarAngle={Math.PI / 5} maxPolarAngle={Math.PI / 2.05} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.2} luminanceThreshold={0.3} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
