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
  Brain,
  Braces,
  Cpu,
  ExternalLink,
  Grid3X3,
  Layers3,
  Loader2,
  MonitorUp,
  RotateCcw,
  Upload,
  Waypoints,
} from "lucide-react";
import * as THREE from "three";
import * as niftiModule from "nifti-reader-js";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { generateVolumePhantom } from "@/lib/simulations";
import { readNiftiScalars, spatialAffine, voxelToWorld, type VoxelPoint } from "@/lib/neuro-volume";

type Mode = "volume" | "atlas" | "network";

type NiftiHeader = {
  dims: number[];
  datatypeCode: number;
  littleEndian: boolean;
  scl_slope: number;
  scl_inter: number;
  affine: number[][];
  xyzt_units: number;
  sform_code: number;
  qform_code: number;
  getQformMat: () => number[][];
};

type NiftiReaderApi = {
  isCompressed: (data: ArrayBuffer) => boolean;
  decompress: (data: ArrayBuffer) => ArrayBuffer;
  isNIFTI: (data: ArrayBuffer) => boolean;
  readHeader: (data: ArrayBuffer) => NiftiHeader;
  readImage: (header: NiftiHeader, data: ArrayBuffer) => ArrayBuffer;
};

type BrainPreset = {
  id: string;
  label: string;
  source: string;
  kind: string;
  referenceUrl: string;
  note: string;
};

type VolumeData = {
  name: string;
  dims: [number, number, number];
  voxels: Uint8Array;
  source: "synthetic" | "nifti" | "public";
  referenceUrl?: string;
  rawValues?: Float64Array;
  affine?: number[][];
  spatialUnits?: string;
  frames?: number;
};

const niftiReader = niftiModule as unknown as NiftiReaderApi;

function volumePointCloud(
  volume: VolumeData,
  maxPoints = 18000,
) {
  const [x, y, z] = volume.dims;
  const total = x * y * z;
  const stride = Math.max(
    1,
    Math.floor(Math.cbrt(total / Math.max(1, maxPoints))),
  );
  const points: number[] = [];
  const largest = Math.max(x, y, z);

  for (let vz = 0; vz < z; vz += stride) {
    for (let vy = 0; vy < y; vy += stride) {
      for (let vx = 0; vx < x; vx += stride) {
        const index = vx + vy * x + vz * x * y;
        const value = volume.voxels[index] || 0;
        if (value < 26) continue;

        points.push(
          ((vx / Math.max(1, x - 1)) - 0.5) * (x / largest) * 5.2,
          ((vy / Math.max(1, y - 1)) - 0.5) * (y / largest) * 5.2,
          ((vz / Math.max(1, z - 1)) - 0.5) * (z / largest) * 5.2,
        );

        if (points.length / 3 >= maxPoints) {
          return new Float32Array(points);
        }
      }
    }
  }

  return new Float32Array(points);
}

type RegionNode = {
  position: [number, number, number];
  weight: number;
  label: number;
};

