"use client";

import { Html, Line, OrbitControls, Sparkles, Stars, Trail } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { RiderScene as SceneData } from "@/lib/types";

// Strategy 10 "Coin Rider": one lane per coin (x), time running toward the viewer (z), bar height = the
// coin's 7-day risk-adjusted momentum. A gold rider orb travels the path of the coin actually held, leaving a
// ribbon; it hops lanes when a ride ends and a new coin is picked. Front row = live scores (held one glows).

const X_SPAN = 16;
const Z_SPAN = 12;
const Y_PER = 0.45;
const Y_MIN = -4;
const Y_MAX = 7;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const C_NEG = new THREE.Color("#d96b25");
const C_ZERO = new THREE.Color("#18203a");
const C_POS = new THREE.Color("#35f0c0");
const C_HELD = new THREE.Color("#ffc94d");
const CHAIN_COLOR: Record<string, string> = { solana: "#b38cff", base: "#4d8dff", robinhood: "#7dff6b" };

function scoreColor(v: number): THREE.Color {
  return v < 0 ? C_ZERO.clone().lerp(C_NEG, clamp(-v / 3, 0, 1)) : C_ZERO.clone().lerp(C_POS, clamp(v / 4, 0, 1));
}

function useLayout(sc: SceneData) {
  return useMemo(() => {
    const nx = sc.x.length;
    const nz = sc.z.length;
    const dx = X_SPAN / Math.max(1, nx);
    const dz = Z_SPAN / Math.max(1, nz + 3);
    const xAt = (i: number) => -X_SPAN / 2 + dx * (i + 0.5);
    const zAt = (j: number) => -Z_SPAN / 2 + dz * (j + 0.5);
    const hAt = (v: number | null | undefined) => (typeof v === "number" ? clamp(v, Y_MIN, Y_MAX) * Y_PER : 0);
    const cells: { i: number; j: number; v: number; held: boolean }[] = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const v = sc.y[j]?.[i];
        if (v === null || v === undefined) continue;
        cells.push({ i, j, v, held: sc.path[j] === sc.x[i] });
      }
    }
    // rider path: one point per step on top of the held coin's bar (cash = hovering at mid-board, low)
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j < nz; j++) {
      const coin = sc.path[j];
      const i = coin ? sc.x.indexOf(coin) : -1;
      if (i >= 0) pts.push(new THREE.Vector3(xAt(i), Math.max(0, hAt(sc.y[j]?.[i])) + 0.35, zAt(j)));
      else pts.push(new THREE.Vector3(pts.length ? pts[pts.length - 1].x : 0, 0.15, zAt(j)));
    }
    return { cells, dx, dz, xAt, zAt, hAt, pts, liveZ: zAt(nz + 1.2), nz };
  }, [sc]);
}

function Bars({ sc, onHover }: { sc: SceneData; onHover: (k: number | null) => void }) {
  const { cells, dx, dz, xAt, zAt } = useLayout(sc);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    cells.forEach((c, k) => {
      const h = Math.max(0.02, Math.abs(clamp(c.v, Y_MIN, Y_MAX)) * Y_PER);
      o.position.set(xAt(c.i), c.v >= 0 ? h / 2 : -h / 2, zAt(c.j));
      o.scale.set(dx * 0.62, h, dz * 0.8);
      o.updateMatrix();
      m.setMatrixAt(k, o.matrix);
      m.setColorAt(k, c.held ? scoreColor(c.v).lerp(C_HELD, 0.75).multiplyScalar(2.0) : scoreColor(c.v));
    });
    m.count = cells.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [cells, dx, dz, xAt, zAt]);
  return (
    <instancedMesh key={cells.length} ref={ref} args={[undefined, undefined, Math.max(1, cells.length)]}
      onPointerMove={(e) => { e.stopPropagation(); onHover(e.instanceId ?? null); }} onPointerOut={() => onHover(null)}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.4} metalness={0.25} toneMapped={false} />
    </instancedMesh>
  );
}

