"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { price } from "@/lib/format";
import type { MetaInfo, MetaRadarItem } from "@/lib/types";

// Strategy 12 "Metadata Movers": a market-cap elevator. Height = market cap (log, $10k floor to $10M);
// x = how new the pair is (log hours, newest on the left); depth = chain (Solana behind, Base in front).
// Two glowing floors: the $1M entry ceiling (buy below it) and the $3M line where the trailing stop tightens. Each coin carries three
// small beads for its metadata (description, website, X): one lit is enough, more ranks higher. Held coins are gold,
// with a beam from their entry market cap to now and a ring at the price where the trail would sell.

const X_HALF = 8;
const Z_HALF = 3.2;
const Y_LO = 0;
const Y_HI = 7.2;
const MC_LO = 1e4;
const MC_HI = 1e7;
const AGE_LO = 0.25;
const AGE_HI = 120;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ay = (mc: number) => Y_LO + ((Math.log10(clamp(mc || MC_LO, MC_LO, MC_HI)) - 4) / 3) * (Y_HI - Y_LO);
const ax = (ageMin: number | null) => {
  const h = clamp((ageMin ?? 60 * 24) / 60, AGE_LO, AGE_HI);
  return -X_HALF + (2 * X_HALF * (Math.log(h) - Math.log(AGE_LO))) / (Math.log(AGE_HI) - Math.log(AGE_LO));
};
const az = (chain: string | null) => (chain === "base" ? Z_HALF * 0.55 : -Z_HALF * 0.55);
const radius = (liq: number) => 0.1 + 0.28 * clamp((Math.log10(Math.max(liq, 1)) - 3.8) / 2.4, 0, 1);

const C_REJECT = new THREE.Color("#3a4358");
const C_CAND = new THREE.Color("#35f0c0");
const C_HELD = new THREE.Color("#ffc94d");
const C_COOL = new THREE.Color("#7b6f9e");
const C_SOL = new THREE.Color("#b38cff");
const C_BASE = new THREE.Color("#4d8dff");
const C_BEAD_ON = new THREE.Color("#7dffb0");
const C_BEAD_OFF = new THREE.Color("#2a3348");

type Node = MetaRadarItem & { p: THREE.Vector3; r: number; color: THREE.Color; k: string };

function useNodes(radar: MetaRadarItem[]): Node[] {
  return useMemo(() => radar.filter((it) => (it.mc ?? 0) > 0).map((it, i) => ({
    ...it,
    k: `${it.token}-${i}`,
    p: new THREE.Vector3(ax(it.age_min), ay(it.mc), az(it.chain) + ((i % 7) - 3) * 0.12),
    r: radius(it.liquidity),
    color: it.status === "held" ? C_HELD.clone() : it.status === "candidate" ? C_CAND.clone()
      : it.status === "cooldown" ? C_COOL.clone() : C_REJECT.clone(),
  })), [radar]);
}

function Floor({ mc, label, color, opacity }: { mc: number; label: string; color: string; opacity: number }) {
  const y = ay(mc);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = opacity * (0.8 + 0.2 * Math.sin(clock.getElapsedTime() * 1.4));
  });
  const hx = X_HALF + 0.3;
  const hz = Z_HALF;
  return (
    <group>
      <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2 * hx, 2 * hz]} />
        <meshBasicMaterial ref={mat} color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={[[-hx, y, -hz], [hx, y, -hz], [hx, y, hz], [-hx, y, hz], [-hx, y, -hz]]} color={color} lineWidth={1.3}
        dashed dashSize={0.25} gapSize={0.15} transparent opacity={0.85} />
      <Html position={[hx + 0.3, y, hz]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ color }}>{label}</div>
      </Html>
    </group>
  );
}

