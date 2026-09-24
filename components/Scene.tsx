"use client";

import { Grid, Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GAIN, LOSS, signedUsd, usd, when } from "@/lib/format";
import type { Performance } from "@/lib/types";

const SPAN_X = 18; // world units the equity curve spans
const CURVE_HALF_H = 2.2; // world units for the largest |P&L| on the curve
const CURVE_Y = 2.0; // the equity zone floats above...
const PILLAR_Y = -1.75; // ...the per-coin P&L zone, so the two never overlap
const PILLAR_Z = 2.2;
const PILLAR_MAX_H = 1.35;
const FLOOR_Y = -3.6;

const gainColor = new THREE.Color(GAIN);
const lossColor = new THREE.Color(LOSS);
const flatColor = new THREE.Color("#5b6477");

type CurvePoint = { x: number; y: number; ts: number; equity: number; pnl: number };

function useCurve(perf: Performance): { pts: CurvePoint[]; amp: number } {
  return useMemo(() => {
    const raw = perf.curve.length ? perf.curve : [[perf.updated_ms, perf.equity] as [number, number]];
    const start = perf.start_balance;
    const amp = Math.max(1, ...raw.map(([, e]) => Math.abs(e - start)));
    const t0 = raw[0][0];
    const t1 = raw[raw.length - 1][0];
    const dt = Math.max(1, t1 - t0);
    const pts = raw.map(([ts, equity]) => ({
      ts,
      equity,
      pnl: equity - start,
      x: raw.length === 1 ? 0 : -SPAN_X / 2 + ((ts - t0) / dt) * SPAN_X,
      y: ((equity - start) / amp) * CURVE_HALF_H,
    }));
    return { pts, amp };
  }, [perf]);
}

