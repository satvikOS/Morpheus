"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpenCheck,
  BrainCircuit,
  Database,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  PanelsTopLeft,
  Radio,
  ScanSearch,
  Settings2,
  Sparkles,
} from "lucide-react";

import AcquisitionPanel from "@/components/workstation/acquisition-panel";
import DatasetZeroPanel from "@/components/workstation/dataset-zero-panel";
import EvidenceBar from "@/components/workstation/evidence-bar";
import ExperimentsPanel from "@/components/workstation/experiments-panel";
import ModelWorkersPanel from "@/components/workstation/model-workers-panel";
import OverviewPanel from "@/components/workstation/overview-panel";
import PublicDataPanel from "@/components/workstation/public-data-panel";
import ResearchProgramsPanel from "@/components/workstation/research-programs-panel";
import SimulationPanel from "@/components/workstation/simulation-panel";
import SystemPanel from "@/components/workstation/system-panel";
import WorkspacePanel from "@/components/workstation/workspace-panel";
import type { GatewayStatus, StreamInfo, WorkstationView } from "@/lib/morpheus";
import { useSignalEngine } from "@/lib/use-signal-engine";

const VisualLab = dynamic(() => import("./visual-lab"), {
  ssr: false,
  loading: () => (
    <div className="panel flex min-h-[720px] items-center justify-center rounded-2xl text-xs text-slate-600">
      Initializing neuro-spatial engine…
    </div>
  ),
});

const DEFAULT_GATEWAY =
  process.env.NEXT_PUBLIC_MORPHEUS_GATEWAY_URL || "/api/signal-gateway";

type NavItem = {
  id: WorkstationView;
  label: string;
  icon: LucideIcon;
  hint: string;
};

const navItems: NavItem[] = [
  { id: "workspace", label: "Workspace", icon: PanelsTopLeft, hint: "Multi-pane operations" },
  { id: "overview", label: "Overview", icon: LayoutDashboard, hint: "Command layer" },
  { id: "acquisition", label: "Acquisition", icon: Radio, hint: "Live signals" },
  { id: "dataset", label: "Dataset Zero", icon: Database, hint: "Ground truth" },
  { id: "experiments", label: "Experiments", icon: FlaskConical, hint: "Markers & sessions" },
  { id: "programs", label: "M0–M5 Programs", icon: BookOpenCheck, hint: "Research stack" },
  { id: "models", label: "Model Workers", icon: BrainCircuit, hint: "Compute fabric" },
  { id: "simulation", label: "Simulation", icon: Activity, hint: "Synthetic systems" },
  { id: "public-data", label: "Public Data", icon: ScanSearch, hint: "Open archives" },
  { id: "visual", label: "3D Neuro Space", icon: Sparkles, hint: "Volume + spatial" },
  { id: "system", label: "System", icon: Settings2, hint: "Diagnostics" },
];

function endpoint(base: string, path: string) {
  return `${base.replace(/\/$/, "")}${path}`;
}

