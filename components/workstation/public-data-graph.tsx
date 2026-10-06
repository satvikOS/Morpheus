"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import {
  GizmoHelper,
  GizmoViewport,
  OrbitControls,
} from "@react-three/drei";
import {
  Activity,
  Boxes,
  Database,
  RadioTower,
} from "lucide-react";
import * as THREE from "three";
import {
  useEffect,
  useMemo,
  useRef,
} from "react";
import type {
  PublicDataSource,
  PublicDataset,
} from "@/lib/morpheus";

export type KnowledgeRecord = PublicDataset & {
  graphKey: string;
  sourceId: string;
  firstSeenAt: number;
};

type GraphNode = {
  id: string;
  label: string;
  kind: "source" | "dataset" | "modality";
  position: THREE.Vector3;
  color: THREE.Color;
  size: number;
  fresh: boolean;
};

type GraphEdge = {
  a: THREE.Vector3;
  b: THREE.Vector3;
  kind: "source" | "modality";
};

function hash(value: string) {
  let current = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    current ^= value.charCodeAt(index);
    current = Math.imul(current, 16777619);
  }
  return current >>> 0;
}

function seededUnit(seed: number) {
  let value = seed || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967295;
  };
}

function buildGraph(
  sources: PublicDataSource[],
  records: KnowledgeRecord[],
) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const positions = new Map<string, THREE.Vector3>();
  const now = Date.now();

  const sourceList = sources.length
    ? sources
    : [
        {
          id: "public",
          label: "Public data",
          route: "",
          ok: false,
          latency_ms: 0,
          datasets: [],
        },
      ];

  sourceList.forEach((source, index) => {
    const angle =
      (index / Math.max(1, sourceList.length)) * Math.PI * 2;
    const ring = 4.7 + (index % 2) * 0.45;
    const position = new THREE.Vector3(
      Math.cos(angle) * ring,
      Math.sin(index * 1.31) * 1.1,
      Math.sin(angle) * ring,
    );

    positions.set(`source:${source.id}`, position);
    nodes.push({
      id: `source:${source.id}`,
      label: source.label,
      kind: "source",
      position,
      color: new THREE.Color(
        source.ok ? "#c0d6df" : "#6e777c",
      ),
      size: source.ok ? 0.22 : 0.16,
      fresh: false,
    });
  });

  const modalitySet = new Set<string>();
  for (const record of records) {
    for (const modality of record.modalities || []) {
      if (modality.trim()) {
        modalitySet.add(modality.trim().toLowerCase());
      }
    }
  }

  const modalities = Array.from(modalitySet).slice(0, 32);
  modalities.forEach((modality, index) => {
    const angle =
      (index / Math.max(1, modalities.length)) * Math.PI * 2;
    const radius = 1.7 + (index % 3) * 0.22;
    const position = new THREE.Vector3(
      Math.cos(angle) * radius,
      Math.sin(index * 0.71) * 1.0,
      Math.sin(angle) * radius,
    );

    positions.set(`modality:${modality}`, position);
    nodes.push({
      id: `modality:${modality}`,
      label: modality,
      kind: "modality",
      position,
      color: new THREE.Color("#83979f"),
      size: 0.105,
      fresh: false,
    });
  });

  for (const record of records.slice(-850)) {
    const source =
      positions.get(`source:${record.sourceId}`) ||
      new THREE.Vector3();
    const random = seededUnit(hash(record.graphKey));
    const radius = 0.65 + random() * 1.9;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);

    const position = source
      .clone()
      .add(
        new THREE.Vector3(
          radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.cos(phi) * 0.8,
          radius * Math.sin(phi) * Math.sin(theta),
        ),
      );

    const fresh = now - record.firstSeenAt < 45_000;
    nodes.push({
      id: record.graphKey,
      label: record.title || record.id,
      kind: "dataset",
      position,
      color: new THREE.Color(
        fresh ? "#b9e7f7" : "#6d9eb3",
      ),
      size: fresh ? 0.07 : 0.048,
      fresh,
    });

    edges.push({
      a: source,
      b: position,
      kind: "source",
    });

    for (const modality of (record.modalities || []).slice(0, 3)) {
      const target = positions.get(
        `modality:${modality.trim().toLowerCase()}`,
      );
      if (target) {
        edges.push({
          a: position,
          b: target,
          kind: "modality",
        });
      }
    }
  }

  return { nodes, edges };
}

