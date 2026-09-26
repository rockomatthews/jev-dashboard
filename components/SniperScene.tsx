"use client";

import { Edges, Grid, Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { pct, price, usd } from "@/lib/format";
import type { RadarItem, SniperInfo } from "@/lib/types";

// ---- axes -------------------------------------------------------------------------------
// x = pair age (log, young on the left) · y = 5-minute price move · z = buy pressure (buys/sells, log2)
const X_HALF = 8;
const Y_HALF = 3;
const Z_HALF = 4;
const FLOOR = -Y_HALF - 0.35;
const AGE_LO = 1;
const AGE_HI = 720;
const CHG_LO = -30;
const CHG_HI = 90;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ax = (age: number | null) =>
  -X_HALF + (2 * X_HALF * (Math.log(clamp(age ?? 60, AGE_LO, AGE_HI)) - Math.log(AGE_LO))) / (Math.log(AGE_HI) - Math.log(AGE_LO));
const ay = (chg5: number) => -Y_HALF + (2 * Y_HALF * (clamp(chg5, CHG_LO, CHG_HI) - CHG_LO)) / (CHG_HI - CHG_LO);
const az = (ratio: number) => (clamp(Math.log2(Math.max(ratio, 1e-3)), -2, 2) / 2) * Z_HALF;
const radius = (liq: number) => 0.09 + 0.3 * clamp((Math.log10(Math.max(liq, 1)) - 3.5) / 3, 0, 1);

// ---- palette ------------------------------------------------------------------------------
const C_REJECT = new THREE.Color("#3a4358");
const C_LOW = new THREE.Color("#1f4f8f");
const C_MID = new THREE.Color("#1b9bd0");
const C_HIGH = new THREE.Color("#b46bff");
const C_HOT = new THREE.Color("#ff4fd8");
const C_HELD = new THREE.Color("#ffc94d");
const C_COOL = new THREE.Color("#7b6f9e");
const C_ZONE = new THREE.Color("#35f0c0");

function scoreColor(s: number, minScore: number): THREE.Color {
  const t = clamp(s / Math.max(minScore, 0.01), 0, 1.4);
  if (t < 0.5) return C_LOW.clone().lerp(C_MID, t / 0.5);
  if (t < 1) return C_MID.clone().lerp(C_HIGH, (t - 0.5) / 0.5);
  return C_HIGH.clone().lerp(C_HOT, clamp((t - 1) / 0.4, 0, 1));
}

type Node = RadarItem & { p: THREE.Vector3; r: number; color: THREE.Color; key: string };

function useNodes(radar: RadarItem[], minScore: number): Node[] {
  return useMemo(
    () =>
      radar.map((it, i) => {
        const color =
          it.status === "held" ? C_HELD.clone()
            : it.status === "rejected" ? C_REJECT.clone()
              : it.status === "cooldown" ? C_COOL.clone()
                : scoreColor(it.score, minScore);
        return {
          ...it,
          key: `${it.token}-${i}`,
          p: new THREE.Vector3(ax(it.age_min), ay(it.chg5), az(it.buy_ratio)),
          r: radius(it.liquidity),
          color,
        };
      }),
    [radar, minScore],
  );
}

// ---- the snipe zone: where the score formula pays most -----------------------------------
function SnipeZone({ cfg }: { cfg: SniperInfo["config"] }) {
  const x0 = ax(cfg.min_age_min);
  const x1 = ax(cfg.max_age_min);
  const y0 = ay(-5);
  const y1 = ay(Math.min(cfg.max_m5_change, 60));
  const z0 = az(1.3);
  const z1 = az(4);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.05 + 0.03 * Math.sin(clock.getElapsedTime() * 1.6);
  });
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const cz = (z0 + z1) / 2;
  return (
    <group position={[cx, cy, cz]}>
      <mesh>
        <boxGeometry args={[x1 - x0, y1 - y0, z1 - z0]} />
        <meshBasicMaterial ref={mat} color={C_ZONE} transparent opacity={0.06} depthWrite={false} toneMapped={false} />
        <Edges color={C_ZONE.clone().multiplyScalar(1.6)} threshold={15} />
      </mesh>
      <Html position={[-(x1 - x0) / 2, (y1 - y0) / 2 + 0.25, (z1 - z0) / 2]} style={{ pointerEvents: "none" }}>
        <div className="scene-title scene-title--zone">SNIPE ZONE</div>
      </Html>
    </group>
  );
}