function Coins({ nodes, onHover }: { nodes: Node[]; onHover: (n: Node | null) => void }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    g.current?.children.forEach((c, k) => {
      const n = nodes[k];
      if (!n) return;
      const s = n.status === "held" ? 1 + 0.18 * Math.sin(t * 3 + k) : n.status === "candidate" ? 1 + 0.1 * Math.sin(t * 2 + k) : 1;
      c.scale.setScalar(s);
    });
  });
  return (
    <group ref={g}>
      {nodes.map((n) => {
        const beads = [n.has_desc, !!n.website, !!n.twitter];
        const bright = n.status === "held" ? 2.6 : n.status === "candidate" ? 2.0 : 1.0;
        return (
          <group key={n.k} position={n.p}>
            <mesh onPointerOver={(e) => { e.stopPropagation(); onHover(n); }} onPointerOut={() => onHover(null)}>
              <sphereGeometry args={[n.r, 20, 20]} />
              <meshBasicMaterial color={n.color.clone().multiplyScalar(bright)} toneMapped={false}
                transparent opacity={n.status === "rejected" ? 0.45 : 0.95} />
            </mesh>
            {beads.map((on, b) => (
              <mesh key={b} position={[(b - 1) * (n.r + 0.06), n.r + 0.12, 0]}>
                <sphereGeometry args={[0.045, 8, 8]} />
                <meshBasicMaterial color={(on ? C_BEAD_ON : C_BEAD_OFF).clone().multiplyScalar(on ? 2 : 1)} toneMapped={false} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

function Beams({ info }: { info: MetaInfo }) {
  const target = ay(info.config.target_mc);
  return (
    <group>
      {info.holdings.map((h) => {
        const r = info.radar.find((x) => x.token === h.token);
        if (!r) return null;
        const x = ax(r.age_min);
        const z = az(h.chain ?? r.chain);
        const y0 = ay(h.entry_mc ?? r.mc);
        const y1 = ay(h.last_mc ?? r.mc);
        return (
          <group key={h.key}>
            <Line points={[[x, y0, z], [x, target, z]]} color="#ffc94d" lineWidth={1} dashed dashSize={0.12} gapSize={0.1} transparent opacity={0.6} />
            <Line points={[[x, y0, z], [x, y1, z]]} color={y1 >= y0 ? "#7dffb0" : "#d96b25"} lineWidth={3} toneMapped={false} />
            {h.trail_armed && h.trail_pct && h.peak_mc ? (
              <mesh position={[x, ay(h.peak_mc * (1 - h.trail_pct)), z]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.32, 0.03, 8, 32]} />
                <meshBasicMaterial color={new THREE.Color("#ff5a7a").multiplyScalar(2)} toneMapped={false} />
              </mesh>
            ) : null}
            <Html position={[x, target + 0.25, z]} center style={{ pointerEvents: "none" }}>
              <div className="scene-label scene-label--held"><span className="scene-label__coin">${h.symbol}</span>
                <span>{h.trail_armed && h.trail_pct ? `trail −${Math.round(h.trail_pct * 100)}%` : `${Math.round(h.ret * 100)}%`}</span></div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function Axes() {
  const mcs: [number, string][] = [[1e4, "$10k"], [1e5, "$100k"], [1e6, "$1M"], [1e7, "$10M"]];
  const ages: [number, string][] = [[0.5, "30m"], [3, "3h"], [24, "1d"], [72, "3d"]];
  const x0 = -X_HALF - 0.4;
  return (
    <group>
      <Line points={[[x0, Y_LO, Z_HALF], [x0, Y_HI, Z_HALF]]} color="#4a5a80" lineWidth={1} />
      <Line points={[[-X_HALF, Y_LO, Z_HALF], [X_HALF, Y_LO, Z_HALF]]} color="#4a5a80" lineWidth={1} />
      {mcs.map(([m, l]) => (
        <Html key={l} position={[x0 - 0.45, ay(m), Z_HALF]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis">{l}</div>
        </Html>
      ))}
      {ages.map(([h, l]) => (
        <Html key={l} position={[ax(h * 60), Y_LO - 0.3, Z_HALF + 0.3]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis">{l}</div>
        </Html>
      ))}
      <Html position={[X_HALF + 0.4, Y_LO + 0.2, -Z_HALF * 0.55]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ color: "#b38cff" }}>SOLANA</div>
      </Html>
      <Html position={[X_HALF + 0.4, Y_LO + 0.2, Z_HALF * 0.55]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ color: "#4d8dff" }}>BASE</div>
      </Html>
      <mesh position={[0, Y_LO - 0.02, -Z_HALF * 0.55]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2 * X_HALF, Z_HALF * 0.9]} />
        <meshBasicMaterial color={C_SOL} transparent opacity={0.05} depthWrite={false} />
      </mesh>
      <mesh position={[0, Y_LO - 0.02, Z_HALF * 0.55]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2 * X_HALF, Z_HALF * 0.9]} />
        <meshBasicMaterial color={C_BASE} transparent opacity={0.05} depthWrite={false} />
      </mesh>
      <Html position={[0, Y_HI + 0.6, -Z_HALF]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title">METADATA MOVERS · MARKET-CAP ELEVATOR</div>
        <div className="scene-label scene-label--axis" style={{ textAlign: "center" }}>
          height: market cap · left→right: pair age · beads: description · website · X
        </div>
      </Html>
    </group>
  );
}

function Tooltip({ n }: { n: Node }) {
  return (
    <Html position={[n.p.x, n.p.y + n.r + 0.3, n.p.z]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${n.p.x > 3 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">${n.symbol} · {n.chain} · {n.status}{n.why ? ` (${n.why})` : ""}</div>
        <div className="tooltip__row"><span>market cap</span><b>${Math.round(n.mc).toLocaleString()}</b></div>
        <div className="tooltip__row"><span>price</span><b>${price(n.price)}</b></div>
        <div className="tooltip__row"><span>pool</span><b>${Math.round(n.liquidity).toLocaleString()}</b></div>
        <div className="tooltip__row"><span>metadata</span>
          <b>{[n.has_desc ? "desc" : null, n.website ? "site" : null, n.twitter ? "X" : null].filter(Boolean).join(" · ") || "none"}</b></div>
        {n.description && <div className="tooltip__row"><span>{n.description.slice(0, 90)}</span></div>}
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

export default function MetaScene({ info, active = true }: { info: MetaInfo; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const nodes = useNodes(info.radar);
  const [hover, setHover] = useState<Node | null>(null);
  const [spin, setSpin] = useState(true);
  return (
    <Canvas camera={{ position: [8, 7, 15], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#06060d")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#06060d", 20, 60]} />
      <ambientLight intensity={0.5} />
      <pointLight position={[-8, 6, 6]} intensity={26} color="#b38cff" />
      <pointLight position={[8, 6, -6]} intensity={22} color="#4d8dff" />
      <Stars radius={60} depth={30} count={1800} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={110} scale={[20, 8, 10]} size={1.6} speed={0.35} opacity={0.35} color="#7dffb0" />
      <group position={[0, -3.2, 0]}>
        <Floor mc={info.config.max_entry_mc} label={`$${(info.config.max_entry_mc / 1e6).toFixed(0)}M · buy below`} color="#35f0c0" opacity={0.07} />
        <Floor mc={info.config.target_mc} label={`$${(info.config.target_mc / 1e6).toFixed(0)}M · tight trail`} color="#ffc94d" opacity={0.06} />
        <Coins nodes={nodes} onHover={setHover} />
        <Beams info={info} />
        <Axes />
        {hover && <Tooltip n={hover} />}
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.3}
        minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.1} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.1} luminanceThreshold={0.35} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
