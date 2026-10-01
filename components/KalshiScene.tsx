"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { KalshiInfo, KalshiMarket, KalshiTrip } from "@/lib/types";

// Strategy 7 "Spread harvest": every market the scalper works is a glowing price tower (0c at the floor,
// 100c at the top) standing on an arc. Its order book hangs off the tower: YES bids reach left (blue),
// YES asks reach right (orange), bar length = contracts resting at that price. The empty band between
// them is the spread - the thing this strategy harvests - and it glows. Our resting bid is a cyan ring,
// our resting offer a gold ring, a held position a gold orb. Finished round trips loop out in front of
// the tower from entry price to exit price: green = made money, orange = lost, dashed = bailed out as a taker.

const H = 7;              // tower height for 0..100 cents
const R = 9;              // arc radius
const ARC = Math.PI * 0.8;
const BAR_MAX = 1.6;

const C_BID = new THREE.Color("#1b9bd0");
const C_ASK = new THREE.Color("#d96b25");
const C_GAP = new THREE.Color("#35f0c0");
const C_OURBID = new THREE.Color("#5ff2ff");
const C_OURASK = new THREE.Color("#ffc94d");
const C_WIN = new THREE.Color("#3ecf8e");
const C_LOSS = new THREE.Color("#ff7a3d");

const yOf = (p: number) => p * H;

function placement(i: number, n: number) {
  const a = n === 1 ? 0 : -ARC / 2 + (ARC * i) / (n - 1);
  return { x: Math.sin(a) * R, z: -Math.cos(a) * R + R * 0.55, rot: -a };
}

