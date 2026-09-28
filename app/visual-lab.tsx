"use client";

import { Canvas, useFrame } from "@react-three/fiber";
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
import {
  Box,
  Braces,
  Cpu,
  Grid3X3,
  Layers3,
  MonitorUp,
  RotateCcw,
  Upload,
  Waypoints,
} from "lucide-react";
import * as THREE from "three";
import * as niftiModule from "nifti-reader-js";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { generateVolumePhantom } from "@/lib/simulations";

type Mode = "volume" | "atlas" | "network" | "scene";

type NiftiHeader = {
  dims: number[];
  datatypeCode: number;
};

type NiftiReaderApi = {
  isCompressed: (data: ArrayBuffer) => boolean;
  decompress: (data: ArrayBuffer) => ArrayBuffer;
  isNIFTI: (data: ArrayBuffer) => boolean;
  readHeader: (data: ArrayBuffer) => NiftiHeader;
  readImage: (header: NiftiHeader, data: ArrayBuffer) => ArrayBuffer;
};

const niftiReader = niftiModule as unknown as NiftiReaderApi;

type VolumeData = {
  name: string;
  dims: [number, number, number];
  voxels: Uint8Array;
  source: "synthetic" | "nifti";
};

function defaultPoints(count = 2800) {
  const values = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / count);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const radialNoise =
      1 + 0.08 * Math.sin(i * 0.73) + 0.045 * Math.cos(i * 1.91);
    values[i * 3] =
      Math.cos(theta) * Math.sin(phi) * 2.75 * radialNoise;
    values[i * 3 + 1] = Math.cos(phi) * 2.1 * radialNoise;
    values[i * 3 + 2] =
      Math.sin(theta) * Math.sin(phi) * 2.35 * radialNoise;
  }
  return values;
}

function networkNodes() {
  return Array.from({ length: 72 }, (_, i) => {
    const angle = i * 2.3999632297;
    const r = 1.1 + (i % 11) * 0.19;
    return [
      Math.cos(angle) * r,
      ((i % 13) - 6) * 0.23,
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
          size={0.022}
          sizeAttenuation
          depthWrite={false}
          opacity={0.82}
        />
      </Points>
      <mesh scale={[2.82, 2.14, 2.42]}>
        <icosahedronGeometry args={[1, 5]} />
        <meshBasicMaterial
          color="#29445a"
          wireframe
          transparent
          opacity={0.12}
        />
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
          <sphereGeometry args={[index % 7 === 0 ? 0.075 : 0.035, 12, 12]} />
          <meshStandardMaterial
            color={index % 7 === 0 ? "#b8e4ff" : "#6488a2"}
            emissive={index % 7 === 0 ? "#4aa8df" : "#203a4a"}
            emissiveIntensity={index % 7 === 0 ? 1.4 : 0.45}
          />
        </mesh>
      ))}
      {nodes.map((node, index) => {
        const targets = [
          nodes[(index * 7 + 5) % nodes.length],
          nodes[(index * 11 + 17) % nodes.length],
        ];
        return targets.map((target, targetIndex) => (
          <Line
            key={`line-${index}-${targetIndex}`}
            points={[node, target]}
            color="#47758f"
            transparent
            opacity={0.16}
            lineWidth={0.55}
          />
        ));
      })}
    </>
  );
}

function ScenePrimitives() {
  return (
    <>
      <mesh position={[-1.7, 0.55, -0.5]}>
        <boxGeometry args={[1.6, 1.1, 1.2]} />
        <meshStandardMaterial
          color="#172532"
          metalness={0.25}
          roughness={0.72}
        />
      </mesh>
      <mesh position={[1.2, 0.7, 0.4]}>
        <sphereGeometry args={[0.82, 48, 48]} />
        <meshStandardMaterial
          color="#34536a"
          metalness={0.2}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[0, 0.35, -2]}>
        <torusKnotGeometry args={[0.72, 0.16, 160, 18]} />
        <meshStandardMaterial
          color="#7dc8ef"
          emissive="#17384c"
          emissiveIntensity={0.7}
        />
      </mesh>
    </>
  );
}