/** Glowing area between the equity curve and the $start baseline. */
function EquityRibbon({ pts }: { pts: CurvePoint[] }) {
  const geometry = useMemo(() => {
    const n = pts.length;
    const g = new THREE.BufferGeometry();
    if (n < 2) return g;
    const pos = new Float32Array(n * 2 * 3);
    const col = new Float32Array(n * 2 * 3);
    const idx: number[] = [];
    pts.forEach((p, i) => {
      const c = p.pnl > 0 ? gainColor : p.pnl < 0 ? lossColor : flatColor;
      pos.set([p.x, p.y, 0], i * 6);
      pos.set([p.x, 0, 0], i * 6 + 3);
      col.set([c.r * 0.9, c.g * 0.9, c.b * 0.9], i * 6);
      col.set([c.r * 0.05, c.g * 0.05, c.b * 0.05], i * 6 + 3);
      if (i < n - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }, [pts]);

  const linePts = useMemo(() => pts.map((p) => new THREE.Vector3(p.x, p.y, 0.01)), [pts]);
  const lineCols = useMemo(
    () =>
      pts.map((p) => {
        const c = (p.pnl > 0 ? gainColor : p.pnl < 0 ? lossColor : flatColor).clone();
        return c.multiplyScalar(1.8); // > 1 so the bloom pass picks the line up
      }),
    [pts],
  );

  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial vertexColors transparent opacity={0.55} side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      {linePts.length >= 2 && (
        <Line points={linePts} vertexColors={lineCols} lineWidth={2.5} toneMapped={false} />
      )}
    </group>
  );
}

function Baseline({ start, amp }: { start: number; amp: number }) {
  const half = SPAN_X / 2 + 0.6;
  return (
    <group>
      <Line points={[[-half, 0, 0], [half, 0, 0]]} color="#8a93a8" lineWidth={1} dashed dashSize={0.25} gapSize={0.18} />
      <Html position={[-half, 0, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ transform: "translateX(-70%)" }}>
          {usd(start, false)} start
        </div>
      </Html>
      <Html position={[half, CURVE_HALF_H, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ transform: "translateX(60%)" }}>
          {signedUsd(amp, false)}
        </div>
      </Html>
      <Html position={[half, -CURVE_HALF_H, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ transform: "translateX(60%)" }}>
          {signedUsd(-amp, false)}
        </div>
      </Html>
    </group>
  );
}

function NowPulse({ p }: { p: CurvePoint }) {
  const ref = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) ref.current.scale.setScalar(1 + Math.sin(t * 3) * 0.15);
    if (ring.current) {
      const k = (t * 0.8) % 1;
      ring.current.scale.setScalar(1 + k * 3);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k);
    }
  });
  const c = (p.pnl > 0 ? gainColor : p.pnl < 0 ? lossColor : flatColor).clone().multiplyScalar(2.2);
  return (
    <group position={[p.x, p.y, 0.02]}>
      <mesh ref={ref}>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshBasicMaterial color={c} toneMapped={false} />
      </mesh>
      <mesh ref={ring}>
        <ringGeometry args={[0.16, 0.2, 48]} />
        <meshBasicMaterial color={c} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

function CurveHover({ pts }: { pts: CurvePoint[] }) {
  const [i, setI] = useState<number | null>(null);
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    // pointer position in the curve's own frame (the scene sways, so world x != curve x)
    const x = e.eventObject.parent ? e.eventObject.parent.worldToLocal(e.point.clone()).x : e.point.x;
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < pts.length; k++) {
      const d = Math.abs(pts[k].x - x);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    setI(best);
  };
  const p = i !== null ? pts[i] : null;
  return (
    <group>
      <mesh position={[0, 0, 0.05]} onPointerMove={onMove} onPointerOut={() => setI(null)}>
        <planeGeometry args={[SPAN_X + 1, CURVE_HALF_H * 2 + 1.4]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {p && (
        <group>
          <Line points={[[p.x, 0, 0.03], [p.x, p.y, 0.03]]} color="#e6e9f2" lineWidth={1} transparent opacity={0.6} />
          <mesh position={[p.x, p.y, 0.04]}>
            <sphereGeometry args={[0.09, 16, 16]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} />
          </mesh>
          <Html position={[p.x, p.y, 0.05]} style={{ pointerEvents: "none" }}>
            <div className="tooltip" style={{ transform: `translate(${p.x > 4 ? "-110%" : "14px"}, -50%)` }}>
              <div className="tooltip__time">{when(p.ts)}</div>
              <div className="tooltip__row"><span>Equity</span><b>{usd(p.equity)}</b></div>
              <div className="tooltip__row">
                <span>P&amp;L</span>
                <b className={`pol pol--${p.pnl > 0 ? "gain" : p.pnl < 0 ? "loss" : "flat"}`}>{signedUsd(p.pnl)}</b>
              </div>
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}

function Pillars({ perf }: { perf: Performance }) {
  const [hover, setHover] = useState<string | null>(null);
  const coins = perf.per_coin;
  const maxAbs = Math.max(1, ...coins.map((c) => Math.abs(c.net)));
  const spread = Math.min(15, coins.length * 2.3);
  const half = spread / 2 + 1.2;
  return (
    <group position={[0, PILLAR_Y, PILLAR_Z]}>
      <Line points={[[-half, 0, 0], [half, 0, 0]]} color="#3a4560" lineWidth={1} />
      <Html position={[-half, 0, 0]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title" style={{ transform: "translateX(-60%)" }}>NET P&amp;L<br />BY COIN</div>
      </Html>
      {coins.map((c, i) => {
        const x = coins.length === 1 ? 0 : -spread / 2 + (i / (coins.length - 1)) * spread;
        const h = Math.max(0.05, (Math.abs(c.net) / maxAbs) * PILLAR_MAX_H);
        const up = c.net >= 0;
        const base = c.net > 0 ? gainColor : c.net < 0 ? lossColor : flatColor;
        const glow = base.clone().multiplyScalar(hover === c.coin ? 2.4 : 1.4);
        return (
          <group key={c.coin} position={[x, 0, 0]}>
            <mesh
              position={[0, up ? h / 2 : -h / 2, 0]}
              onPointerOver={(e) => { e.stopPropagation(); setHover(c.coin); }}
              onPointerOut={() => setHover(null)}
            >
              <boxGeometry args={[0.55, h, 0.55]} />
              <meshStandardMaterial color={base} emissive={glow} emissiveIntensity={0.9}
                transparent opacity={0.85} toneMapped={false} metalness={0.2} roughness={0.35} />
            </mesh>
            <mesh position={[0, up ? h : -h, 0]}>
              <boxGeometry args={[0.6, 0.03, 0.6]} />
              <meshBasicMaterial color={glow.clone().multiplyScalar(1.4)} toneMapped={false} />
            </mesh>
            <Html position={[0, up ? -0.35 : 0.35, 0]} center style={{ pointerEvents: "none" }}>
              <div className="scene-label">
                <span className="scene-label__coin">{c.coin}</span>
                <span className={`pol pol--${c.net > 0 ? "gain" : c.net < 0 ? "loss" : "flat"}`}>
                  {signedUsd(c.net, Math.abs(c.net) < 100)}
                </span>
              </div>
            </Html>
            {hover === c.coin && (
              <Html position={[0, up ? h + 0.4 : -h - 0.4, 0]} center style={{ pointerEvents: "none" }}>
                <div className="tooltip">
                  <div className="tooltip__time">{c.coin} · {c.trades} closed trades · {c.wins} wins</div>
                  <div className="tooltip__row"><span>Realized</span><b>{signedUsd(c.realized)}</b></div>
                  <div className="tooltip__row"><span>Unrealized</span><b>{signedUsd(c.unrealized)}</b></div>
                  <div className="tooltip__row"><span>Fees</span><b>{signedUsd(-c.fees)}</b></div>
                  <div className="tooltip__row"><span>Net</span><b>{signedUsd(c.net)}</b></div>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

/** Pull the camera back on narrow screens so the whole 18-unit curve stays in frame. */
function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 16 * Math.max(1, 1.75 / aspect);
    const dir = camera.position.clone().normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function Sway({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.rotation.y = Math.sin(t * 0.12) * 0.18;
    ref.current.position.y = Math.sin(t * 0.35) * 0.05;
  });
  return <group ref={ref}>{children}</group>;
}

export default function Scene({ perf }: { perf: Performance }) {
  const { pts, amp } = useCurve(perf);
  // ?fx=0 turns off bloom/vignette (debugging, very old GPUs)
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const last = pts[pts.length - 1];
  return (
    <Canvas
      camera={{ position: [0, 2.6, 16], fov: 42 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#070a12")}
    >
      <CameraFit />
      <fog attach="fog" args={["#070a12", 14, 60]} />
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 6, 6]} intensity={40} color="#9fb4ff" />
      <Stars radius={60} depth={30} count={2500} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={80} scale={[22, 8, 10]} size={2} speed={0.25} opacity={0.35} color="#9fb4ff" />
      <Sway>
        <group position={[0, CURVE_Y, 0]}>
          <Baseline start={perf.start_balance} amp={amp} />
          <EquityRibbon pts={pts} />
          {last && <NowPulse p={last} />}
          <CurveHover pts={pts} />
        </group>
        <Pillars perf={perf} />
      </Sway>
      <Grid position={[0, FLOOR_Y, 0]} args={[40, 40]} cellSize={0.6} cellThickness={0.6} cellColor="#1a2336"
        sectionSize={3} sectionThickness={1} sectionColor="#24406b" fadeDistance={30} fadeStrength={1.5} infiniteGrid />
      <OrbitControls target={[0, 0.3, 0]} enablePan={false} enableZoom={false} minPolarAngle={Math.PI / 3.2} maxPolarAngle={Math.PI / 1.9}
        minAzimuthAngle={-Math.PI / 5} maxAzimuthAngle={Math.PI / 5} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.1} luminanceThreshold={0.25} luminanceSmoothing={0.2} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