function GraphScene({
  graph,
  labelElements,
}: {
  graph: ReturnType<typeof buildGraph>;
  labelElements: { current: Map<string, HTMLDivElement> };
}) {
  const sourceMesh = useRef<THREE.InstancedMesh>(null);
  const datasetMesh = useRef<THREE.InstancedMesh>(null);
  const modalityMesh = useRef<THREE.InstancedMesh>(null);
  const graphGroup = useRef<THREE.Group>(null);
  const projectedLabel = useRef(new THREE.Vector3());

  const sourceNodes = useMemo(
    () => graph.nodes.filter((node) => node.kind === "source"),
    [graph.nodes],
  );
  const datasetNodes = useMemo(
    () => graph.nodes.filter((node) => node.kind === "dataset"),
    [graph.nodes],
  );
  const modalityNodes = useMemo(
    () => graph.nodes.filter((node) => node.kind === "modality"),
    [graph.nodes],
  );

  useEffect(() => {
    const dummy = new THREE.Object3D();

    const apply = (
      mesh: THREE.InstancedMesh | null,
      nodes: GraphNode[],
    ) => {
      if (!mesh) return;

      nodes.forEach((node, index) => {
        dummy.position.copy(node.position);
        dummy.scale.setScalar(node.size);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        mesh.setColorAt(index, node.color);
      });

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    };

    apply(sourceMesh.current, sourceNodes);
    apply(datasetMesh.current, datasetNodes);
    apply(modalityMesh.current, modalityNodes);
  }, [sourceNodes, datasetNodes, modalityNodes]);

  const linePositions = useMemo(() => {
    const array = new Float32Array(graph.edges.length * 6);

    graph.edges.forEach((edge, index) => {
      const offset = index * 6;
      array[offset] = edge.a.x;
      array[offset + 1] = edge.a.y;
      array[offset + 2] = edge.a.z;
      array[offset + 3] = edge.b.x;
      array[offset + 4] = edge.b.y;
      array[offset + 5] = edge.b.z;
    });

    return array;
  }, [graph.edges]);

  useFrame((state, delta) => {
    if (graphGroup.current) {
      graphGroup.current.rotation.y += delta * 0.018;
      graphGroup.current.updateWorldMatrix(true, false);
      state.camera.updateMatrixWorld();

      // React DOM owns these nodes. The Three renderer only updates their
      // projection styles; it never creates a second root or removes a node.
      for (const node of sourceNodes.slice(0, 14)) {
        const element = labelElements.current.get(node.id);
        if (!element) continue;
        const projected = projectedLabel.current.copy(node.position);
        projected.y += 0.3;
        projected.applyMatrix4(graphGroup.current.matrixWorld).project(state.camera);
        const visible = projected.z >= -1 && projected.z <= 1;
        element.style.visibility = visible ? "visible" : "hidden";
        if (visible) {
          const x = (projected.x + 1) * state.size.width / 2;
          const y = (1 - projected.y) * state.size.height / 2;
          element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
        }
      }
    }

    const pulse = 1 + Math.sin(state.clock.elapsedTime * 4.2) * 0.12;
    if (sourceMesh.current) {
      sourceMesh.current.scale.setScalar(pulse);
    }
  });

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight
        position={[8, 11, 7]}
        intensity={1.15}
      />
      <pointLight
        position={[-5, 2, -4]}
        intensity={0.8}
        color="#7ba1b2"
      />

      <group ref={graphGroup}>
        {sourceNodes.length ? (
          <instancedMesh
            ref={sourceMesh}
            args={[undefined, undefined, sourceNodes.length]}
          >
            <icosahedronGeometry args={[1, 2]} />
            <meshStandardMaterial
              vertexColors
              roughness={0.48}
              metalness={0.13}
            />
          </instancedMesh>
        ) : null}

        {datasetNodes.length ? (
          <instancedMesh
            ref={datasetMesh}
            args={[undefined, undefined, datasetNodes.length]}
          >
            <sphereGeometry args={[1, 10, 10]} />
            <meshStandardMaterial
              vertexColors
              roughness={0.68}
              metalness={0.04}
              emissive="#17303c"
              emissiveIntensity={0.34}
            />
          </instancedMesh>
        ) : null}

        {modalityNodes.length ? (
          <instancedMesh
            ref={modalityMesh}
            args={[undefined, undefined, modalityNodes.length]}
          >
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial
              vertexColors
              roughness={0.7}
              metalness={0.05}
            />
          </instancedMesh>
        ) : null}

        {linePositions.length ? (
          <lineSegments>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[linePositions, 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial
              color="#41545e"
              transparent
              opacity={0.42}
            />
          </lineSegments>
        ) : null}

      </group>

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={26}
      />
      <GizmoHelper
        alignment="bottom-right"
        margin={[58, 58]}
      >
        <GizmoViewport
          axisColors={["#a86666", "#71977b", "#667fa8"]}
          labelColor="#d8e0e8"
        />
      </GizmoHelper>
    </>
  );
}

