"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SpectrumScene as SceneData } from "@/lib/types";

// Strategy 28 "Absorption Ratio": the risk spectrum of the whole coin market. In front, one glass tower per
// principal component of the 22 coins' covariance, tallest first: its height is the share of all variance that
// component explains. The first n towers (1/5 of the coins) glow: their sum is the absorption ratio - how much of
// the market moves as one. Around the tallest tower, every coin is a moon whose height is its loading on that shared
// move. Behind, the last year of the absorption ratio runs as a ribbon (white = daily AR, cyan = 15-day mean,
// violet = 1-year mean), coloured underneath by what the book held: green all in, amber half, red cash.

const TOWER_GAP = 0.7;
const TOWER_H = 9;            // world units for 100% of variance
const RIB_W = 20;
const RIB_Z = -6;
const C_TOP = new THREE.Color("#5cf2ff");
const C_REST = new THREE.Color("#3b4a7a");
const C_IN = new THREE.Color("#4dff8f");
const C_HALF = new THREE.Color("#ffc94d");
const C_OUT = new THREE.Color("#ff5a5a");

function stateColor(e: number | null | undefined) {
  return e === 1 ? C_IN : e === 0 ? C_OUT : e === 0.5 ? C_HALF : C_REST;
}

type Hover = { kind: "tower"; i: number; share: number } | { kind: "coin"; c: string; pc1: number; vol: number; p: [number, number, number] } | null;

function Towers({ sc, onHover }: { sc: SceneData; onHover: (h: Hover) => void }) {
  const ev = sc.eig_share ?? [];
  const n = ev.length;
  const glow = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!glow.current) return;
    const k = 1 + 0.04 * Math.sin(clock.getElapsedTime() * 1.6);
    glow.current.scale.set(1, k, 1);
  });
  return (
    <group>
      <group ref={glow}>
        {ev.map((v, i) => {
          if (i >= sc.n_top) return null;
          const h = Math.max(0.05, v * TOWER_H);
          const x = (i - (n - 1) / 2) * TOWER_GAP;
          return (
            <mesh key={i} position={[x, h / 2, 0]} onPointerOver={(e) => { e.stopPropagation(); onHover({ kind: "tower", i, share: v }); }}
              onPointerOut={() => onHover(null)}>
              <boxGeometry args={[0.5, h, 0.5]} />
              <meshBasicMaterial color={C_TOP.clone().multiplyScalar(i === 0 ? 2.4 : 1.6)} toneMapped={false} transparent opacity={0.85} />
            </mesh>
          );
        })}
      </group>
      {ev.map((v, i) => {
        if (i < sc.n_top) return null;
        const h = Math.max(0.05, v * TOWER_H);
        const x = (i - (n - 1) / 2) * TOWER_GAP;
        return (
          <mesh key={i} position={[x, h / 2, 0]} onPointerOver={(e) => { e.stopPropagation(); onHover({ kind: "tower", i, share: v }); }}
            onPointerOut={() => onHover(null)}>
            <boxGeometry args={[0.5, h, 0.5]} />
            <meshStandardMaterial color={C_REST} transparent opacity={0.55} roughness={0.3} metalness={0.4} />
          </mesh>
        );
      })}
      <Html position={[((sc.n_top - 1) / 2 - (n - 1) / 2) * TOWER_GAP, -0.7, 0.6]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9, color: "#9ff6ff" }}>top {sc.n_top} = {(sc.ar * 100).toFixed(1)}%</div>
      </Html>
      <Html position={[0, -1.3, 0.6]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 8 }}>principal components of {n} coins, largest first · height = share of all variance</div>
      </Html>
    </group>
  );
}