function deriveRegionTopology(
  volume: VolumeData,
  maxRegions = 96,
) {
  const [x, y, z] = volume.dims;
  const largest = Math.max(x, y, z);
  const bins = new Map<
    number,
    { x: number; y: number; z: number; n: number }
  >();

  const total = x * y * z;
  const stride = Math.max(
    1,
    Math.floor(Math.cbrt(total / 450000)),
  );

  for (let vz = 0; vz < z; vz += stride) {
    for (let vy = 0; vy < y; vy += stride) {
      for (let vx = 0; vx < x; vx += stride) {
        const value =
          volume.voxels[vx + vy * x + vz * x * y] || 0;
        if (value < 18) continue;

        const label = Math.max(1, Math.round(value / 8));
        const bin = bins.get(label) || {
          x: 0,
          y: 0,
          z: 0,
          n: 0,
        };
        bin.x += vx;
        bin.y += vy;
        bin.z += vz;
        bin.n += 1;
        bins.set(label, bin);
      }
    }
  }

  const nodes: RegionNode[] = Array.from(bins.entries())
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, maxRegions)
    .map(([label, bin]) => ({
      label,
      weight: bin.n,
      position: [
        (((bin.x / bin.n) / Math.max(1, x - 1)) - 0.5) *
          (x / largest) *
          5.2,
        (((bin.y / bin.n) / Math.max(1, y - 1)) - 0.5) *
          (y / largest) *
          5.2,
        (((bin.z / bin.n) / Math.max(1, z - 1)) - 0.5) *
          (z / largest) *
          5.2,
      ],
    }));

  const edges: Array<[RegionNode, RegionNode]> = [];

  for (let index = 0; index < nodes.length; index += 1) {
    const source = nodes[index];
    const nearest = nodes
      .map((target, targetIndex) => ({
        target,
        targetIndex,
        distance:
          targetIndex === index
            ? Number.POSITIVE_INFINITY
            : Math.hypot(
                source.position[0] - target.position[0],
                source.position[1] - target.position[1],
                source.position[2] - target.position[2],
              ),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2);

    for (const item of nearest) {
      if (index < item.targetIndex) {
        edges.push([source, item.target]);
      }
    }
  }

  return { nodes, edges };
}

function Atlas({ positions }: { positions: Float32Array }) {
  return positions.length ? (
    <Points positions={positions} stride={3} frustumCulled>
      <PointMaterial
        transparent
        color="#94d7ef"
        size={0.022}
        sizeAttenuation
        depthWrite={false}
        opacity={0.82}
      />
    </Points>
  ) : null;
}

function RegionTopology({
  volume,
}: {
  volume: VolumeData;
}) {
  const topology = useMemo(
    () => deriveRegionTopology(volume),
    [volume],
  );

  const maxWeight = Math.max(
    1,
    ...topology.nodes.map((node) => node.weight),
  );

  return (
    <>
      {topology.nodes.map((node) => (
        <mesh
          key={node.label}
          position={node.position}
        >
          <sphereGeometry
            args={[
              0.035 +
                0.075 *
                  Math.sqrt(node.weight / maxWeight),
              12,
              12,
            ]}
          />
          <meshStandardMaterial
            color="#8fc4da"
            emissive="#315a6c"
            emissiveIntensity={0.52}
            roughness={0.5}
          />
        </mesh>
      ))}

      {topology.edges.map(([a, b], index) => (
        <Line
          key={index}
          points={[a.position, b.position]}
          color="#607985"
          transparent
          opacity={0.28}
          lineWidth={0.5}
        />
      ))}
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
    vec3 low = vec3(0.055, 0.105, 0.145);
    vec3 mid = vec3(0.30, 0.52, 0.62);
    vec3 high = vec3(0.88, 0.92, 0.94);
    return value < 0.62
      ? mix(low, mid, smoothstep(uThreshold, 0.62, value))
      : mix(mid, high, smoothstep(0.62, 1.0, value));
  }

  void main() {
    vec3 direction = normalize(vObjectPosition - uCameraLocal);
    vec3 p = vObjectPosition + direction * 0.003;
    vec4 accum = vec4(0.0);

    for (int i = 0; i < 260; i++) {
      if (!insideBox(p)) break;

      float value = texture(uVolume, p + vec3(0.5)).r;
      float opacity = smoothstep(
        uThreshold,
        min(1.0, uThreshold + 0.24),
        value
      );
      opacity *= 0.019 * uDensity;

      vec3 color = transfer(value) * uBrightness;
      accum.rgb += (1.0 - accum.a) * color * opacity;
      accum.a += (1.0 - accum.a) * opacity;

      if (accum.a > 0.97) break;
      p += direction * 0.0058;
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
      <ambientLight intensity={0.52} />
      <directionalLight position={[7, 9, 5]} intensity={1.0} />
      <pointLight
        position={[-5, 2, -3]}
        intensity={0.55}
        color="#6e99ad"
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
        {mode === "network" ? (
          <RegionTopology volume={volume} />
        ) : null}

        {showGrid ? (
          <Grid
            args={[50, 50]}
            position={[0, -2.9, 0]}
            cellSize={0.5}
            cellThickness={0.35}
            cellColor="#152029"
            sectionSize={5}
            sectionThickness={0.7}
            sectionColor="#2b3b46"
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
          axisColors={["#b26767", "#6f9a78", "#6887b0"]}
          labelColor="#d8e0e8"
        />
      </GizmoHelper>
    </>
  );
}

export default function VisualLab({
  compact = false,
  active = true,
}: {
  compact?: boolean;
  active?: boolean;
}) {
  const phantom = useMemo(() => generateVolumePhantom(64), []);
  const autoLoadStarted = useRef(false);
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
    name: "Engineering phantom",
    dims: [phantom.size, phantom.size, phantom.size],
    voxels: phantom.voxels,
    source: "synthetic",
  });
  const [presets, setPresets] = useState<BrainPreset[]>([]);
  const [activePreset, setActivePreset] = useState("");
  const [presetBusy, setPresetBusy] = useState("");
  const [importError, setImportError] = useState("");

  const derivedPositions = useMemo(
    () => volumePointCloud(volume),
    [volume],
  );
  const positions = imported ?? derivedPositions;

  const parseNifti = useCallback(
    async (
      incoming: ArrayBuffer,
      name: string,
      source: VolumeData["source"],
      referenceUrl?: string,
    ) => {
      let buffer = incoming;
      if (incoming.byteLength > 64 * 1024 * 1024) throw new Error("Import exceeds the 64 MiB browser preview budget; use a local science adapter for larger volumes.");

      if (niftiReader.isCompressed(buffer)) {
        buffer = await decompressBounded(buffer);
      }

      if (!niftiReader.isNIFTI(buffer)) {
        throw new Error("Source is not a valid NIfTI-1/NIfTI-2 volume.");
      }

      const header = niftiReader.readHeader(buffer);
      const dims: [number, number, number] = [
        Number(header.dims[1]),
        Number(header.dims[2]),
        Number(header.dims[3]),
      ];

      if (
        !dims.every((value) => Number.isFinite(value) && value > 0) ||
        dims.some((value) => value > 1024)
      ) {
        throw new Error("NIfTI dimensions are outside the supported workstation envelope.");
      }

      const frames = Math.max(1, Number(header.dims[4]) || 1);
      if ((Number(header.dims[5]) || 1) > 1 || (Number(header.dims[6]) || 1) > 1 || (Number(header.dims[7]) || 1) > 1) throw new Error("Vector/tensor NIfTI data require a dedicated derivative viewer.");
      const voxelCount = dims[0] * dims[1] * dims[2];
      if (!Number.isSafeInteger(voxelCount * frames) || voxelCount * frames > 16_777_216) throw new Error("NIfTI exceeds the 16 million scalar browser preview budget; use a local science adapter.");
      const image = niftiReader.readImage(header, buffer);
      const values = readNiftiScalars(image, header.datatypeCode, header.littleEndian, voxelCount * frames, header.scl_slope, header.scl_inter);
      const normalized = normalizeVolume(values, voxelCount);

      setVolume({
        name,
        dims,
        voxels: normalized,
        rawValues: values,
        affine: spatialAffine(header),
        spatialUnits: ({ 1: "m", 2: "mm", 3: "µm" } as Record<number, string>)[header.xyzt_units & 7] ?? "unknown units",
        frames,
        source,
        referenceUrl,
      });
      setSlice([
        Math.floor(dims[0] / 2),
        Math.floor(dims[1] / 2),
        Math.floor(dims[2] / 2),
      ]);
      setMode("volume");
      setSceneKey((value) => value + 1);
    },
    [],
  );

  const loadPreset = useCallback(
    async (preset: BrainPreset) => {
      if (presetBusy) return;
      setImportError("");
      setPresetBusy(preset.id);

      try {
        const response = await fetch(
          `/api/neuro-presets?id=${encodeURIComponent(preset.id)}&download=1`,
          { cache: "force-cache" },
        );

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || `Preset request failed: ${response.status}`);
        }

        await parseNifti(
          await response.arrayBuffer(),
          preset.label,
          "public",
          preset.referenceUrl,
        );
        setActivePreset(preset.id);
      } catch (error) {
        setImportError(
          error instanceof Error ? error.message : "Unable to load public neuro preset.",
        );
      } finally {
        setPresetBusy("");
      }
    },
    [parseNifti, presetBusy],
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/neuro-presets", {
          cache: "force-cache",
        });
        const payload = await response.json();
        if (!cancelled && response.ok) {
          setPresets(Array.isArray(payload.presets) ? payload.presets : []);
        }
      } catch {}
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      !active ||
      autoLoadStarted.current ||
      activePreset ||
      !presets.length
    ) {
      return;
    }

    const preferred =
      presets.find((preset) => preset.id === "harvard-oxford-2mm") ||
      presets[0];

    if (!preferred) return;
    autoLoadStarted.current = true;
    void loadPreset(preferred);
  }, [active, activePreset, loadPreset, presets]);

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
      await parseNifti(
        await file.arrayBuffer(),
        file.name,
        "nifti",
      );
      setActivePreset("");
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
          <div className="visual-eyebrow">Neuro Spatial</div>
          <div className="visual-title">Brain volume workstation</div>
          <div className="visual-runtime-line">
            WebGL2 volume ray casting
            {webgpu ? " · WebGPU-capable host" : ""}
          </div>
        </div>

        <div className="visual-mode-stack">
          {[
            { id: "volume" as const, label: "Brain volume", icon: Layers3 },
            { id: "atlas" as const, label: "Voxel field", icon: Waypoints },
            { id: "network" as const, label: "Intensity-bin geometry", icon: Braces },
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
          <>
            <div className="visual-section">
              <div className="visual-section-label">Public study presets</div>
              <div className="visual-preset-stack">
                {presets.length ? (
                  presets.map((preset) => (
                    <button
                      key={preset.id}
                      className={`visual-preset ${
                        activePreset === preset.id ? "visual-preset-active" : ""
                      }`}
                      onClick={() => void loadPreset(preset)}
                      disabled={Boolean(presetBusy)}
                      title={preset.note}
                    >
                      <Brain size={13} />
                      <span>
                        <strong>{preset.label}</strong>
                        <small>{preset.source} · {preset.kind}</small>
                      </span>
                      {presetBusy === preset.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : null}
                    </button>
                  ))
                ) : (
                  <div className="visual-preset-loading">
                    <Loader2 size={12} className="animate-spin" />
                    Loading public preset catalog
                  </div>
                )}
              </div>
            </div>

            {!compact ? (
              <div className="visual-section">
                <div className="visual-section-label">Transfer function</div>
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
          </>
        ) : null}

        {!compact ? (
          <div className="visual-section">
            <div className="visual-section-label">Viewport</div>

            <button
              onClick={() =>
                setQuality((value) =>
                  value === "interactive" ? "uhd" : "interactive",
                )
              }
              className="visual-tool-button"
            >
              <MonitorUp size={14} />
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
        ) : null}

        {!compact ? (
          <div className="visual-section">
            <div className="visual-section-label">Local import</div>

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
          </div>
        ) : null}

        {importError ? (
          <div className="visual-error">{importError}</div>
        ) : null}

        <div className="visual-dataset-card">
          <div className="visual-dataset-label">
            <Cpu size={12} /> Active dataset
          </div>
          <div className="visual-dataset-name">
            {volume.name}
          </div>
          {mode === "volume" ? (
            <>
              <div className="visual-dataset-meta">
                {volume.dims.join(" × ")} · {volume.source.toUpperCase()}
              </div>
              {volume.referenceUrl ? (
                <a
                  href={volume.referenceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="visual-reference-link"
                >
                  Source record <ExternalLink size={10} />
                </a>
              ) : null}
            </>
          ) : (
            <div className="visual-dataset-meta">
              {Math.floor(positions.length / 3).toLocaleString()} volume-derived points · {volume.dims.join(" × ")}
            </div>
          )}
        </div>
      </aside>

      <div className={`relative flex-1 overflow-hidden bg-[#040608] ${
        compact ? "min-h-[420px]" : "min-h-[760px]"
      }`}>
        <div className="visual-viewport-label">
          <div>Viewport</div>
          <strong>
            {mode === "volume"
              ? volume.source === "public"
                ? "Public neuroanatomy volume"
                : volume.source === "nifti"
                  ? "Local NIfTI volume"
                  : "Engineering phantom"
              : mode === "atlas"
                ? "Volume-derived voxel field"
                : "Intensity bins with proximity edges; no connectivity measurement"}
          </strong>
        </div>

        {presetBusy ? (
          <div className="visual-loading-overlay">
            <Loader2 size={16} className="animate-spin" />
            Loading public brain volume
          </div>
        ) : null}

        {mode === "volume" && !compact ? (
          <div className="linked-slices absolute left-4 right-4 top-20 z-10">
            {(["axial", "coronal", "sagittal"] as const).map((orientation) => <SliceCanvas key={orientation} volume={volume} orientation={orientation} point={slice} onPoint={setSlice} />)}
            <div className="volume-coordinates">
              <span>Voxel I/J/K: {slice.join(" / ")}</span>
              <span>{voxelToWorld(slice, volume.affine) ? `Header world: ${voxelToWorld(slice, volume.affine)!.map((value) => value.toFixed(2)).join(" / ")} ${volume.spatialUnits}` : "World registration unavailable"}</span>
              <span>Intensity: {volume.rawValues?.[slice[0] + slice[1] * volume.dims[0] + slice[2] * volume.dims[0] * volume.dims[1]]?.toPrecision(5) ?? "normalized phantom"}</span>
              <span>Voxel-space preview; oblique anatomy and physical aspect are not registered. {(volume.frames ?? 1) > 1 ? `Frame 1 of ${volume.frames} (temporal playback pending).` : ""}</span>
            </div>
          </div>
        ) : null}

        <Canvas
          key={sceneKey}
          frameloop={active ? "always" : "demand"}
          dpr={active ? dpr : 1}
          gl={{
            antialias: quality === "uhd",
            powerPreference: "high-performance",
            preserveDrawingBuffer: false,
          }}
          onCreated={({ gl }) => gl.setClearColor("#040608")}
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

        <div className="visual-runtime-footer">
          <span>WebGL2</span>
          <span>3D texture</span>
          <span>GLSL ray marching</span>
          <span>{quality === "uhd" ? "UHD" : "Interactive"}</span>
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
      <div className="mb-1.5 flex justify-between text-[10px] uppercase tracking-[.1em] text-slate-500">
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

function SliceCanvas({ volume, orientation, point, onPoint }: {
  volume: VolumeData; orientation: "axial" | "coronal" | "sagittal"; point: VoxelPoint; onPoint: (point: VoxelPoint) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [x, y, z] = volume.dims;
  const axis = orientation === "axial" ? 2 : orientation === "coronal" ? 1 : 0;
  const index = point[axis];
  const maxIndex = volume.dims[axis] - 1;
  const width = orientation === "sagittal" ? z : x;
  const height = orientation === "coronal" ? z : y;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = width; canvas.height = height;
    const image = ctx.createImageData(width, height);
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
      const [vx, vy, vz] = orientation === "coronal" ? [px, index, py] : orientation === "sagittal" ? [index, py, px] : [px, py, index];
      const value = volume.voxels[vx + vy * x + vz * x * y] ?? 0;
      const offset = (px + (height - 1 - py) * width) * 4;
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = value;
      image.data[offset + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const horizontal = orientation === "sagittal" ? point[2] : point[0];
    const vertical = orientation === "coronal" ? point[2] : point[1];
    ctx.strokeStyle = "#a6ddc8"; ctx.lineWidth = Math.max(1, width / 180);
    ctx.beginPath(); ctx.moveTo(horizontal + .5, 0); ctx.lineTo(horizontal + .5, height);
    ctx.moveTo(0, height - vertical - .5); ctx.lineTo(width, height - vertical - .5); ctx.stroke();
  }, [volume, orientation, point, index, width, height, x, y]);
  function select(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / width, rect.height / height);
    const offsetX = (rect.width - width * scale) / 2, offsetY = (rect.height - height * scale) / 2;
    const px = Math.max(0, Math.min(width - 1, Math.floor((event.clientX - rect.left - offsetX) / scale)));
    const py = Math.max(0, Math.min(height - 1, height - 1 - Math.floor((event.clientY - rect.top - offsetY) / scale)));
    onPoint(orientation === "coronal" ? [px, index, py] : orientation === "sagittal" ? [index, py, px] : [px, py, index]);
  }
  return <div className="linked-slice">
    <header><span>{["I plane", "J plane", "K plane"][axis]}</span><span>{index} / {maxIndex}</span></header>
    <canvas ref={ref} onClick={select} aria-label={`Linked ${["I", "J", "K"][axis]} voxel slice; use sliders for keyboard selection`} />
    <input aria-label={`${["I", "J", "K"][axis]} voxel index`} type="range" min={0} max={maxIndex} value={index} onChange={(event) => { const next = [...point] as VoxelPoint; next[axis] = Number(event.target.value); onPoint(next); }} />
  </div>;
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
      ? Math.max(
          0,
          Math.min(255, Math.round((value - min) * scale)),
        )
      : 0;
  }

  return output;
}

async function decompressBounded(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === "undefined") throw new Error("Gzip decompression is unavailable in this browser. Import an uncompressed NIfTI.");
  const reader = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 64 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Decompressed volume exceeds the 64 MiB browser preview budget.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output.buffer;
}