export default function Home() {
  const [view, setView] = useState<WorkstationView>("workspace");
  const [gateway, setGatewayState] = useState(DEFAULT_GATEWAY);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [status, setStatus] = useState<GatewayStatus>({
    status: "offline",
    streams: 0,
    timestamp: "",
  });
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [latency, setLatency] = useState<number | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState("");

  const signal = useSignalEngine(gateway, selectedSourceId, connectionEpoch);
  const channelSamples = signal.snapshots;
  const samples = channelSamples[0] ?? [];

  useEffect(() => {
    try {
      const saved = localStorage.getItem("morpheus.gateway");
      if (saved) setGatewayState(saved);
      const savedSource = localStorage.getItem("morpheus.source");
      if (savedSource) setSelectedSourceId(savedSource);
    } catch {}
  }, []);

  const setGateway = (value: string) => {
    setGatewayState(value);
    try {
      localStorage.setItem("morpheus.gateway", value);
    } catch {}
  };

  const setSelectedSource = (value: string) => {
    setSelectedSourceId(value);
    try {
      localStorage.setItem("morpheus.source", value);
    } catch {}
  };

  useEffect(() => {
    let active = true;

    const poll = async () => {
      const started = performance.now();
      try {
        const [healthResponse, streamsResponse] = await Promise.all([
          fetch(endpoint(gateway, "/health"), { cache: "no-store" }),
          fetch(endpoint(gateway, "/streams"), { cache: "no-store" }),
        ]);

        if (!healthResponse.ok || !streamsResponse.ok) {
          throw new Error("Gateway unavailable");
        }

        const health = (await healthResponse.json()) as GatewayStatus;
        const streamPayload = (await streamsResponse.json()) as {
          streams?: StreamInfo[];
        };

        if (active) {
          setStatus(health);
          setStreams(streamPayload.streams ?? []);
          setLatency(Math.round(performance.now() - started));
        }
      } catch {
        if (active) {
          setStatus({
            status: "offline",
            streams: 0,
            timestamp: new Date().toISOString(),
          });
          setStreams([]);
          setLatency(null);
        }
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 2500);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [gateway, connectionEpoch]);

  const activeLabel =
    navItems.find((item) => item.id === view)?.label ?? "Workspace";
  const discoveredChannels = streams.reduce(
    (sum, stream) => sum + Number(stream.channel_count || 0),
    0,
  );

  return (
    <main className="min-h-screen">
      <div className="workstation-shell">
        <aside className="workstation-sidebar">
          <div className="px-3 pb-5 pt-3">
            <div className="flex items-center gap-3">
              <div className="morpheus-logo-shell">
                <Image
                  src="/morpheus-logo.png"
                  alt="Morpheus"
                  width={38}
                  height={38}
                  priority
                  className="h-full w-full object-cover"
                />
              </div>
              <div>
                <div className="text-sm font-semibold tracking-tight text-slate-100">
                  Morpheus
                </div>
                <div className="mt-0.5 text-[9px] uppercase tracking-[.22em] text-slate-650">
                  Research OS · v0.4
                </div>
              </div>
            </div>
          </div>

          <nav className="space-y-1 overflow-y-auto pr-1">
            {navItems.map(({ id, label, icon: Icon, hint }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`nav-item ${view === id ? "nav-item-active" : ""}`}
              >
                <span className="nav-icon">
                  <Icon size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{label}</span>
                  <span className="mt-0.5 block text-[9px] text-slate-700">
                    {hint}
                  </span>
                </span>
              </button>
            ))}
          </nav>

          <div className="mt-auto px-2 pb-2 pt-3">
            <div className="sidebar-status">
              <div className="sidebar-status-row">
                <span>Evidence</span>
                <strong
                  className={
                    signal.sourceMode === "live"
                      ? "text-emerald-300"
                      : signal.sourceMode === "simulation"
                        ? "text-amber-200"
                        : "text-slate-500"
                  }
                >
                  {signal.sourceMode.toUpperCase()}
                </strong>
              </div>
              <div className="sidebar-status-grid">
                <div>
                  <strong>{discoveredChannels || channelSamples.length}</strong>
                  <span>channels</span>
                </div>
                <div>
                  <strong>{signal.packetRate}</strong>
                  <span>packets/s</span>
                </div>
                <div>
                  <strong>{signal.dropped}</strong>
                  <span>dropped</span>
                </div>
                <div>
                  <strong>{signal.sharedMemory ? "SAB" : "COPY"}</strong>
                  <span>memory</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="workstation-topbar">
            <div className="min-w-0">
              <div className="text-[9px] uppercase tracking-[.2em] text-slate-650">
                Project Morpheus / Workstation
              </div>
              <div className="mt-1 truncate text-sm font-medium text-slate-200">
                {activeLabel}
              </div>
            </div>

            <div className="topbar-status">
              <div>
                <span>Source</span>
                <strong>
                  {signal.sourceMode === "live"
                    ? signal.sourceName || "LIVE"
                    : signal.sourceMode === "simulation"
                      ? "SIMULATION"
                      : "IDLE"}
                </strong>
              </div>
              <div>
                <span>RTT</span>
                <strong>{latency === null ? "—" : `${latency} ms`}</strong>
              </div>
              <div>
                <span>Rate</span>
                <strong>{signal.packetRate || "—"}</strong>
              </div>
              <button
                onClick={() => setView("system")}
                className="button-icon"
                title="System diagnostics"
              >
                <Gauge size={14} />
              </button>
            </div>
          </header>

          <EvidenceBar
            mode={signal.sourceMode}
            status={status}
            transport={signal.transport}
            packetRate={signal.packetRate}
            dropped={signal.dropped}
            sharedMemory={signal.sharedMemory}
            gateway={gateway}
          />

          <div
            className={`workstation-content ${
              view === "visual" ? "workstation-content-visual" : ""
            }`}
          >
            {view === "workspace" ? (
              <WorkspacePanel
                ring={signal.ring}
                snapshots={channelSamples}
                packetRate={signal.packetRate}
                sourceMode={signal.sourceMode}
                sourceName={signal.sourceName}
                gateway={gateway}
                status={status}
                streams={streams}
                latency={latency}
                dropped={signal.dropped}
                onNavigate={setView}
              />
            ) : null}

            {view === "overview" ? (
              <OverviewPanel
                status={status}
                streams={streams}
                latency={latency}
                sampleRate={signal.packetRate}
                sourceMode={signal.sourceMode}
                onNavigate={setView}
              />
            ) : null}

            {view === "acquisition" ? (
              <AcquisitionPanel
                status={status}
                streams={streams}
                samples={samples}
                channelSamples={channelSamples}
                ring={signal.ring}
                latency={latency}
                sampleRate={signal.packetRate}
                sourceMode={signal.sourceMode}
                sourceName={signal.sourceName}
                gateway={gateway}
                setGateway={setGateway}
                reconnect={() => setConnectionEpoch((value) => value + 1)}
                selectedSourceId={selectedSourceId}
                setSelectedSourceId={setSelectedSource}
                dropped={signal.dropped}
                transport={signal.transport}
                sharedMemory={signal.sharedMemory}
              />
            ) : null}

            {view === "dataset" ? <DatasetZeroPanel /> : null}
            {view === "experiments" ? (
              <ExperimentsPanel gateway={gateway} />
            ) : null}
            {view === "programs" ? <ResearchProgramsPanel /> : null}
            {view === "models" ? (
              <ModelWorkersPanel
                samples={samples}
                channelSamples={channelSamples}
              />
            ) : null}
            {view === "simulation" ? <SimulationPanel /> : null}
            {view === "public-data" ? <PublicDataPanel /> : null}
            {view === "visual" ? <VisualLab /> : null}
            {view === "system" ? (
              <SystemPanel
                status={status}
                gateway={gateway}
                latency={latency}
                sourceMode={signal.sourceMode}
              />
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