function Tower({ m, maxQty, hovered, onHover, trips }: {
  m: KalshiMarket; maxQty: number; hovered: boolean; onHover: (t: string | null) => void; trips: KalshiTrip[];
}) {
  const gap = useRef<THREE.MeshBasicMaterial>(null);
  const orb = useRef<THREE.Mesh>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const bestBid = m.bids[0]?.[0] ?? m.bid;
  const bestAsk = m.asks[0]?.[0] ?? m.ask;
  const len = (q: number) => 0.08 + (Math.log10(1 + q) / Math.log10(1 + maxQty)) * BAR_MAX;
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (gap.current) gap.current.opacity = 0.18 + 0.12 * Math.sin(t * 2.2 + m.vol24 % 7);
    if (orb.current) orb.current.scale.setScalar(1 + 0.18 * Math.sin(t * 4));
    if (pulse.current) {
      const k = (t * 0.35 + (m.vol24 % 10) / 10) % 1;
      pulse.current.position.y = k * H;
      (pulse.current.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k);
    }
  });
  const loops = trips.slice(-6);
  return (
    <group>
      {/* the tower */}
      <mesh position={[0, H / 2, 0]} onPointerOver={(e) => { e.stopPropagation(); onHover(m.ticker); }} onPointerOut={() => onHover(null)}>
        <boxGeometry args={[0.16, H, 0.16]} />
        <meshStandardMaterial color="#1a2340" emissive={hovered ? "#3a5590" : "#16203a"} emissiveIntensity={1} toneMapped={false} />
      </mesh>
      <mesh ref={pulse} position={[0, 0, 0]}>
        <boxGeometry args={[0.3, 0.04, 0.3]} />
        <meshBasicMaterial color={C_GAP.clone().multiplyScalar(2)} transparent opacity={0.4} toneMapped={false} />
      </mesh>
      {[0.25, 0.5, 0.75].map((p) => (
        <mesh key={p} position={[0, yOf(p), 0]}>
          <boxGeometry args={[0.34, 0.015, 0.34]} />
          <meshBasicMaterial color="#2c3a62" />
        </mesh>
      ))}
      {/* order book: bids left, asks right */}
      {m.bids.slice(0, 10).map(([p, q], k) => {
        const l = len(q);
        return (
          <mesh key={`b${k}`} position={[-0.1 - l / 2, yOf(p), 0]}>
            <boxGeometry args={[l, 0.05, 0.12]} />
            <meshBasicMaterial color={C_BID.clone().multiplyScalar(k === 0 ? 2.2 : 1.2 - k * 0.07)} toneMapped={false} />
          </mesh>
        );
      })}
      {m.asks.slice(0, 10).map(([p, q], k) => {
        const l = len(q);
        return (
          <mesh key={`a${k}`} position={[0.1 + l / 2, yOf(p), 0]}>
            <boxGeometry args={[l, 0.05, 0.12]} />
            <meshBasicMaterial color={C_ASK.clone().multiplyScalar(k === 0 ? 2.2 : 1.2 - k * 0.07)} toneMapped={false} />
          </mesh>
        );
      })}
      {/* the spread: what we harvest */}
      {bestAsk > bestBid && (
        <mesh position={[0, yOf((bestBid + bestAsk) / 2), 0]}>
          <boxGeometry args={[1.1, Math.max(0.02, yOf(bestAsk - bestBid)), 0.5]} />
          <meshBasicMaterial ref={gap} color={C_GAP} transparent opacity={0.25} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      )}
      {m.our_bid !== null && (
        <mesh position={[0, yOf(m.our_bid), 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.32, 0.035, 10, 40]} />
          <meshBasicMaterial color={C_OURBID.clone().multiplyScalar(2.4)} toneMapped={false} />
        </mesh>
      )}
      {m.our_ask !== null && (
        <mesh position={[0, yOf(m.our_ask), 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.32, 0.035, 10, 40]} />
          <meshBasicMaterial color={C_OURASK.clone().multiplyScalar(2.4)} toneMapped={false} />
        </mesh>
      )}
      {m.held > 0 && m.entry !== null && (
        <mesh ref={orb} position={[0, yOf(m.entry), 0.35]}>
          <sphereGeometry args={[0.13, 18, 18]} />
          <meshBasicMaterial color={C_OURASK.clone().multiplyScalar(2.6)} toneMapped={false} />
        </mesh>
      )}
      {/* finished round trips loop out in front */}
      {loops.map((t, k) => {
        const z0 = 0.45 + k * 0.22;
        const a = new THREE.Vector3(0, yOf(t.entry), 0.1);
        const b = new THREE.Vector3(0, yOf(t.exit), 0.1);
        const bulge = 0.5 + Math.min(1.6, Math.log10(1 + t.hold_s) * 0.6);
        const curve = new THREE.CubicBezierCurve3(a, new THREE.Vector3(-0.15, a.y, z0 + bulge), new THREE.Vector3(0.15, b.y, z0 + bulge), b);
        const col = (t.pnl > 0 ? C_WIN : C_LOSS).clone().multiplyScalar(2);
        return <Line key={k} points={curve.getPoints(24)} color={col} lineWidth={2} dashed={t.how === "taker"} dashSize={0.12} gapSize={0.08} toneMapped={false} />;
      })}
      <Html position={[0, -0.35, 0]} center style={{ pointerEvents: "none" }}>
        <div className={`scene-label ${hovered ? "scene-label--hot" : ""}`}>
          <span className="scene-label__coin">{m.ticker.length > 18 ? m.ticker.slice(0, 17) + "…" : m.ticker}</span>
          <span>{Math.round(bestBid * 100)}¢ / {Math.round(bestAsk * 100)}¢ · {m.stage}</span>
        </div>
      </Html>
    </group>
  );
}

