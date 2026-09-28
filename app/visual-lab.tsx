"use client";

import { Canvas } from "@react-three/fiber";
import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  Line,
  OrbitControls,
  PerspectiveCamera,
  PointMaterial,
  Points,
} from "@react-three/drei";
import { Box, Braces, Grid3X3, RotateCcw, Upload, Waypoints } from "lucide-react";
import { Suspense, useMemo, useState } from "react";

type Mode = "atlas" | "network" | "scene";

function defaultPoints(count = 1400) {
  const values = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / count);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const radialNoise = 1 + 0.08 * Math.sin(i * 0.73) + 0.045 * Math.cos(i * 1.91);
    values[i * 3] = Math.cos(theta) * Math.sin(phi) * 2.75 * radialNoise;
    values[i * 3 + 1] = Math.cos(phi) * 2.1 * radialNoise;
    values[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * 2.35 * radialNoise;
  }
  return values;
}

function networkNodes() {
  return Array.from({ length: 28 }, (_, i) => {
    const angle = i * 2.3999632297;
    const r = 1.2 + (i % 7) * 0.32;
    return [
      Math.cos(angle) * r,
      ((i % 9) - 4) * 0.38,
      Math.sin(angle) * r,
    ] as [number, number, number];
  });
}

function Atlas({ positions }: { positions: Float32Array }) {
  return (
    <>
      <Points positions={positions} stride={3} frustumCulled>
        <PointMaterial
          transparent
          color="#8ed7ff"
          size={0.028}
          sizeAttenuation
          depthWrite={false}
          opacity={0.82}
        />
      </Points>
      <mesh scale={[2.82, 2.14, 2.42]}>
        <icosahedronGeometry args={[1, 4]} />
        <meshBasicMaterial color="#29445a" wireframe transparent opacity={0.16} />
      </mesh>
    </>
  );
}

function Network() {
  const nodes = useMemo(() => networkNodes(), []);
  return (
    <>
      {nodes.map((node, index) => (
        <mesh key={index} position={node}>
          <sphereGeometry args={[index % 5 === 0 ? 0.09 : 0.055, 14, 14]} />
          <meshStandardMaterial
            color={index % 5 === 0 ? "#b8e4ff" : "#6488a2"}
            emissive={index % 5 === 0 ? "#4aa8df" : "#203a4a"}
            emissiveIntensity={index % 5 === 0 ? 1.4 : 0.45}
          />
        </mesh>
      ))}
      {nodes.map((node, index) => {
        const target = nodes[(index * 7 + 5) % nodes.length];
        return (
          <Line
            key={`line-${index}`}
            points={[node, target]}
            color="#47758f"
            transparent
            opacity={0.22}
            lineWidth={0.65}
          />
        );
      })}
    </>
  );
}

function ScenePrimitives() {
  return (
    <>
      <mesh position={[-1.7, 0.55, -0.5]}>
        <boxGeometry args={[1.6, 1.1, 1.2]} />
        <meshStandardMaterial color="#172532" metalness={0.25} roughness={0.72} />
      </mesh>
      <mesh position={[1.2, 0.7, 0.4]}>
        <sphereGeometry args={[0.82, 40, 40]} />
        <meshStandardMaterial color="#34536a" metalness={0.2} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.35, -2]}>
        <torusKnotGeometry args={[0.72, 0.16, 110, 14]} />
        <meshStandardMaterial color="#7dc8ef" emissive="#17384c" emissiveIntensity={0.7} />
      </mesh>
    </>
  );
}

function Scene({
  mode,
  positions,
  showGrid,
}: {
  mode: Mode;
  positions: Float32Array;
  showGrid: boolean;
}) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[6.7, 4.4, 7.4]} fov={43} />
      <ambientLight intensity={0.42} />
      <directionalLight position={[7, 9, 5]} intensity={1.2} />
      <pointLight position={[-5, 2, -3]} intensity={0.8} color="#4ca6d7" />

      <Suspense fallback={null}>
        {mode === "atlas" ? <Atlas positions={positions} /> : null}
        {mode === "network" ? <Network /> : null}
        {mode === "scene" ? <ScenePrimitives /> : null}
        {showGrid ? (
          <Grid
            args={[50, 50]}
            position={[0, -2.7, 0]}
            cellSize={0.5}
            cellThickness={0.45}
            cellColor="#14222d"
            sectionSize={5}
            sectionThickness={0.9}
            sectionColor="#29404f"
            fadeDistance={35}
            fadeStrength={1}
            infiniteGrid
          />
        ) : null}
      </Suspense>

      <OrbitControls makeDefault enableDamping dampingFactor={0.07} minDistance={2.5} maxDistance={24} />
      <GizmoHelper alignment="bottom-right" margin={[76, 76]}>
        <GizmoViewport axisColors={["#ef8c8c", "#86d19b", "#76a9ef"]} labelColor="#d8e0e8" />
      </GizmoHelper>
    </>
  );
}