function Rider({ sc }: { sc: SceneData }) {
  const { pts } = useLayout(sc);
  const orb = useRef<THREE.Mesh>(null);
  const [label, setLabel] = useState<string | null>(null);
  const curve = useMemo(() => (pts.length > 1 ? new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.2) : null), [pts]);
  const ribbon = useMemo(() => (curve ? curve.getPoints(Math.min(1200, pts.length * 8)) : pts), [curve, pts]);
  const last = useRef(-1);
  useFrame(({ clock }) => {
    if (!orb.current || !curve) return;
    const dur = 18; // seconds per pass over the 30-day window
    const u = (clock.getElapsedTime() % (dur + 2)) / dur;
    const t = Math.min(1, u);
    orb.current.position.copy(curve.getPoint(t));
    const s = 1 + 0.25 * Math.sin(clock.getElapsedTime() * 6);
    orb.current.scale.setScalar(s);
    const j = Math.min(sc.path.length - 1, Math.floor(t * (sc.path.length - 1) + 0.5));
    if (j !== last.current) {
      last.current = j;
      setLabel(sc.path[j] ?? "cash");
    }
  });
  if (!curve) return null;
  return (
    <group>
      <Line points={ribbon} color="#ffc94d" lineWidth={2.2} transparent opacity={0.85} toneMapped={false} />
      <Trail width={1.4} length={6} color={new THREE.Color("#ffdd88")} attenuation={(w) => w * w}>
        <mesh ref={orb}>
          <sphereGeometry args={[0.22, 24, 24]} />
          <meshBasicMaterial color={new THREE.Color("#ffd36b").multiplyScalar(3)} toneMapped={false} />
          {label && (
            <Html position={[0, 0.55, 0]} center style={{ pointerEvents: "none" }}>
              <div className="scene-label scene-label--held"><span className="scene-label__coin">{label}</span></div>
            </Html>
          )}
        </mesh>
      </Trail>
    </group>
  );
}