function Moons({ sc, onHover }: { sc: SceneData; onHover: (h: Hover) => void }) {
  const ref = useRef<THREE.Group>(null);
  const n = (sc.eig_share ?? []).length;
  const cx = (0 - (n - 1) / 2) * TOWER_GAP;
  const names = useMemo(() => Object.keys(sc.coins ?? {}).sort(), [sc]);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * 0.15; });
  return (
    <group position={[cx, 0, 0]} ref={ref}>
      {names.map((c, i) => {
        const a = (i / Math.max(1, names.length)) * Math.PI * 2;
        const r = 2.2;
        const d = sc.coins[c];
        const y = Math.max(0.2, d.pc1 * TOWER_H * 1.6);
        const p: [number, number, number] = [Math.cos(a) * r, y, Math.sin(a) * r];
        const size = 0.1 + Math.min(0.25, d.vol_ann * 0.15);
        return (
          <group key={c}>
            <Line points={[[0, y, 0], p]} color="#2f6f86" lineWidth={0.5} transparent opacity={0.4} />
            <mesh position={p} onPointerOver={(e) => { e.stopPropagation(); onHover({ kind: "coin", c, pc1: d.pc1, vol: d.vol_ann, p }); }}
              onPointerOut={() => onHover(null)}>
              <sphereGeometry args={[size, 14, 14]} />
              <meshBasicMaterial color={new THREE.Color("#c9f7ff").multiplyScalar(1.4)} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function ArRibbon({ sc }: { sc: SceneData }) {
  const h = sc.history ?? [];
  const m = h.length;
  const all = h.flatMap((d) => [d.ar, d.s15, d.l365]).filter((v) => Number.isFinite(v));
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const Y0 = 1, YH = 6;
  const y = (v: number) => Y0 + ((v - lo) / Math.max(1e-6, hi - lo)) * YH;
  const x = (i: number) => -RIB_W / 2 + (RIB_W * i) / Math.max(1, m - 1);
  const line = (k: "ar" | "s15" | "l365") =>
    h.map((d, i) => [x(i), y(d[k]), RIB_Z] as [number, number, number]).filter((p) => Number.isFinite(p[1]));
  const runs: { e: number | null; a: number; b: number }[] = [];
  h.forEach((d, i) => {
    const last = runs[runs.length - 1];
    if (last && last.e === d.e) last.b = i; else runs.push({ e: d.e, a: i, b: i });
  });
  return (
    <group>
      {runs.map((r, k) => {
        const w = Math.max(0.06, x(r.b) - x(r.a) + RIB_W / Math.max(1, m - 1));
        return (
          <mesh key={k} position={[(x(r.a) + x(r.b)) / 2, 0.3, RIB_Z]}>
            <boxGeometry args={[w, 0.25, 0.8]} />
            <meshBasicMaterial color={stateColor(r.e).clone().multiplyScalar(1.4)} toneMapped={false} transparent opacity={0.75} />
          </mesh>
        );
      })}
      {m > 1 && <Line points={line("l365")} color="#a77bff" lineWidth={1.6} transparent opacity={0.9} />}
      {m > 1 && <Line points={line("s15")} color="#5cf2ff" lineWidth={2.2} />}
      {m > 1 && <Line points={line("ar")} color="#ffffff" lineWidth={0.8} transparent opacity={0.6} />}
      <Html position={[-RIB_W / 2 - 1.4, y(hi), RIB_Z]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 8 }}>AR {(hi * 100).toFixed(0)}%</div>
      </Html>
      <Html position={[-RIB_W / 2 - 1.4, y(lo), RIB_Z]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 8 }}>AR {(lo * 100).toFixed(0)}%</div>
      </Html>
      <Html position={[0, Y0 + YH + 0.8, RIB_Z]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ fontSize: 9 }}>last {m} days · cyan 15-day AR vs violet 1-year AR · floor: green in, amber half, red cash</div>
      </Html>
    </group>
  );
}

function Tip({ h, sc }: { h: Hover; sc: SceneData }) {
  if (!h) return null;
  const n = (sc.eig_share ?? []).length;
  if (h.kind === "tower") {
    const x = (h.i - (n - 1) / 2) * TOWER_GAP;
    return (
      <Html position={[x, h.share * TOWER_H + 0.3, 0]} style={{ pointerEvents: "none" }}>
        <div className="tooltip" style={{ transform: "translate(14px, -50%)" }}>
          <div className="tooltip__time">component {h.i + 1}</div>
          <div className="tooltip__row"><span>share of all variance</span><b>{(h.share * 100).toFixed(1)}%</b></div>
          <div className="tooltip__row"><span>counted in AR</span><b>{h.i < sc.n_top ? "yes" : "no"}</b></div>
        </div>
      </Html>
    );
  }
  return (
    <Html position={h.p} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: "translate(14px, -50%)" }}>
        <div className="tooltip__time">{h.c}</div>
        <div className="tooltip__row"><span>loading on the shared move</span><b>{h.pc1.toFixed(3)}</b></div>
        <div className="tooltip__row"><span>volatility (EW, annual)</span><b>{(h.vol * 100).toFixed(0)}%</b></div>
      </div>
    </Html>
  );
}

function Title({ sc }: { sc: SceneData }) {
  const e = sc.exposure;
  const state = e === 1 ? "ALL IN" : e === 0 ? "CASH" : e === 0.5 ? "HALF IN" : "WARMING UP";
  const lev = sc.leverage ?? 1;
  const sub = `${(sc.ar * 100).toFixed(1)}% of all coin risk sits in the top ${sc.n_top} components · shift ${sc.shift === null || sc.shift === undefined ? "-" : `${sc.shift >= 0 ? "+" : ""}${sc.shift.toFixed(2)}σ`} vs the past year (cash at +${sc.threshold ?? 1}σ, all in at -${sc.threshold ?? 1}σ) · book ${e === null || e === undefined ? "-" : `${Math.round(e * lev * 100)}% long`} (${lev}x)${sc.asof ? ` · ${sc.asof}` : ""}`;
  return (
    <Html position={[0, 11.2, 0]} center style={{ pointerEvents: "none" }}>
      <div className="scene-title">{(sc.title ?? "Absorption Ratio").toUpperCase()} · <span style={{ color: e === 1 ? "#7dffad" : e === 0 ? "#ff8a8a" : "#ffd47a" }}>{state}</span></div>
      <div className="scene-label scene-label--axis" style={{ textAlign: "center", maxWidth: 600 }}>{sub}</div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 30 * Math.max(1, 1.6 / aspect);
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function SpectrumScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<Hover>(null);
  const [spin, setSpin] = useState(true);
  return (
    <Canvas camera={{ position: [8, 10, 24], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#04070d")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#04070d", 30, 80]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 14, 8]} intensity={1.4} color="#e8f6ff" />
      <pointLight position={[-6, 6, 6]} intensity={30} color="#5cf2ff" />
      <Stars radius={70} depth={30} count={1600} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={90} scale={[28, 10, 20]} size={1.3} speed={0.25} opacity={0.3} color="#9ff6ff" />
      <group position={[0, -3, 2]}>
        <Towers sc={scene} onHover={setHover} />
        <Moons sc={scene} onHover={setHover} />
        <ArRibbon sc={scene} />
        <Title sc={scene} />
        <Tip h={hover} sc={scene} />
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.25}
        minPolarAngle={Math.PI / 7} maxPolarAngle={Math.PI / 2.1} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.0} luminanceThreshold={0.35} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
