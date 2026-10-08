"use client";

import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { CountdownEvent, CountdownScene as SceneData } from "@/lib/types";

// Strategy 17 "Unlock Front-Run": one lane per coin (x). Along each lane (z) runs a 37-day countdown, from 30 days
// before a token unlock to 6 days after; the glowing wall is unlock day. Every past unlock is a thin thread (the
// coin's move minus Bitcoin, cumulative from T-30): teal threads fell in the final week (the short won), orange
// ones rose. The bright line is the lane's average. The red zone is the 7 days the book is short. Rings at the
// wall mark the next unlocks (gold = shorted right now).

const X_SPAN = 14;
const Z_SPAN = 13;
const K0 = -30;
const K1 = 6;
const Y_PER = 0.06;   // world units per %
const Y_LIM = 45;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const C_LANE = new THREE.Color("#2a6fb0");
const C_WIN = new THREE.Color("#35f0c0");
const C_LOSS = new THREE.Color("#ff8a3d");
const C_AVG = new THREE.Color("#b8e8ff");
const C_WALL = new THREE.Color("#ff3d6e");
const C_GOLD = new THREE.Color("#ffc94d");

function useLayout(sc: SceneData) {
  return useMemo(() => {
    const nx = sc.x.length;
    const dx = X_SPAN / Math.max(1, nx);
    const xAt = (i: number) => -X_SPAN / 2 + dx * (i + 0.5);
    const zAt = (k: number) => -Z_SPAN / 2 + ((k - K0) / (K1 - K0)) * Z_SPAN;
    const yAt = (v: number) => clamp(v, -Y_LIM, Y_LIM) * Y_PER;
    return { dx, xAt, zAt, yAt, wallZ: zAt(0) };
  }, [sc]);
}

function threadPoints(ev: CountdownEvent, xAt: (i: number) => number, zAt: (k: number) => number, yAt: (v: number) => number) {
  return ev.path.map((v, n) => [xAt(ev.i), yAt(v), zAt(K0 + n)] as [number, number, number]);
}