const volumeVertexShader = `
  out vec3 vObjectPosition;
  void main() {
    vObjectPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const volumeFragmentShader = `
  precision highp float;
  precision highp sampler3D;

  uniform sampler3D uVolume;
  uniform vec3 uCameraLocal;
  uniform float uThreshold;
  uniform float uDensity;
  uniform float uBrightness;

  in vec3 vObjectPosition;
  out vec4 outColor;

  bool insideBox(vec3 p) {
    return all(lessThanEqual(abs(p), vec3(0.501)));
  }

  vec3 transfer(float value) {
    vec3 low = vec3(0.06, 0.18, 0.28);
    vec3 mid = vec3(0.30, 0.62, 0.78);
    vec3 high = vec3(0.88, 0.96, 1.0);
    return value < 0.62
      ? mix(low, mid, smoothstep(uThreshold, 0.62, value))
      : mix(mid, high, smoothstep(0.62, 1.0, value));
  }

  void main() {
    vec3 direction = normalize(vObjectPosition - uCameraLocal);
    vec3 p = vObjectPosition + direction * 0.003;
    vec4 accum = vec4(0.0);

    for (int i = 0; i < 220; i++) {
      if (!insideBox(p)) break;

      float value = texture(uVolume, p + vec3(0.5)).r;
      float opacity = smoothstep(uThreshold, min(1.0, uThreshold + 0.26), value);
      opacity *= 0.022 * uDensity;

      vec3 color = transfer(value) * uBrightness;
      accum.rgb += (1.0 - accum.a) * color * opacity;
      accum.a += (1.0 - accum.a) * opacity;

      if (accum.a > 0.965) break;
      p += direction * 0.0065;
    }

    if (accum.a < 0.008) discard;
    outColor = accum;
  }
