"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

// Strategy 38 "One Coin": the field and the climber. Around a ring stand the strongest Hyperliquid movers of the day,
// each a pillar as tall as its 4-hour rise (teal = rising by every rule, grey = not, with the reason on hover).
// In the middle is the one coin the book holds: a glass shaft from the -7% stop (red ring at the bottom) up past the
// entry (dashed line) to the arm level (+4%, where "peaking" starts to count). A glowing orb climbs it at the live
// price; the gold ring is the highest price since the entry, and once armed the green ring under it is where the
// give-back exit fires. To the side, one disc per finished round: the $10k rounds that fell under $5k.

export type OneRead = {
  coin: string; mid: number; r1h: number | null; r4h: number | null; r24h: number | null; ema: number | null;
  ema_rising: boolean; above_ema: boolean; rsi: number | null; last_close: number | null; rising: boolean; why: string;
  score: number | null; volume?: number;
};
export type OneHold = {
  coin: string; qty: number; entry: number; entry_mid: number; opened: number; peak: number; cost: number; rsi_hot: boolean;
  funding: number; why: string; mid: number; up_pct: number; value: number; stop_px: number; peak_armed: boolean;
  giveback_px: number; arm_px: number; read: OneRead | null; stale_ms: number;
};
export type OneRound = { round: number; start_ms: number; end_ms: number; end_equity: number; lost_on: string; coins: string[] };
export type OneInfo = {
  round: number; round_start_ms: number; rounds: OneRound[]; put_in: number; total_pnl: number; hold: OneHold | null;
  candidates: OneRead[]; events: string[];
  trades: { time: string; round: string; action: string; coin: string; price: string; notional: string; pnl: string; reason: string }[];
  errors: number; last_error: string; rules: Record<string, number>;
};

const R = 7.5;
const C_RISE = new THREE.Color("#35d8f0");
const C_NO = new THREE.Color("#4a5878");
const C_STOP = new THREE.Color("#ff3355");
const C_PEAK = new THREE.Color("#ffc94d");
const C_GIVE = new THREE.Color("#3ecf8e");

function Pillar({ r, pos, onHover, held }: { r: OneRead; pos: THREE.Vector3; onHover: (s: string | null) => void; held: boolean }) {
  const h = Math.max(0.15, Math.min(5, Math.abs(r.r4h ?? 0) * 0.6));
  const col = (r.rising ? C_RISE : C_NO).clone().multiplyScalar(r.rising ? 1.8 : 0.9);
  return (
    <group position={pos}>
      <mesh position={[0, ((r.r4h ?? 0) >= 0 ? h : -h) / 2, 0]}
        onPointerOver={(e) => { e.stopPropagation(); onHover(`${r.coin}: ${r.why} · 1h ${fmt(r.r1h)} · 4h ${fmt(r.r4h)} · 24h ${fmt(r.r24h)} · RSI ${r.rsi?.toFixed(0) ?? "—"}`); }}
        onPointerOut={() => onHover(null)}>
        <boxGeometry args={[0.45, h, 0.45]} />
        <meshStandardMaterial color={col} emissive={col} emissiveIntensity={held ? 1.2 : 0.5} toneMapped={false} transparent opacity={held ? 1 : 0.85} />
      </mesh>
      <Html position={[0, -0.5, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label"><span className="scene-label__coin">{r.coin}</span><span>{fmt(r.r4h)}</span></div>
      </Html>
    </group>
  );
}

const fmt = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);

function Climber({ h }: { h: OneHold }) {
  const orb = useRef<THREE.Mesh>(null);
  // the shaft runs from the stop (y=0) to +12% over the entry, so the arm level and a good run both fit
  const lo = h.stop_px;
  const hi = h.entry * 1.12;
  const y = (px: number) => Math.max(-0.4, Math.min(7.4, ((px - lo) / (hi - lo)) * 7));
  const yMid = y(h.mid);
  useFrame(({ clock }) => {
    if (orb.current) {
      orb.current.position.y += (yMid - orb.current.position.y) * 0.08;
      const s = 1 + Math.sin(clock.getElapsedTime() * 3) * 0.08;
      orb.current.scale.set(s, s, s);
    }
  });
  const up = h.up_pct >= 0;
  return (
    <group>
      <mesh position={[0, 3.5, 0]}>
        <cylinderGeometry args={[0.55, 0.55, 7.4, 32, 1, true]} />
        <meshStandardMaterial color="#16223c" emissive="#101a30" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, y(h.stop_px), 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.75, 0.04, 8, 48]} />
        <meshBasicMaterial color={C_STOP.clone().multiplyScalar(2)} toneMapped={false} />
      </mesh>
      <Line points={[[-0.9, y(h.entry), 0], [0.9, y(h.entry), 0]]} color="#9fb4d8" lineWidth={1} dashed dashSize={0.12} gapSize={0.08} />
      <Line points={[[-0.8, y(h.arm_px), 0], [0.8, y(h.arm_px), 0]]} color="#ffc94d" lineWidth={0.6} transparent opacity={0.5} />
      <mesh position={[0, y(h.peak), 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.68, 0.03, 8, 48]} />
        <meshBasicMaterial color={C_PEAK.clone().multiplyScalar(2.2)} toneMapped={false} />
      </mesh>
      {h.peak_armed && (
        <mesh position={[0, y(h.giveback_px), 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.7, 0.035, 8, 48]} />
          <meshBasicMaterial color={C_GIVE.clone().multiplyScalar(2.2)} toneMapped={false} />
        </mesh>
      )}
      <mesh ref={orb} position={[0, yMid, 0]}>
        <sphereGeometry args={[0.38, 32, 32]} />
        <meshBasicMaterial color={(up ? C_GIVE : new THREE.Color("#ff7a3d")).clone().multiplyScalar(2.6)} toneMapped={false} />
      </mesh>
      <Html position={[0, 8.3, 0]} center style={{ pointerEvents: "none" }}>
        <div className="kalshi-hud">
          <div><span>holding</span><b>{h.coin}</b><em>{fmt(h.up_pct)} since the entry</em></div>
          <div><span>worth</span><b className={`pol pol--${up ? "gain" : "loss"}`}>${h.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</b><em>{h.peak_armed ? "peaking watch armed" : `arms at ${fmt(((h.arm_px / h.entry) - 1) * 100)}`}</em></div>
        </div>
      </Html>
    </group>
  );
}

