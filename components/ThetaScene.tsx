"use client";

import { Html, Line, OrbitControls, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

// Strategy 41 "The tent": the open iron condor's payoff at expiry drawn as a tent over Bitcoin's price. Left to right is
// BTC's price; up is profit. The flat top between the two short strikes is the profit zone (the credit kept), the
// slopes fall to the capped loss at the wings. The orb is Bitcoin now; the floating ring above it is what the condor is
// worth right now (credit minus the cost to close). Behind the tent, the option chain: one thin post per strike, as tall
// as its delta, so you can see where 15 and 5 delta sit.

export type ThetaLeg = { role: string; name: string; strike: number; kind: string; side: string; contracts: number; open_btc: number; delta: number | null; iv: number };
export type ThetaCondor = {
  expiry: string; expiry_ms: number; legs: ThetaLeg[]; credit_usd: number; credit_btc: number; contracts: number; width: number;
  opened: number; open_index: number; max_loss_usd: number; fees_usd: number; breakeven: [number, number];
  close_cost_usd: number | null; take_profit_at: number; stop_at: number; days_left: number; held_past_stop?: boolean;
};
export type ThetaChainRow = { name: string; strike: number; kind: string; delta: number | null; bid: number; ask: number; mark: number; iv: number; fwd: number };
export type ThetaHistory = { expiry: string; opened: number; closed: number; contracts: number; strikes: number[]; credit_usd: number; max_loss_usd: number; pnl: number; why: string; open_index: number; close_index: number };
export type ThetaInfo = {
  condor: ThetaCondor | null; spot: number; chain: ThetaChainRow[]; history: ThetaHistory[]; events: string[];
  skip_reason: string; errors: number; last_error: string; rules: Record<string, number>;
};

const W = 16;
const H = 5;
const C_WIN = new THREE.Color("#3ecf8e");
const C_LOSS = new THREE.Color("#ff5470");
const C_SPOT = new THREE.Color("#35d8f0");
const C_GOLD = new THREE.Color("#ffc94d");

function payoff(legs: ThetaLeg[], credit: number, s: number): number {
  let v = credit;
  for (const l of legs) {
    const intr = l.kind === "call" ? Math.max(0, s - l.strike) : Math.max(0, l.strike - s);
    v += (l.side === "buy" ? intr : -intr) * l.contracts;
  }
  return v;
}

function Spot({ x, y }: { x: number; y: number }) {
  const m = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (m.current) m.current.position.y = y + Math.sin(clock.getElapsedTime() * 2) * 0.05; });
  return (
    <group position={[x, 0, 0]}>
      <Line points={[[0, -H / 2 - 0.4, 0], [0, H / 2 + 0.6, 0]]} color="#35d8f0" lineWidth={1} transparent opacity={0.45} dashed dashSize={0.12} gapSize={0.08} />
      <mesh ref={m} position={[0, y, 0]}>
        <sphereGeometry args={[0.22, 24, 24]} />
        <meshBasicMaterial color={C_SPOT.clone().multiplyScalar(2.4)} toneMapped={false} />
      </mesh>
    </group>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 16 * Math.max(1, 1.7 / aspect);
    const dir = camera.position.clone().normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function ThetaScene({ info, active = true }: { info: ThetaInfo; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [spin, setSpin] = useState(false);
  const c = info.condor;
  const model = useMemo(() => {
    if (!c) return null;
    const ks = c.legs.map((l) => l.strike);
    const lo = Math.min(...ks) - c.width * 1.2, hi = Math.max(...ks) + c.width * 1.2;
    const xs = Array.from({ length: 121 }, (_, i) => lo + (i / 120) * (hi - lo));
    const ys = xs.map((s) => payoff(c.legs, c.credit_usd, s));
    const top = Math.max(...ys), bot = Math.min(...ys), span = Math.max(1, top - bot);
    const X = (s: number) => ((s - lo) / (hi - lo) - 0.5) * W;
    const Y = (v: number) => ((v - bot) / span - 0.5) * H;
    return { lo, hi, xs, ys, X, Y, top, bot };
  }, [c]);
  return (
    <Canvas camera={{ position: [0, 3, 15], fov: 42 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05070c")}
      onPointerDown={() => setSpin(false)} onDoubleClick={() => setSpin((s) => !s)}>
      <CameraFit />
      <ambientLight intensity={0.6} />
      <Stars radius={60} depth={30} count={1400} factor={3} saturation={0} fade speed={0.3} />
      {!c || !model ? (
        <Html center style={{ pointerEvents: "none" }}>
          <div className="scene-title scene-title--zone">{info.skip_reason ? `FLAT · ${info.skip_reason.toUpperCase()}` : "WAITING FOR THE NEXT CONDOR…"}</div>
        </Html>
      ) : (
        <group>
          {/* zero line */}
          <Line points={[[-W / 2, model.Y(0), 0], [W / 2, model.Y(0), 0]]} color="#6b7a99" lineWidth={1} transparent opacity={0.6} />
          {/* the tent, coloured by profit / loss */}
          {model.xs.slice(1).map((s, i) => {
            const v = model.ys[i + 1];
            return <Line key={i} points={[[model.X(model.xs[i]), model.Y(model.ys[i]), 0], [model.X(s), model.Y(v), 0]]}
              color={(v >= 0 ? C_WIN : C_LOSS).getStyle()} lineWidth={4} />;
          })}
          {/* fill under the profit zone */}
          {model.xs.map((s, i) => model.ys[i] > 0 && i % 2 === 0 ? (
            <mesh key={`f${i}`} position={[model.X(s), (model.Y(model.ys[i]) + model.Y(0)) / 2, -0.01]}>
              <planeGeometry args={[W / 120 * 2, Math.abs(model.Y(model.ys[i]) - model.Y(0))]} />
              <meshBasicMaterial color={C_WIN} transparent opacity={0.12} />
            </mesh>
          ) : null)}
          {/* strike labels */}
          {c.legs.map((l) => (
            <Html key={l.name} position={[model.X(l.strike), model.Y(model.bot) - 0.45, 0]} center style={{ pointerEvents: "none" }}>
              <div className="scene-label"><span className="scene-label__coin">{(l.strike / 1000).toFixed(0)}k</span><span>{l.side === "sell" ? "sold" : "bought"} {l.kind}</span></div>
            </Html>
          ))}
          {/* the chain behind: delta posts */}
          {info.chain.filter((r) => r.strike >= model.lo && r.strike <= model.hi).map((r) => (
            <mesh key={r.name} position={[model.X(r.strike), -H / 2 + Math.abs(r.delta ?? 0) * 3, -2.5]}>
              <boxGeometry args={[0.05, Math.max(0.05, Math.abs(r.delta ?? 0) * 6), 0.05]} />
              <meshBasicMaterial color={(r.kind === "put" ? new THREE.Color("#ff9d6e") : new THREE.Color("#8ab4ff")).multiplyScalar(0.8)} transparent opacity={0.5} />
            </mesh>
          ))}
          {/* now */}
          {info.spot > 0 && <Spot x={model.X(Math.min(model.hi, Math.max(model.lo, info.spot)))} y={model.Y(payoff(c.legs, c.credit_usd, info.spot))} />}
          {c.close_cost_usd != null && info.spot > 0 && (
            <mesh position={[model.X(Math.min(model.hi, Math.max(model.lo, info.spot))), model.Y(c.credit_usd - c.close_cost_usd), 0.2]} rotation={[0, 0, 0]}>
              <torusGeometry args={[0.3, 0.035, 8, 40]} />
              <meshBasicMaterial color={C_GOLD.clone().multiplyScalar(2.2)} toneMapped={false} />
            </mesh>
          )}
          <Html position={[0, H / 2 + 1.1, 0]} center style={{ pointerEvents: "none" }}>
            <div className="kalshi-hud">
              <div><span>keep if BTC ends</span><b className="pol pol--gain">{(c.legs[0].strike / 1000).toFixed(0)}k – {(c.legs[1].strike / 1000).toFixed(0)}k</b><em>credit ${c.credit_usd.toFixed(0)}</em></div>
              <div><span>worth now</span><b className={`pol pol--${(c.credit_usd - (c.close_cost_usd ?? c.credit_usd)) >= 0 ? "gain" : "loss"}`}>${(c.credit_usd - (c.close_cost_usd ?? c.credit_usd)).toFixed(0)}</b><em>{c.days_left.toFixed(1)} days left · max loss ${c.max_loss_usd.toFixed(0)}</em></div>
            </div>
          </Html>
        </group>
      )}
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.3}
        minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 1.9} minAzimuthAngle={-Math.PI / 4} maxAzimuthAngle={Math.PI / 4} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.3} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.7} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