export default function VisualLab() {
  const [mode, setMode] = useState<Mode>("atlas");
  const [showGrid, setShowGrid] = useState(true);
  const [imported, setImported] = useState<Float32Array | null>(null);
  const [sceneKey, setSceneKey] = useState(0);
  const generated = useMemo(() => defaultPoints(), []);
  const positions = imported ?? generated;

  const importPoints = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const candidate =
        Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === "object" && "points" in parsed
            ? (parsed as { points: unknown }).points
            : null;

      if (!Array.isArray(candidate)) return;
      const flattened: number[] = [];
      for (const point of candidate.slice(0, 50000)) {
        if (Array.isArray(point) && point.length >= 3) {
          const x = Number(point[0]);
          const y = Number(point[1]);
          const z = Number(point[2]);
          if ([x, y, z].every(Number.isFinite)) flattened.push(x, y, z);
        }
      }
      if (flattened.length >= 3) {
        setImported(new Float32Array(flattened));
        setMode("atlas");
      }
    } catch {}
  };

  return (
    <div className="visual-workspace">
      <aside className="visual-tools">
        <div>
          <div className="text-[10px] uppercase tracking-[.2em] text-slate-600">3D Space</div>
          <div className="mt-1 text-sm font-medium text-slate-200">Spatial reconstruction lab</div>
        </div>

        <div className="mt-6 space-y-2">
          {[
            { id: "atlas" as const, label: "Neural atlas", icon: Waypoints },
            { id: "network" as const, label: "Network graph", icon: Braces },
            { id: "scene" as const, label: "Scene primitives", icon: Box },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`visual-tool-button ${mode === id ? "visual-tool-active" : ""}`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        <div className="mt-6 border-t border-white/[.06] pt-5">
          <div className="mb-2 text-[10px] uppercase tracking-[.16em] text-slate-650">Scene</div>
          <button onClick={() => setShowGrid((value) => !value)} className="visual-tool-button">
            <Grid3X3 size={14} /> {showGrid ? "Hide grid" : "Show grid"}
          </button>
          <button onClick={() => setSceneKey((value) => value + 1)} className="visual-tool-button">
            <RotateCcw size={14} /> Reset camera
          </button>
          <label className="visual-tool-button cursor-pointer">
            <Upload size={14} /> Import point JSON
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => void importPoints(event.target.files?.[0])}
            />
          </label>
        </div>

        <div className="mt-auto rounded-xl border border-white/[.06] bg-black/20 p-3">
          <div className="text-[10px] uppercase tracking-[.15em] text-slate-650">Geometry</div>
          <div className="mt-2 font-mono text-xs text-slate-300">{Math.floor(positions.length / 3).toLocaleString()} points</div>
          <p className="mt-2 text-[10px] leading-4 text-slate-650">
            Import JSON as an array of [x, y, z] points or an object containing a points array.
          </p>
        </div>
      </aside>

      <div className="relative min-h-[720px] flex-1 overflow-hidden bg-[#03070b]">
        <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border border-white/[.06] bg-black/40 px-3 py-2 backdrop-blur">
          <div className="text-[9px] uppercase tracking-[.18em] text-slate-600">Viewport</div>
          <div className="mt-1 text-xs text-slate-300">{mode === "atlas" ? "Latent / point field" : mode === "network" ? "Graph topology" : "Scene workspace"}</div>
        </div>
        <Canvas
          key={sceneKey}
          dpr={[1, 1.75]}
          gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true }}
          onCreated={({ gl }) => gl.setClearColor("#03070b")}
        >
          <Scene mode={mode} positions={positions} showGrid={showGrid} />
        </Canvas>
      </div>
    </div>
  );
}