function Live({ sc }: { sc: SceneData }) {
  const { xAt, liveZ, dx, hAt } = useLayout(sc);
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    g.current?.children.forEach((c, k) => { c.scale.x = c.scale.z = 1 + 0.15 * Math.sin(clock.getElapsedTime() * 2.4 + k); });
  });
  if (!sc.live) return null;
  const ride = sc.live_ride;
  return (
    <group ref={g}>
      {sc.x.map((coin, i) => {
        const l = sc.live?.[coin];
        const v = l ? l[sc.live_key ?? "score"] : undefined;
        if (!l || typeof v !== "number") return null;
        const h = Math.max(0.03, Math.abs(hAt(v)));
        const col = l.held ? C_HELD.clone().multiplyScalar(2.4) : scoreColor(v).multiplyScalar(1.4);
        return (
          <group key={coin} position={[xAt(i), 0, liveZ]}>
            <mesh position={[0, v >= 0 ? h / 2 : -h / 2, 0]}>
              <cylinderGeometry args={[dx * 0.22, dx * 0.22, h, 14]} />
              <meshBasicMaterial color={col} toneMapped={false} transparent opacity={l.held ? 0.95 : 0.5} />
            </mesh>
            {l.held && (
              <Html position={[0, Math.max(0, hAt(v)) + 0.5, 0]} center style={{ pointerEvents: "none" }}>
                <div className="scene-label scene-label--held">
                  <span className="scene-label__coin">RIDING {coin}</span>
                  {ride?.stop ? <span>stop {ride.stop.toPrecision(4)}</span> : null}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

function Axes({ sc }: { sc: SceneData }) {
  const { xAt, zAt, nz, liveZ } = useLayout(sc);
  const ticks = useMemo(() => {
    const out: { j: number; label: string }[] = [];
    const step = Math.max(1, Math.round(nz / 6));
    for (let j = 0; j < nz; j += step) out.push({ j, label: sc.z[j]?.slice(5, 10) ?? "" });
    return out;
  }, [sc.z, nz]);
  const x0 = -X_SPAN / 2 - 0.3;
  return (
    <group>
      {sc.x.map((c, i) => (
        <Html key={c} position={[xAt(i), -0.3, liveZ + 0.8]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis scene-label--tilt"
            style={{ color: CHAIN_COLOR[sc.chain?.[c] ?? ""] ?? undefined }}>{c}</div>
        </Html>
      ))}
      {ticks.map((t) => (
        <Html key={t.j} position={[x0 - 0.2, 0, zAt(t.j)]} center style={{ pointerEvents: "none" }}>
          <div className="scene-label scene-label--axis">{t.label}</div>
        </Html>
      ))}
      <Html position={[x0 - 0.6, 0.2, liveZ]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title">NOW →</div>
      </Html>
      <Html position={[0, Y_MAX * Y_PER * 0.9, -Z_SPAN / 2 - 1.2]} center style={{ pointerEvents: "none" }}>
        <div className="scene-title">{(sc.title ?? "").toUpperCase()}</div>
        <div className="scene-label scene-label--axis" style={{ textAlign: "center" }}>
          <span style={{ color: CHAIN_COLOR.solana }}>SOLANA</span> · <span style={{ color: CHAIN_COLOR.base }}>BASE</span> ·{" "}
          <span style={{ color: CHAIN_COLOR.robinhood }}>ROBINHOOD CHAIN</span> · gold = the coin being ridden
        </div>
      </Html>
      <Line points={[[x0, 0, -Z_SPAN / 2], [x0, 0, liveZ + 0.3]]} color="#2b3658" lineWidth={1} />
    </group>
  );
}

function Tooltip({ sc, k }: { sc: SceneData; k: number }) {
  const { cells, xAt, zAt } = useLayout(sc);
  const c = cells[k];
  if (!c) return null;
  const x = xAt(c.i);
  return (
    <Html position={[x, Math.max(0, c.v) * Y_PER + 0.25, zAt(c.j)]} style={{ pointerEvents: "none" }}>
      <div className="tooltip" style={{ transform: `translate(${x > 3 ? "-110%" : "14px"}, -50%)` }}>
        <div className="tooltip__time">{sc.x[c.i]} · {sc.z[c.j]?.replace("T", " ")}:00 UTC</div>
        <div className="tooltip__row"><span>{sc.y_label ?? "score"}</span><b>{c.v.toFixed(2)}</b></div>
        <div className="tooltip__row"><span>dev score</span><b>{sc.dev_score?.[sc.x[c.i]] ?? "-"}/3</b></div>
        <div className="tooltip__row"><span>held</span><b>{c.held ? "yes" : "no"}</b></div>
      </div>
    </Html>
  );
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = 21 * Math.max(1, 1.7 / aspect);
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(dist));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function RiderScene({ scene, active = true }: { scene: SceneData; active?: boolean }) {
  const fx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";
  const [hover, setHover] = useState<number | null>(null);
  const [spin, setSpin] = useState(true);
  return (
    <Canvas camera={{ position: [9, 9, 15], fov: 40 }} dpr={[1, 2]} frameloop={active ? "always" : "never"}
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#05070c")}
      onPointerDown={() => setSpin(false)}>
      <CameraFit />
      <fog attach="fog" args={["#05070c", 20, 60]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 12, 8]} intensity={1.6} color="#fff6e0" />
      <pointLight position={[-8, 4, 6]} intensity={30} color="#b38cff" />
      <pointLight position={[8, 4, -6]} intensity={24} color="#4d8dff" />
      <Stars radius={60} depth={30} count={1800} factor={3} saturation={0} fade speed={0.4} />
      <Sparkles count={110} scale={[20, 6, 14]} size={1.6} speed={0.35} opacity={0.35} color="#ffc94d" />
      <group position={[0, -1.0, 0]}>
        <Bars sc={scene} onHover={setHover} />
        <Rider sc={scene} />
        <Live sc={scene} />
        <Axes sc={scene} />
        {hover !== null && <Tooltip sc={scene} k={hover} />}
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={0.3}
        minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.1} rotateSpeed={0.5} />
      {fx && (
        <EffectComposer>
          <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.35} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