function Tooltip({ m, trips }: { m: KalshiMarket; trips: KalshiTrip[] }) {
  const pnl = trips.reduce((s, t) => s + t.pnl, 0);
  return (
    <Html position={[0, H + 0.4, 0]} center style={{ pointerEvents: "none" }}>
      <div className="tooltip">
        <div className="tooltip__time">{m.title}</div>
        <div className="tooltip__row"><span>Best bid / ask</span><b>{Math.round((m.bids[0]?.[0] ?? m.bid) * 100)}¢ / {Math.round((m.asks[0]?.[0] ?? m.ask) * 100)}¢</b></div>
        <div className="tooltip__row"><span>Our order</span><b>{m.our_bid !== null ? `bid ${Math.round(m.our_bid * 100)}¢` : m.our_ask !== null ? `offer ${Math.round(m.our_ask * 100)}¢` : "—"}</b></div>
        <div className="tooltip__row"><span>Held</span><b>{m.held > 0 ? `${m.held} @ ${Math.round((m.entry ?? 0) * 100)}¢` : "flat"}</b></div>
        <div className="tooltip__row"><span>24h volume</span><b>{Math.round(m.vol24).toLocaleString()} contracts</b></div>
        <div className="tooltip__row"><span>Round trips · P&amp;L</span><b>{trips.length} · {pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)}</b></div>
        <div className="tooltip__row"><span>Closes in</span><b>{m.hours_to_close}h</b></div>
      </div>
    </Html>
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

function Floor() {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.rotation.z = clock.getElapsedTime() * 0.08;
  });
  return (
    <group position={[0, -0.02, R * 0.55]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={ring}>
        <ringGeometry args={[R - 0.6, R + 0.6, 128, 1, Math.PI / 2 - ARC / 2 - 0.15, ARC + 0.3]} />
        <meshBasicMaterial color="#13203a" transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <ringGeometry args={[R + 0.58, R + 0.62, 128]} />
        <meshBasicMaterial color={C_GAP} transparent opacity={0.25} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}

export default function KalshiScene({ info, active = true }: { info: KalshiInfo; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<string | null>(null);
  const [spin, setSpin] = useState(true);
  const markets = info.markets;
  const maxQty = useMemo(() => Math.max(10, ...markets.flatMap((m) => [...m.bids, ...m.asks].map(([, q]) => q))), [markets]);
  const tripsBy = useMemo(() => {
    const out: Record<string, KalshiTrip[]> = {};
    info.round_trips.forEach((t) => { (out[t.ticker] ||= []).push(t); });
    return out;
  }, [info.round_trips]);
  const ours = info.summary.pnl_per_contract_c;
  const naive = info.control.pnl_per_contract_c;
  return (
    <Canvas
      camera={{ position: [0, 7, 17], fov: 42 }}
      dpr={[1, 2]}
      frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#04070d")}
      onPointerDown={() => setSpin(false)}
    >
      <CameraFit />
      <fog attach="fog" args={["#04070d", 20, 60]} />
      <ambientLight intensity={0.5} />
      <pointLight position={[0, 10, 8]} intensity={40} color="#9fd8ff" />
      <Stars radius={60} depth={30} count={2000} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={100} scale={[24, 9, 14]} size={1.5} speed={0.3} opacity={0.3} color="#35f0c0" />
      <group position={[0, -H / 2 + 0.3, -R * 0.35]}>
        <Floor />
        {markets.map((m, i) => {
          const pl = placement(i, markets.length);
          return (
            <group key={m.ticker} position={[pl.x, 0, pl.z]} rotation={[0, pl.rot, 0]}>
              <Tower m={m} maxQty={maxQty} hovered={hover === m.ticker} onHover={setHover} trips={tripsBy[m.ticker] ?? []} />
              {hover === m.ticker && <Tooltip m={m} trips={tripsBy[m.ticker] ?? []} />}
            </group>
          );
        })}
        {markets.length === 0 && (
          <Html position={[0, H / 2, 0]} center style={{ pointerEvents: "none" }}>
            <div className="scene-title scene-title--zone">WAITING FOR KALSHI MARKETS WITH A 3¢+ SPREAD…</div>
          </Html>
        )}
        <Html position={[0, H + 1.4, 0]} center style={{ pointerEvents: "none" }}>
          <div className="kalshi-hud">
            <div><span>naive buy-then-sell</span><b className="pol pol--loss">{naive === null ? "—" : `${naive.toFixed(1)}¢`}</b><em>per contract</em></div>
            <div><span>spread harvest (ours)</span><b className={`pol pol--${ours === null ? "flat" : ours > 0 ? "gain" : "loss"}`}>{ours === null ? "—" : `${ours > 0 ? "+" : ""}${ours.toFixed(2)}¢`}</b><em>{info.summary.round_trips} round trips</em></div>
          </div>
        </Html>
        <Line points={[[-R, 0, R * 0.55], [-R, H, R * 0.55]]} color="#22304f" lineWidth={1} />
        <Html position={[-R - 0.4, H, R * 0.55]} center style={{ pointerEvents: "none" }}><div className="scene-label scene-label--axis">100¢</div></Html>
        <Html position={[-R - 0.4, H / 2, R * 0.55]} center style={{ pointerEvents: "none" }}><div className="scene-label scene-label--axis">50¢</div></Html>
        <Html position={[-R - 0.4, 0, R * 0.55]} center style={{ pointerEvents: "none" }}><div className="scene-label scene-label--axis">0¢</div></Html>
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.3}
        minPolarAngle={Math.PI / 5} maxPolarAngle={Math.PI / 2.05} minAzimuthAngle={-Math.PI / 3} maxAzimuthAngle={Math.PI / 3} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.3} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