// ---- axes, ticks, floor sweep ---------------------------------------------------------------
function Axes() {
  const ticks: [number, string][] = [[5, "5m"], [30, "30m"], [120, "2h"], [360, "6h"]];
  const moves: [number, string][] = [[-20, "−20%"], [0, "0%"], [30, "+30%"], [60, "+60%"]];
  return (
    <group>
      <Line points={[[-X_HALF, FLOOR, Z_HALF], [X_HALF, FLOOR, Z_HALF]]} color="#4a5a80" lineWidth={1} />
      <Line points={[[-X_HALF, FLOOR, Z_HALF], [-X_HALF, Y_HALF, Z_HALF]]} color="#4a5a80" lineWidth={1} />
      <Line points={[[X_HALF, FLOOR, -Z_HALF], [X_HALF, FLOOR, Z_HALF]]} color="#4a5a80" lineWidth={1} />
      {ticks.map(([a, l]) => (
        <group key={l}>
          <Line points={[[ax(a), FLOOR, -Z_HALF], [ax(a), FLOOR, Z_HALF]]} color="#1d2a44" lineWidth={1} dashed dashSize={0.2} gapSize={0.2} />
          <Html position={[ax(a), FLOOR - 0.05, Z_HALF + 0.35]} center style={{ pointerEvents: "none" }}>
            <div className="scene-label scene-label--axis">{l}</div>
          </Html>
        </group>
      ))}
      {moves.map(([m, l]) => (
        <Html key={l} position={[-X_HALF - 0.45, ay(m), Z_HALF]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis">{l}</div>
        </Html>
      ))}
      <Line points={[[-X_HALF, ay(0), Z_HALF], [X_HALF, ay(0), Z_HALF]]} color="#2a3654" lineWidth={1} dashed dashSize={0.15} gapSize={0.15} />
      <Html position={[0, FLOOR - 0.1, Z_HALF + 0.9]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title">PAIR AGE →</div>
      </Html>
      <Html position={[-X_HALF - 0.4, Y_HALF + 0.45, Z_HALF]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title">5-MIN MOVE ↑</div>
      </Html>
      <Html position={[X_HALF + 0.6, FLOOR, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title">BUY<br />PRESSURE<br />↙ more buyers</div>
      </Html>
    </group>
  );
}

function RadarSweep() {
  const wedge = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (wedge.current) wedge.current.rotation.z = -t * 0.9;
    if (ring.current) {
      const k = (t * 0.35) % 1;
      ring.current.scale.setScalar(0.2 + k * 1.0);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - k);
    }
  });
  return (
    <group position={[0, FLOOR + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={wedge}>
        <circleGeometry args={[9.5, 48, 0, 0.55]} />
        <meshBasicMaterial color={C_ZONE} transparent opacity={0.09} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring}>
        <ringGeometry args={[9.2, 9.5, 96]} />
        <meshBasicMaterial color={C_ZONE} transparent opacity={0.3} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {[3, 6, 9].map((r) => (
        <mesh key={r}>
          <ringGeometry args={[r - 0.015, r + 0.015, 128]} />
          <meshBasicMaterial color="#1f3b5e" transparent opacity={0.7} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

// ---- cluster constellation: each live token linked to its two nearest live neighbours ----------
function Constellation({ nodes }: { nodes: Node[] }) {
  const geom = useMemo(() => {
    const live = nodes.filter((n) => n.status !== "rejected");
    const pos: number[] = [];
    const col: number[] = [];
    const seen = new Set<string>();
    live.forEach((a, i) => {
      const near = live
        .map((b, j) => ({ j, d: a.p.distanceTo(b.p) }))
        .filter((x) => x.j !== i)
        .sort((u, v) => u.d - v.d)
        .slice(0, 2);
      near.forEach(({ j, d }) => {
        const k = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(k) || d > 5) return;
        seen.add(k);
        const b = live[j];
        pos.push(a.p.x, a.p.y, a.p.z, b.p.x, b.p.y, b.p.z);
        col.push(a.color.r * 0.5, a.color.g * 0.5, a.color.b * 0.5, b.color.r * 0.5, b.color.g * 0.5, b.color.b * 0.5);
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [nodes]);
  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial vertexColors transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </lineSegments>
  );
}

// ---- stems to the floor so depth is readable -------------------------------------------------
function Stems({ nodes }: { nodes: Node[] }) {
  const geom = useMemo(() => {
    const pos: number[] = [];
    nodes.filter((n) => n.status !== "rejected").forEach((n) => pos.push(n.p.x, n.p.y, n.p.z, n.p.x, FLOOR, n.p.z));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [nodes]);
  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial color="#2c4f7a" transparent opacity={0.35} depthWrite={false} />
    </lineSegments>
  );
}

// ---- one token -------------------------------------------------------------------------------
function TokenNode({ n, hovered, onHover, showLabel, minScore }: {
  n: Node; hovered: boolean; onHover: (k: string | null) => void; showLabel: boolean; minScore: number;
}) {
  const core = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  const hot = n.status === "candidate" || n.status === "held";
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() + phase;
    if (core.current) {
      const s = hot ? 1 + Math.sin(t * 4) * 0.12 : 1 + Math.sin(t * 1.3) * 0.04;
      core.current.scale.setScalar(s * (hovered ? 1.35 : 1));
      if (n.status !== "rejected") core.current.position.y = Math.sin(t * 0.9) * 0.05;
    }
    if (halo.current) {
      const k = (t * 0.6) % 1;
      halo.current.scale.setScalar(1 + k * 1.8);
      (halo.current.material as THREE.MeshBasicMaterial).opacity = (hot ? 0.45 : 0.18) * (1 - k);
    }
    if (ring.current) {
      ring.current.rotation.z = t * 1.4;
      ring.current.rotation.x = Math.PI / 2 + Math.sin(t * 0.7) * 0.4;
    }
  });
  const glow = n.color.clone().multiplyScalar(n.status === "rejected" ? 0.8 : hot ? 2.6 : 1.5);
  return (
    <group position={n.p}>
      <mesh
        ref={core}
        onPointerOver={(e) => { e.stopPropagation(); onHover(n.key); }}
        onPointerOut={() => onHover(null)}
      >
        <icosahedronGeometry args={[n.r, 2]} />
        <meshStandardMaterial color={n.color} emissive={glow} emissiveIntensity={n.status === "rejected" ? 0.25 : 1}
          roughness={0.3} metalness={0.3} transparent opacity={n.status === "rejected" ? 0.35 : 0.95} toneMapped={false} />
      </mesh>
      {n.status !== "rejected" && (
        <mesh ref={halo}>
          <sphereGeometry args={[n.r * 1.05, 20, 20]} />
          <meshBasicMaterial color={glow} transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      )}
      {n.status === "held" && (
        <mesh ref={ring}>
          <torusGeometry args={[n.r * 2.1, 0.025, 12, 64]} />
          <meshBasicMaterial color={C_HELD.clone().multiplyScalar(2.4)} toneMapped={false} />
        </mesh>
      )}
      {n.status === "cooldown" && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[n.r * 1.5, n.r * 1.6, 32]} />
          <meshBasicMaterial color={C_COOL} transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
      )}
      {showLabel && !hovered && (
        <Html position={[0, n.r + 0.28, 0]} center style={{ pointerEvents: "none" }}>
          <div className={`scene-label scene-label--token scene-label--${n.status}`}>
            <span className="scene-label__coin">${n.symbol}</span>
            <span>{n.status === "held" ? "HELD" : n.score.toFixed(2)}</span>
          </div>
        </Html>
      )}
      {hovered && (
        <Html position={[0, n.r + 0.2, 0]} style={{ pointerEvents: "none" }}>
          <div className="tooltip" style={{ transform: `translate(${n.p.x > 3 ? "-110%" : "14px"}, -50%)` }}>
            <div className="tooltip__time">${n.symbol} · {n.status.toUpperCase()}{n.why ? ` · ${n.why}` : ""}</div>
            <div className="tooltip__row"><span>Snipe score</span><b>{n.score.toFixed(2)} / {minScore.toFixed(2)} needed</b></div>
            <div className="tooltip__row"><span>Age</span><b>{n.age_min === null ? "—" : n.age_min < 90 ? `${Math.round(n.age_min)} min` : `${(n.age_min / 60).toFixed(1)} h`}</b></div>
            <div className="tooltip__row"><span>Liquidity</span><b>{usd(n.liquidity, false)}</b></div>
            <div className="tooltip__row"><span>Buys / sells 5m</span><b>{n.buys5} / {n.sells5}</b></div>
            <div className="tooltip__row"><span>Move 5m · 1h</span><b>{pct(n.chg5 / 100, 1, true)} · {pct(n.chg1h / 100, 0, true)}</b></div>
            <div className="tooltip__row"><span>Vol 5m / liq</span><b>{pct(n.turnover5, 1)}</b></div>
            <div className="tooltip__row"><span>Price</span><b>${price(n.price)}</b></div>
          </div>
        </Html>
      )}
    </group>
  );
}

// ---- crosshair on the best target ------------------------------------------------------------
function Reticle({ n }: { n: Node }) {
  const g = useRef<THREE.Group>(null);
  const a = useRef<THREE.Mesh>(null);
  const b = useRef<THREE.Mesh>(null);
  const cur = useRef(new THREE.Vector3().copy(n.p));
  useFrame(({ clock, camera }, dt) => {
    const t = clock.getElapsedTime();
    cur.current.lerp(n.p, Math.min(1, dt * 4));
    if (g.current) {
      g.current.position.copy(cur.current);
      g.current.quaternion.copy(camera.quaternion); // always faces the viewer
    }
    if (a.current) a.current.rotation.z = t * 0.8;
    if (b.current) {
      b.current.rotation.z = -t * 1.3;
      b.current.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    }
  });
  const R = n.r * 2.6 + 0.25;
  const c = C_ZONE.clone().multiplyScalar(2.2);
  return (
    <group ref={g}>
      <mesh ref={a}>
        <ringGeometry args={[R, R + 0.03, 64, 1, 0, Math.PI * 1.6]} />
        <meshBasicMaterial color={c} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={b}>
        <ringGeometry args={[R * 0.72, R * 0.72 + 0.02, 4, 1, Math.PI / 4]} />
        <meshBasicMaterial color={c} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const ang = (i * Math.PI) / 2;
        const x = Math.cos(ang);
        const y = Math.sin(ang);
        return <Line key={i} points={[[x * (R + 0.08), y * (R + 0.08), 0], [x * (R + 0.45), y * (R + 0.45), 0]]} color={c} lineWidth={2} toneMapped={false} />;
      })}
      <Html position={[R + 0.5, R + 0.1, 0]} style={{ pointerEvents: "none" }}>
        <div className="reticle-label">
          <span>{n.status === "held" ? "IN POSITION" : "TARGET LOCK"}</span>
          <b>${n.symbol}</b>
          <span>score {n.score.toFixed(2)}</span>
        </div>
      </Html>
    </group>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 17 * Math.max(1, 1.7 / aspect);
    const dir = camera.position.clone().normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function SniperScene({ sniper, demo, active = true }: { sniper: SniperInfo; demo?: boolean; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const minScore = sniper.config.min_score;
  const nodes = useNodes(sniper.radar, minScore);
  const [hover, setHover] = useState<string | null>(null);
  const [spin, setSpin] = useState(true);

  const labelled = useMemo(() => {
    const s = new Set<string>();
    nodes.filter((n) => n.status === "held").forEach((n) => s.add(n.key));
    nodes.filter((n) => n.status !== "rejected").sort((a, b) => b.score - a.score).slice(0, 7).forEach((n) => s.add(n.key));
    return s;
  }, [nodes]);

  const target = useMemo(
    () => nodes.filter((n) => n.status === "candidate").sort((a, b) => b.score - a.score)[0]
      ?? nodes.filter((n) => n.status === "held")[0]
      ?? nodes.filter((n) => n.status === "watch").sort((a, b) => b.score - a.score)[0],
    [nodes],
  );

  return (
    <Canvas
      camera={{ position: [5, 4.2, 15], fov: 42 }}
      dpr={[1, 2]}
      frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#05060f")}
      onPointerDown={() => setSpin(false)}
    >
      <CameraFit />
      <fog attach="fog" args={["#05060f", 16, 60]} />
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 7, 6]} intensity={45} color="#c9a4ff" />
      <pointLight position={[-8, 2, -6]} intensity={25} color="#35f0c0" />
      <Stars radius={60} depth={30} count={2200} factor={3} saturation={0} fade speed={0.5} />
      <Sparkles count={120} scale={[20, 8, 12]} size={1.6} speed={0.35} opacity={0.35} color="#b46bff" />
      <group>
        <Axes />
        <RadarSweep />
        <SnipeZone cfg={sniper.config} />
        <Stems nodes={nodes} />
        <Constellation nodes={nodes} />
        {nodes.map((n) => (
          <TokenNode key={n.key} n={n} hovered={hover === n.key} onHover={setHover}
            showLabel={labelled.has(n.key)} minScore={minScore} />
        ))}
        {target && <Reticle n={target} />}
        {nodes.length === 0 && (
          <Html center style={{ pointerEvents: "none" }}>
            <div className="scene-title scene-title--zone">SCANNING SOLANA PAIRS…</div>
          </Html>
        )}
        {demo && (
          <Html position={[0, Y_HALF + 0.9, 0]} center style={{ pointerEvents: "none" }}>
            <div className="scene-title">SAMPLE DATA · FIRST LIVE SCAN PENDING</div>
          </Html>
        )}
      </group>
      <Grid position={[0, FLOOR - 0.02, 0]} args={[40, 40]} cellSize={0.5} cellThickness={0.5} cellColor="#14192e"
        sectionSize={2} sectionThickness={1} sectionColor="#2b2358" fadeDistance={30} fadeStrength={1.6} infiniteGrid />
      <OrbitControls target={[0, -0.3, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.35}
        minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 2.05} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.25} luminanceThreshold={0.22} luminanceSmoothing={0.2} />
          <ChromaticAberration offset={new THREE.Vector2(0.0006, 0.0006)} radialModulation={false} modulationOffset={0} />
          <Vignette eskil={false} offset={0.2} darkness={0.8} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
