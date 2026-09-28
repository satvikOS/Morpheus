"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, OrbitControls } from "@react-three/drei";
import { Activity, Boxes, RadioTower } from "lucide-react";
import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
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
  kind: "source" | "dataset" | "modality";
  position: THREE.Vector3;
  color: THREE.Color;
  size: number;
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

  const sourceList = sources.length
    ? sources
    : [
        {
          id: "public",
          label: "Public data",
          route: "",
          ok: true,
          latency_ms: 0,
          datasets: [],
        },
      ];

  sourceList.forEach((source, index) => {
    const angle =
      (index / Math.max(1, sourceList.length)) * Math.PI * 2;
    const position = new THREE.Vector3(
      Math.cos(angle) * 4.6,
      ((index % 3) - 1) * 0.7,
      Math.sin(angle) * 4.6,
    );

    positions.set(`source:${source.id}`, position);
    nodes.push({
      id: `source:${source.id}`,
      kind: "source",
      position,
      color: new THREE.Color(
        source.ok ? "#9bc0d2" : "#666f76",
      ),
      size: 0.17,
    });
  });

  const modalitySet = new Set<string>();
  for (const record of records) {
    for (const modality of record.modalities || []) {
      if (modality.trim()) modalitySet.add(modality.trim().toLowerCase());
    }
  }

  const modalities = Array.from(modalitySet).slice(0, 24);
  modalities.forEach((modality, index) => {
    const angle =
      (index / Math.max(1, modalities.length)) * Math.PI * 2;
    const position = new THREE.Vector3(
      Math.cos(angle) * 1.8,
      Math.sin(index * 0.67) * 0.9,
      Math.sin(angle) * 1.8,
    );
    positions.set(`modality:${modality}`, position);
    nodes.push({
      id: `modality:${modality}`,
      kind: "modality",
      position,
      color: new THREE.Color("#788c93"),
      size: 0.085,
    });
  });

  for (const record of records.slice(-420)) {
    const source =
      positions.get(`source:${record.sourceId}`) ||
      new THREE.Vector3();
    const random = seededUnit(hash(record.graphKey));
    const radius = 0.55 + random() * 1.75;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);

    const position = source
      .clone()
      .add(
        new THREE.Vector3(
          radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.cos(phi) * 0.72,
          radius * Math.sin(phi) * Math.sin(theta),
        ),
      );

    nodes.push({
      id: record.graphKey,
      kind: "dataset",
      position,
      color: new THREE.Color("#6f9eb5"),
      size: 0.045,
    });

    edges.push({
      a: source,
      b: position,
      kind: "source",
    });

    for (const modality of (record.modalities || []).slice(0, 2)) {
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
  sources,
  records,
}: {
  sources: PublicDataSource[];
  records: KnowledgeRecord[];
}) {
  const sourceMesh = useRef<THREE.InstancedMesh>(null);
  const datasetMesh = useRef<THREE.InstancedMesh>(null);
  const modalityMesh = useRef<THREE.InstancedMesh>(null);
  const rotation = useRef<THREE.Group>(null);
  const graph = useMemo(
    () => buildGraph(sources, records),
    [sources, records],
  );

  const sourceNodes = graph.nodes.filter(
    (node) => node.kind === "source",
  );
  const datasetNodes = graph.nodes.filter(
    (node) => node.kind === "dataset",
  );
  const modalityNodes = graph.nodes.filter(
    (node) => node.kind === "modality",
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
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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

  useFrame((_, delta) => {
    if (rotation.current) {
      rotation.current.rotation.y += delta * 0.025;
    }
  });

  return (
    <>
      <ambientLight intensity={0.78} />
      <directionalLight position={[8, 10, 8]} intensity={0.8} />

      <group ref={rotation}>
        <instancedMesh
          ref={sourceMesh}
          args={[undefined, undefined, Math.max(1, sourceNodes.length)]}
        >
          <icosahedronGeometry args={[1, 2]} />
          <meshStandardMaterial
            vertexColors
            roughness={0.62}
            metalness={0.08}
          />
        </instancedMesh>

        {datasetNodes.length ? (
          <instancedMesh
            ref={datasetMesh}
            args={[undefined, undefined, datasetNodes.length]}
          >
            <sphereGeometry args={[1, 8, 8]} />
            <meshStandardMaterial
              vertexColors
              roughness={0.76}
              metalness={0.03}
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

        <lineSegments>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[linePositions, 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial
            color="#33454e"
            transparent
            opacity={0.34}
          />
        </lineSegments>
      </group>

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={5}
        maxDistance={24}
      />
      <GizmoHelper alignment="bottom-right" margin={[58, 58]}>
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
  const modalityCount = useMemo(() => {
    const values = new Set<string>();
    for (const record of records) {
      for (const modality of record.modalities || []) {
        if (modality.trim()) values.add(modality.trim().toLowerCase());
      }
    }
    return values.size;
  }, [records]);

  return (
    <div className="public-graph-shell">
      <div className="public-graph-header">
        <div>
          <div className="public-graph-eyebrow">
            Federated neuroscience knowledge graph
          </div>
          <h3>Live 3D research fabric</h3>
          <p>
            Unique records are retained for this workstation session. Each
            catalog refresh adds newly observed datasets and links them to
            repository and modality nodes.
          </p>
        </div>

        <div className="public-graph-stats">
          <div>
            <Boxes size={12} />
            <span>Nodes</span>
            <strong>
              {sources.length + records.length + modalityCount}
            </strong>
          </div>
          <div>
            <Activity size={12} />
            <span>Ingested</span>
            <strong>+{newRecords}</strong>
          </div>
          <div>
            <RadioTower size={12} />
            <span>Cycles</span>
            <strong>{ingestCycles}</strong>
          </div>
          <div>
            <span className={live ? "live-dot" : "idle-dot"} />
            <span>Fabric</span>
            <strong>{live ? "LIVE" : "PAUSED"}</strong>
          </div>
        </div>
      </div>

      <div className="public-graph-canvas">
        <Canvas
          dpr={[1, 1.5]}
          camera={{ position: [0, 4.5, 11], fov: 46 }}
          gl={{
            antialias: true,
            powerPreference: "high-performance",
          }}
          onCreated={({ gl }) => gl.setClearColor("#050708")}
        >
          <GraphScene sources={sources} records={records} />
        </Canvas>

        <div className="public-graph-legend">
          <span><i className="graph-source-dot" /> repository</span>
          <span><i className="graph-dataset-dot" /> dataset/entity</span>
          <span><i className="graph-modality-dot" /> modality</span>
        </div>
      </div>
    </div>
  );
}