export default function PublicDataGraph({
  sources,
  records,
  ingestCycles,
  newRecords,
  live,
}: {
  sources: PublicDataSource[];
  records: KnowledgeRecord[];
  ingestCycles: number;
  newRecords: number;
  live: boolean;
}) {
  const graph = useMemo(() => buildGraph(sources, records), [sources, records]);
  const sourceLabels = useMemo(
    () => graph.nodes.filter((node) => node.kind === "source").slice(0, 14),
    [graph.nodes],
  );
  const labelElements = useRef(new Map<string, HTMLDivElement>());
  const modalityCount = useMemo(() => {
    const values = new Set<string>();

    for (const record of records) {
      for (const modality of record.modalities || []) {
        if (modality.trim()) {
          values.add(modality.trim().toLowerCase());
        }
      }
    }

    return values.size;
  }, [records]);

  const nodeCount =
    sources.length + records.length + modalityCount;

  return (
    <div className="public-graph-shell">
      <div className="public-graph-header">
        <div>
          <div className="public-graph-eyebrow">
            Federated neuroscience knowledge graph
          </div>
          <h3>Live 3D research fabric</h3>
          <p>
            Repository, dataset and modality entities are retained
            locally. New upstream records become new graph nodes
            instead of replacing the previous ingest cycle.
          </p>
        </div>

        <div className="public-graph-stats">
          <div>
            <Boxes size={12} />
            <span>Nodes</span>
            <strong>{nodeCount}</strong>
          </div>
          <div>
            <Activity size={12} />
            <span>New</span>
            <strong>+{newRecords}</strong>
          </div>
          <div>
            <RadioTower size={12} />
            <span>Cycles</span>
            <strong>{ingestCycles}</strong>
          </div>
          <div>
            <span
              className={live ? "live-dot" : "idle-dot"}
            />
            <span>Fabric</span>
            <strong>{live ? "LIVE" : "PAUSED"}</strong>
          </div>
        </div>
      </div>

      <div className="public-graph-canvas">
        <Canvas
          dpr={[1, 1.6]}
          camera={{
            position: [0, 4.8, 11.8],
            fov: 45,
          }}
          gl={{
            antialias: true,
            powerPreference: "high-performance",
          }}
          onCreated={({ gl }) =>
            gl.setClearColor("#050708")
          }
        >
          <GraphScene
            graph={graph}
            labelElements={labelElements}
          />
        </Canvas>

        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
          {sourceLabels.map((node) => (
            <div
              key={node.id}
              ref={(element) => {
                if (element) labelElements.current.set(node.id, element);
                else labelElements.current.delete(node.id);
              }}
              style={{ position: "absolute", top: 0, left: 0, visibility: "hidden", whiteSpace: "nowrap", willChange: "transform" }}
            >
              <div className="graph-source-label">{node.label}</div>
            </div>
          ))}
        </div>

        {!records.length ? (
          <div className="public-graph-empty">
            <Database size={18} />
            <strong>Repository topology is live</strong>
            <span>
              Dataset nodes appear as anonymous public APIs
              return records. No synthetic research records
              are invented to fill the graph.
            </span>
          </div>
        ) : null}

        <div className="public-graph-legend">
          <span>
            <i className="graph-source-dot" /> repository
          </span>
          <span>
            <i className="graph-dataset-dot" /> dataset/entity
          </span>
          <span>
            <i className="graph-modality-dot" /> modality
          </span>
        </div>
      </div>
    </div>
  );
}
