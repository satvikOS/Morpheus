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

type Mode = "volume" | "atlas" | "network";

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

      if (niftiReader.isCompressed(buffer)) {
        buffer = niftiReader.decompress(buffer);
      }

      if (!niftiReader.isNIFTI(buffer)) {
        throw new Error("Source is not a valid NIfTI-1/NIfTI-2 volume.");
      }

      const header = niftiReader.readHeader(buffer);
      const image = niftiReader.readImage(header, buffer);
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

      const values = typedVolume(image, header.datatypeCode);
      const voxelCount = dims[0] * dims[1] * dims[2];
      const normalized = normalizeVolume(values, voxelCount);

      setVolume({
        name,
        dims,
        voxels: normalized,
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
            { id: "network" as const, label: "Region topology", icon: Braces },
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
                : "Volume-derived region topology"}
          </strong>
        </div>

        {presetBusy ? (
          <div className="visual-loading-overlay">
            <Loader2 size={16} className="animate-spin" />
            Loading public brain volume
          </div>
        ) : null}

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
    orientation === "axial"
      ? z - 1
      : orientation === "coronal"
        ? y - 1
        : x - 1;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = orientation === "sagittal" ? z : x;
    const height =
      orientation === "axial"
        ? y
        : orientation === "coronal"
          ? z
          : y;

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
    <div className="w-36 rounded-lg border border-white/[.08] bg-black/75 p-2 backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between text-[9px] uppercase tracking-[.1em] text-slate-500">
        <span>{orientation}</span>
        <span>{index}/{maxIndex}</span>
      </div>
      <canvas
        ref={ref}
        className="aspect-square w-full rounded bg-black object-contain"
      />
      <input
        className="mt-2 w-full accent-slate-300"
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
      ? Math.max(
          0,
          Math.min(255, Math.round((value - min) * scale)),
        )
      : 0;
  }

  return output;
}