`;

function VolumeRaycast({
  volume,
  threshold,
  density,
  brightness,
}: {
  volume: VolumeData;
  threshold: number;
  density: number;
  brightness: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const cameraLocal = useRef(new THREE.Vector3());

  const texture = useMemo(() => {
    const [x, y, z] = volume.dims;
    const dataTexture = new THREE.Data3DTexture(volume.voxels, x, y, z);
    dataTexture.format = THREE.RedFormat;
    dataTexture.type = THREE.UnsignedByteType;
    dataTexture.minFilter = THREE.LinearFilter;
    dataTexture.magFilter = THREE.LinearFilter;
    dataTexture.wrapS = THREE.ClampToEdgeWrapping;
    dataTexture.wrapT = THREE.ClampToEdgeWrapping;
    dataTexture.wrapR = THREE.ClampToEdgeWrapping;
    dataTexture.unpackAlignment = 1;
    dataTexture.needsUpdate = true;
    return dataTexture;
  }, [volume]);

  const uniforms = useMemo(
    () => ({
      uVolume: { value: texture },
      uCameraLocal: { value: new THREE.Vector3(0, 0, 5) },
      uThreshold: { value: threshold },
      uDensity: { value: density },
      uBrightness: { value: brightness },
    }),
    [texture],
  );

  useEffect(() => {
    if (!material.current) return;
    material.current.uniforms.uThreshold.value = threshold;
    material.current.uniforms.uDensity.value = density;
    material.current.uniforms.uBrightness.value = brightness;
  }, [threshold, density, brightness]);

  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(({ camera }) => {
    if (!mesh.current || !material.current) return;
    cameraLocal.current.copy(camera.position);
    mesh.current.worldToLocal(cameraLocal.current);
    material.current.uniforms.uCameraLocal.value.copy(cameraLocal.current);
  });

  const [x, y, z] = volume.dims;
  const largest = Math.max(x, y, z);
  const scale: [number, number, number] = [
    (x / largest) * 5.1,
    (y / largest) * 5.1,
    (z / largest) * 5.1,
  ];

  return (
    <mesh ref={mesh} scale={scale}>
      <boxGeometry args={[1, 1, 1]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={volumeVertexShader}
        fragmentShader={volumeFragmentShader}
        glslVersion={THREE.GLSL3}
        side={THREE.FrontSide}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

function Scene({
  mode,
  positions,
  showGrid,
  volume,
  threshold,
  density,
  brightness,
}: {
  mode: Mode;
  positions: Float32Array;
  showGrid: boolean;
  volume: VolumeData;
  threshold: number;
  density: number;
  brightness: number;
}) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[6.7, 4.4, 7.4]} fov={43} />
      <ambientLight intensity={0.42} />
      <directionalLight position={[7, 9, 5]} intensity={1.2} />
      <pointLight
        position={[-5, 2, -3]}
        intensity={0.8}
        color="#4ca6d7"
      />

      <Suspense fallback={null}>
        {mode === "volume" ? (
          <VolumeRaycast
            volume={volume}
            threshold={threshold}
            density={density}
            brightness={brightness}
          />
        ) : null}
        {mode === "atlas" ? <Atlas positions={positions} /> : null}
        {mode === "network" ? <Network /> : null}
        {mode === "scene" ? <ScenePrimitives /> : null}

        {showGrid ? (
          <Grid
            args={[50, 50]}
            position={[0, -2.9, 0]}
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

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.07}
        minDistance={2.2}
        maxDistance={24}
      />
      <GizmoHelper alignment="bottom-right" margin={[76, 76]}>
        <GizmoViewport
          axisColors={["#ef8c8c", "#86d19b", "#76a9ef"]}
          labelColor="#d8e0e8"
        />
      </GizmoHelper>
    </>
  );
}

export default function VisualLab({ compact = false }: { compact?: boolean }) {
  const phantom = useMemo(() => generateVolumePhantom(64), []);
  const [mode, setMode] = useState<Mode>("volume");
  const [showGrid, setShowGrid] = useState(true);
  const [imported, setImported] = useState<Float32Array | null>(null);
  const [sceneKey, setSceneKey] = useState(0);
  const [quality, setQuality] = useState<"interactive" | "uhd">("interactive");
  const [threshold, setThreshold] = useState(0.12);
  const [density, setDensity] = useState(1.25);
  const [brightness, setBrightness] = useState(1.15);
  const [slice, setSlice] = useState<[number, number, number]>([32, 32, 32]);
  const [volume, setVolume] = useState<VolumeData>({
    name: "Synthetic structural phantom",
    dims: [phantom.size, phantom.size, phantom.size],
    voxels: phantom.voxels,
    source: "synthetic",
  });
  const [importError, setImportError] = useState("");

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

      for (const point of candidate.slice(0, 100000)) {
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

  const importNifti = async (file?: File) => {
    if (!file) return;
    setImportError("");

    try {
      let buffer = await file.arrayBuffer();

      if (niftiReader.isCompressed(buffer)) {
        buffer = niftiReader.decompress(buffer);
      }

      if (!niftiReader.isNIFTI(buffer)) {
        throw new Error("File is not a valid NIfTI-1/NIfTI-2 volume.");
      }

      const header = niftiReader.readHeader(buffer);
      const image = niftiReader.readImage(header, buffer);
      const dims: [number, number, number] = [
        Number(header.dims[1]),
        Number(header.dims[2]),
        Number(header.dims[3]),
      ];

      const values = typedVolume(image, header.datatypeCode);
      const voxelCount = dims[0] * dims[1] * dims[2];
      const normalized = normalizeVolume(values, voxelCount);

      setVolume({
        name: file.name,
        dims,
        voxels: normalized,
        source: "nifti",
      });
      setSlice([
        Math.floor(dims[0] / 2),
        Math.floor(dims[1] / 2),
        Math.floor(dims[2] / 2),
      ]);
      setMode("volume");
      setSceneKey((value) => value + 1);
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Unable to parse NIfTI volume.",
      );
    }
  };

  const webgpu =
    typeof navigator !== "undefined" && "gpu" in navigator;
  const dpr =
    typeof window === "undefined"
      ? 1
      : quality === "uhd"
        ? Math.min(window.devicePixelRatio, 2)
        : Math.min(window.devicePixelRatio, 1.35);

  return (
    <div className={`visual-workspace ${compact ? "visual-workspace-compact" : ""}`}>
      <aside className={`visual-tools ${compact ? "visual-tools-compact" : ""}`}>
        <div>
          <div className="text-[10px] uppercase tracking-[.2em] text-slate-600">
            Neuro 3D Space
          </div>
          <div className="mt-1 text-sm font-medium text-slate-200">
            Volume & anatomy workstation
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="tag">GPU RAYCAST</span>
            <span className="tag-muted">{webgpu ? "WEBGPU CAPABLE" : "WEBGL2"}</span>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          {[
            { id: "volume" as const, label: "Volume raycast", icon: Layers3 },
            { id: "atlas" as const, label: "Cortical points", icon: Waypoints },
            { id: "network" as const, label: "Connectome", icon: Braces },
            { id: "scene" as const, label: "Scene geometry", icon: Box },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`visual-tool-button ${
                mode === id ? "visual-tool-active" : ""
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {mode === "volume" ? (
          <div className="mt-5 border-t border-white/[.06] pt-5">
            <div className="mb-3 text-[10px] uppercase tracking-[.16em] text-slate-650">
              Transfer function
            </div>
            <VolumeSlider
              label="Threshold"
              value={threshold}
              min={0}
              max={0.8}
              step={0.01}
              onChange={setThreshold}
            />
            <VolumeSlider
              label="Density"
              value={density}
              min={0.25}
              max={3}
              step={0.05}
              onChange={setDensity}
            />
            <VolumeSlider
              label="Brightness"
              value={brightness}
              min={0.4}
              max={2.2}
              step={0.05}
              onChange={setBrightness}
            />
          </div>
        ) : null}

        <div className="mt-5 border-t border-white/[.06] pt-5">
          <div className="mb-2 text-[10px] uppercase tracking-[.16em] text-slate-650">
            Viewport
          </div>

          <button
            onClick={() =>
              setQuality((value) =>
                value === "interactive" ? "uhd" : "interactive",
              )
            }
            className="visual-tool-button"
          >
            <MonitorUp size={14} />{" "}
            {quality === "uhd" ? "UHD / 4K mode" : "Interactive mode"}
          </button>

          <button
            onClick={() => setShowGrid((value) => !value)}
            className="visual-tool-button"
          >
            <Grid3X3 size={14} /> {showGrid ? "Hide grid" : "Show grid"}
          </button>

          <button
            onClick={() => setSceneKey((value) => value + 1)}
            className="visual-tool-button"
          >
            <RotateCcw size={14} /> Reset camera
          </button>
        </div>

        <div className="mt-5 border-t border-white/[.06] pt-5">
          <div className="mb-2 text-[10px] uppercase tracking-[.16em] text-slate-650">
            Import
          </div>

          <label className="visual-tool-button cursor-pointer">
            <Upload size={14} /> NIfTI .nii/.nii.gz
            <input
              type="file"
              accept=".nii,.gz,.nii.gz,application/gzip,application/octet-stream"
              className="hidden"
              onChange={(event) => void importNifti(event.target.files?.[0])}
            />
          </label>

          <label className="visual-tool-button cursor-pointer">
            <Upload size={14} /> Point JSON
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => void importPoints(event.target.files?.[0])}
            />
          </label>

          {importError ? (
            <div className="mt-2 rounded-lg border border-red-400/10 bg-red-400/[.03] p-2 text-[10px] leading-4 text-red-300/70">
              {importError}
            </div>
          ) : null}
        </div>

        <div className="mt-auto rounded-xl border border-white/[.06] bg-black/20 p-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.15em] text-slate-650">
            <Cpu size={12} /> Dataset
          </div>
          <div className="mt-2 truncate font-mono text-[10px] text-slate-300">
            {mode === "volume" ? volume.name : `${Math.floor(positions.length / 3).toLocaleString()} points`}
          </div>
          {mode === "volume" ? (
            <div className="mt-1 font-mono text-[9px] text-slate-650">
              {volume.dims.join(" × ")} · {volume.source.toUpperCase()}
            </div>
          ) : null}
        </div>
      </aside>

      <div className={`relative flex-1 overflow-hidden bg-[#02060a] ${compact ? "min-h-[420px]" : "min-h-[760px]"}`}>
        <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border border-white/[.06] bg-black/45 px-3 py-2 backdrop-blur">
          <div className="text-[9px] uppercase tracking-[.18em] text-slate-600">
            Viewport
          </div>
          <div className="mt-1 text-xs text-slate-300">
            {mode === "volume"
              ? "Direct GPU 3D texture ray-casting"
              : mode === "atlas"
                ? "High-density point field"
                : mode === "network"
                  ? "Connectome topology"
                  : "Scene workspace"}
          </div>
        </div>

        {mode === "volume" && !compact ? (
          <div className="absolute right-4 top-4 z-10 hidden grid-cols-3 gap-2 2xl:grid">
            <SliceCanvas
              volume={volume}
              orientation="axial"
              index={slice[2]}
              onIndex={(value) => setSlice(([x, y]) => [x, y, value])}
            />
            <SliceCanvas
              volume={volume}
              orientation="coronal"
              index={slice[1]}
              onIndex={(value) => setSlice(([x, , z]) => [x, value, z])}
            />
            <SliceCanvas
              volume={volume}
              orientation="sagittal"
              index={slice[0]}
              onIndex={(value) => setSlice(([, y, z]) => [value, y, z])}
            />
          </div>
        ) : null}

        <Canvas
          key={sceneKey}
          dpr={dpr}
          gl={{
            antialias: quality === "uhd",
            powerPreference: "high-performance",
            preserveDrawingBuffer: false,
          }}
          onCreated={({ gl }) => gl.setClearColor("#02060a")}
        >
          <Scene
            mode={mode}
            positions={positions}
            showGrid={showGrid}
            volume={volume}
            threshold={threshold}
            density={density}
            brightness={brightness}
          />
        </Canvas>

        <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex gap-2">
          <span className="tag-muted">THREE.JS</span>
          <span className="tag-muted">3D TEXTURE</span>
          <span className="tag-muted">GLSL RAYMARCH</span>
          <span className="tag-muted">{quality === "uhd" ? "UHD" : "INTERACTIVE"}</span>
        </div>
      </div>
    </div>
  );
}

function VolumeSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mb-3 block">
      <div className="mb-1.5 flex justify-between text-[9px] uppercase tracking-[.12em] text-slate-650">
        <span>{label}</span>
        <span>{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        className="volume-control"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function SliceCanvas({
  volume,
  orientation,
  index,
  onIndex,
}: {
  volume: VolumeData;
  orientation: "axial" | "coronal" | "sagittal";
  index: number;
  onIndex: (value: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [x, y, z] = volume.dims;
  const maxIndex =
    orientation === "axial" ? z - 1 : orientation === "coronal" ? y - 1 : x - 1;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = orientation === "sagittal" ? z : x;
    const height =
      orientation === "axial" ? y : orientation === "coronal" ? z : y;
    canvas.width = width;
    canvas.height = height;
    const image = ctx.createImageData(width, height);

    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        let vx = px;
        let vy = py;
        let vz = index;

        if (orientation === "coronal") {
          vx = px;
          vy = index;
          vz = py;
        } else if (orientation === "sagittal") {
          vx = index;
          vy = py;
          vz = px;
        }

        const sourceIndex = vx + vy * x + vz * x * y;
        const value = volume.voxels[sourceIndex] ?? 0;
        const offset = (px + (height - 1 - py) * width) * 4;
        image.data[offset] = value;
        image.data[offset + 1] = value;
        image.data[offset + 2] = value;
        image.data[offset + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
  }, [volume, orientation, index, x, y, z]);

  return (
    <div className="w-36 rounded-lg border border-white/[.07] bg-black/55 p-2 backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between text-[8px] uppercase tracking-[.12em] text-slate-600">
        <span>{orientation}</span><span>{index}/{maxIndex}</span>
      </div>
      <canvas
        ref={ref}
        className="aspect-square w-full rounded bg-black object-contain [image-rendering:auto]"
      />
      <input
        className="mt-2 w-full accent-sky-300"
        type="range"
        min={0}
        max={maxIndex}
        value={Math.min(index, maxIndex)}
        onChange={(event) => onIndex(Number(event.target.value))}
      />
    </div>
  );
}

function typedVolume(
  image: ArrayBuffer,
  datatypeCode: number,
):
  | Uint8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array
  | Uint16Array {
  if (datatypeCode === 2) return new Uint8Array(image);
  if (datatypeCode === 4) return new Int16Array(image);
  if (datatypeCode === 8) return new Int32Array(image);
  if (datatypeCode === 16) return new Float32Array(image);
  if (datatypeCode === 64) return new Float64Array(image);
  if (datatypeCode === 512) return new Uint16Array(image);
  return new Uint8Array(image);
}

function normalizeVolume(
  values:
    | Uint8Array
    | Int16Array
    | Int32Array
    | Float32Array
    | Float64Array
    | Uint16Array,
  voxelCount: number,
) {
  const length = Math.min(values.length, voxelCount);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < length; index += 1) {
    const value = Number(values[index]);
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    min = 0;
    max = 1;
  }

  const output = new Uint8Array(voxelCount);
  const scale = 255 / (max - min);

  for (let index = 0; index < length; index += 1) {
    const value = Number(values[index]);
    output[index] = Number.isFinite(value)
      ? Math.max(0, Math.min(255, Math.round((value - min) * scale)))
      : 0;
  }

  return output;
}