function Threads({ sc, onHover }: { sc: SceneData; onHover: (e: CountdownEvent | null) => void }) {
  const { xAt, zAt, yAt } = useLayout(sc);
  return (
    <group>
      {sc.events.filter((e) => e.path.length > 1).map((ev, k) => {
        const won = ev.pre7_pct !== null && ev.pre7_pct < 0;
        const col = (ev.pre7_pct === null ? C_LANE : won ? C_WIN : C_LOSS).clone().multiplyScalar(1.2);
        const pts = threadPoints(ev, xAt, zAt, yAt);
        const end = pts[pts.length - 1];
        return (
          <group key={k}>
            <Line points={pts} color={col} lineWidth={0.8} transparent opacity={0.28} />
            <mesh position={end} onPointerOver={(e) => { e.stopPropagation(); onHover(ev); }} onPointerOut={() => onHover(null)}>
              <sphereGeometry args={[0.06, 8, 8]} />
              <meshBasicMaterial color={col} transparent opacity={0.7} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Averages({ sc }: { sc: SceneData }) {
  const { xAt, zAt, yAt } = useLayout(sc);
  const lines = useMemo(() => sc.x.map((_, i) => {
    const evs = sc.events.filter((e) => e.i === i && e.path.length >= 37);
    if (evs.length < 3) return null;
    const n = 37;
    const pts: [number, number, number][] = [];
    for (let j = 0; j < n; j++) {
      const m = evs.reduce((a, e) => a + e.path[j], 0) / evs.length;
      pts.push([xAt(i), yAt(m), zAt(K0 + j)]);
    }
    return pts;
  }), [sc, xAt, zAt, yAt]);
  return (
    <group>
      {lines.map((pts, i) => pts ? (
        <Line key={i} points={pts} color={C_AVG.clone().multiplyScalar(2.2)} lineWidth={3} toneMapped={false} />
      ) : null)}
    </group>
  );
}

function Wall({ sc }: { sc: SceneData }) {
  const { wallZ, zAt } = useLayout(sc);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.14 + 0.06 * Math.sin(clock.getElapsedTime() * 2.0);
  });
  const z0 = zAt(-sc.pre_days);
  const h = 2 * Y_LIM * Y_PER;
  return (
    <group>
      <mesh position={[0, 0, wallZ]}>
        <planeGeometry args={[X_SPAN + 0.6, h]} />
        <meshBasicMaterial ref={mat} color={C_WALL} transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, -Y_LIM * Y_PER, (z0 + wallZ) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[X_SPAN + 0.6, wallZ - z0]} />
        <meshBasicMaterial color={C_WALL} transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0, (zAt(K0) + zAt(K1)) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[X_SPAN + 0.6, Z_SPAN]} />
        <meshBasicMaterial color="#1b2a44" transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Html position={[X_SPAN / 2 + 0.6, Y_LIM * Y_PER * 0.8, wallZ]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ color: "#ff3d6e" }}>UNLOCK DAY</div>
      </Html>
      <Html position={[X_SPAN / 2 + 0.6, -Y_LIM * Y_PER, (z0 + wallZ) / 2]} style={{ pointerEvents: "none" }}>
        <div className="scene-label scene-label--axis" style={{ color: "#ff3d6e" }}>short {sc.pre_days} days</div>
      </Html>
    </group>
  );
}

function Rings({ sc }: { sc: SceneData }) {
  const { xAt, wallZ } = useLayout(sc);
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    g.current?.children.forEach((c, k) => { c.rotation.y = clock.getElapsedTime() * 0.8 + k; });
  });
  const next = useMemo(() => {
    const seen = new Set<string>();
    return (sc.upcoming ?? []).filter((u) => (seen.has(u.coin) ? false : (seen.add(u.coin), true)));
  }, [sc.upcoming]);
  return (
    <group ref={g}>
      {next.map((u) => {
        const i = sc.x.indexOf(u.coin);
        if (i < 0) return null;
        const live = !!sc.live_short?.[u.coin];
        const col = (live ? C_GOLD : C_AVG).clone().multiplyScalar(live ? 2.6 : 1.2);
        const y = Y_LIM * Y_PER + 0.4;
        return (
          <group key={u.coin} position={[xAt(i), y, wallZ]}>
            <mesh>
              <torusGeometry args={[0.32, 0.05, 12, 40]} />
              <meshBasicMaterial color={col} toneMapped={false} />
            </mesh>
            <Html position={[0, 0.6, 0]} center style={{ pointerEvents: "none" }}>
              <div className={live ? "scene-label scene-label--held" : "scene-label scene-label--axis"}>
                <span className="scene-label__coin">{u.coin}</span>
                <span>{typeof u.days_to === "number" ? `${u.days_to}d` : u.date.slice(5)}{live ? " · SHORT" : ""}</span>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function Axes({ sc }: { sc: SceneData }) {
  const { xAt, zAt } = useLayout(sc);
  const x0 = -X_SPAN / 2 - 0.4;
  const sub = [
    typeof sc.avg_pre7_pct === "number" ? `avg move vs BTC in the last ${sc.pre_days} days: ${sc.avg_pre7_pct > 0 ? "+" : ""}${sc.avg_pre7_pct}%` : null,
    typeof sc.hit_rate_pct === "number" ? `${sc.hit_rate_pct}% of unlocks fell` : null,
    typeof sc.live_btc_hedge === "number" && sc.live_btc_hedge > 0 ? `BTC hedge ${sc.live_btc_hedge.toFixed(2)}x` : null,
  ].filter(Boolean).join(" · ");
  return (
    <group>
      {sc.x.map((c, i) => (
        <Html key={c} position={[xAt(i), -Y_LIM * Y_PER - 0.3, zAt(K1) + 0.7]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis scene-label--tilt">{c}</div>
        </Html>
      ))}
      {[-30, -21, -14, -7, 0, 6].map((k) => (
        <Html key={k} position={[x0, -Y_LIM * Y_PER, zAt(k)]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis">{k === 0 ? "T" : `T${k > 0 ? "+" : ""}${k}`}</div>
        </Html>
      ))}
      {[-30, 0, 30].map((v) => (
        <Html key={v} position={[x0 - 0.3, v * Y_PER, zAt(K0)]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis">{v > 0 ? "+" : ""}{v}%</div>
        </Html>
      ))}
      <Html position={[0, Y_LIM * Y_PER + 1.6, zAt(K0) - 0.6]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title">{(sc.title ?? "").toUpperCase()}</div>
        {sub && <div className="scene-label scene-label--axis" style={{ textAlign: "center" }}>{sub}</div>}
      </Html>
      <Line points={[[x0, 0, zAt(K0)], [x0, 0, zAt(K1)]]} color="#2b3658" lineWidth={1} />
    </group>
  );
}

function Tooltip({ sc, ev }: { sc: SceneData; ev: CountdownEvent }) {
  const { xAt, zAt, yAt } = useLayout(sc);
  const x = xAt(ev.i);
  const last = ev.path[ev.path.length - 1] ?? 0;
  return (
    <Html position={[x, yAt(last) + 0.3, zAt(K0 + ev.path.length - 1)]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${x > 3 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">{sc.x[ev.i]} unlock · {ev.date}</div>
        <div className="tooltip__row"><span>last {sc.pre_days} days vs BTC</span>
          <b>{ev.pre7_pct === null ? "pending" : `${ev.pre7_pct > 0 ? "+" : ""}${ev.pre7_pct}%`}</b></div>
        <div className="tooltip__row"><span>T-30 → T{ev.path.length - 31 >= 0 ? "+" : ""}{ev.path.length - 31}</span>
          <b>{last > 0 ? "+" : ""}{last.toFixed(1)}%</b></div>
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

export default function CountdownScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<CountdownEvent | null>(null);
  const [spin, setSpin] = useState(true);
  return (
    <Canvas camera={{ position: [11, 7, 13], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05060d")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#05060d", 20, 60]} />
      <ambientLight intensity={0.45} />
      <pointLight position={[0, 5, 2]} intensity={30} color="#ff3d6e" />
      <Stars radius={60} depth={30} count={1600} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={90} scale={[18, 6, 14]} size={1.5} speed={0.3} opacity={0.3} color="#ff8fb0" />
      <group position={[0, -0.6, 0]}>
        <Wall sc={scene} />
        <Threads sc={scene} onHover={setHover} />
        <Averages sc={scene} />
        <Rings sc={scene} />
        <Axes sc={scene} />
        {hover && <Tooltip sc={scene} ev={hover} />}
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.3}
        minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.1} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.0} luminanceThreshold={0.35} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