function Rounds({ rounds, current }: { rounds: OneRound[]; current: number }) {
  return (
    <group position={[R + 3.2, 0, 0]}>
      {rounds.map((r, i) => (
        <mesh key={r.round} position={[0, 0.12 + i * 0.22, 0]}>
          <cylinderGeometry args={[0.6, 0.6, 0.16, 32]} />
          <meshStandardMaterial color="#5a1e2a" emissive="#ff3355" emissiveIntensity={0.35} />
        </mesh>
      ))}
      <mesh position={[0, 0.12 + rounds.length * 0.22, 0]}>
        <cylinderGeometry args={[0.6, 0.6, 0.16, 32]} />
        <meshStandardMaterial color="#1d3a52" emissive="#35d8f0" emissiveIntensity={0.8} toneMapped={false} />
      </mesh>
      <Html position={[0, 0.8 + rounds.length * 0.22, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label"><span className="scene-label__coin">ROUND {current}</span><span>{rounds.length} restart{rounds.length === 1 ? "" : "s"}</span></div>
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

export default function OneCoinScene({ info, active = true }: { info: OneInfo; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<string | null>(null);
  const [spin, setSpin] = useState(true);
  const field = useMemo(() => info.candidates.slice(0, 15), [info.candidates]);
  const held = info.hold?.coin;
  return (
    <Canvas camera={{ position: [0, 8, 17], fov: 42 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05070c")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#05070c", 22, 55]} />
      <ambientLight intensity={0.6} />
      <pointLight position={[0, 10, 6]} intensity={30} color="#9fd8ff" />
      <Stars radius={60} depth={30} count={1600} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={70} scale={[20, 8, 20]} size={1.2} speed={0.25} opacity={0.25} color="#35d8f0" />
      <group position={[0, -3, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
          <ringGeometry args={[R - 0.6, R + 0.6, 128]} />
          <meshBasicMaterial color="#121c33" side={THREE.DoubleSide} />
        </mesh>
        {field.map((r, i) => {
          const a = (i / Math.max(1, field.length)) * Math.PI * 2 + Math.PI / 2;
          return <Pillar key={r.coin} r={r} pos={new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R)} onHover={setHover} held={r.coin === held} />;
        })}
        {info.hold ? <Climber h={info.hold} /> : (
          <Html position={[0, 3, 0]} center style={{ pointerEvents: "none" }}>
            <div className="scene-title scene-title--zone">{field.length ? "FLAT · NOTHING IS RISING BY EVERY RULE" : "READING HYPERLIQUID…"}</div>
          </Html>
        )}
        <Rounds rounds={info.rounds} current={info.round} />
        {hover && (
          <Html position={[0, 9.4, 0]} center style={{ pointerEvents: "none" }}>
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
