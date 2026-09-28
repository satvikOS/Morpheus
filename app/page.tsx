"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpenCheck,
  BrainCircuit,
  Database,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Radio,
  ScanSearch,
  Settings2,
  Sparkles,
} from "lucide-react";

import AcquisitionPanel from "@/components/workstation/acquisition-panel";
import DatasetZeroPanel from "@/components/workstation/dataset-zero-panel";
import ExperimentsPanel from "@/components/workstation/experiments-panel";
import ModelWorkersPanel from "@/components/workstation/model-workers-panel";
import OverviewPanel from "@/components/workstation/overview-panel";
import PublicDataPanel from "@/components/workstation/public-data-panel";
import ResearchProgramsPanel from "@/components/workstation/research-programs-panel";
import SimulationPanel from "@/components/workstation/simulation-panel";
import SystemPanel from "@/components/workstation/system-panel";
import type { GatewayStatus, SamplePacket, StreamInfo, WorkstationView } from "@/lib/morpheus";
import { buildWebSocketUrl } from "@/lib/morpheus";

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

const RING_SIZE = 8192;
const MAX_UI_CHANNELS = 16;
const VIEW_SAMPLES = 320;

type NavItem = {
  id: WorkstationView;
  label: string;
  icon: LucideIcon;
  hint: string;
};

const navItems: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, hint: "Command layer" },
  { id: "acquisition", label: "Acquisition", icon: Radio, hint: "Live signals" },
  { id: "dataset", label: "Dataset Zero", icon: Database, hint: "Ground truth" },
  { id: "experiments", label: "Experiments", icon: FlaskConical, hint: "Markers" },
  { id: "programs", label: "M0–M5 Programs", icon: BookOpenCheck, hint: "Research stack" },
  { id: "models", label: "Model Workers", icon: BrainCircuit, hint: "Compute fabric" },
  { id: "simulation", label: "Simulation", icon: Activity, hint: "Synthetic brains" },
  { id: "public-data", label: "Public Data", icon: ScanSearch, hint: "Open archives" },
  { id: "visual", label: "3D Neuro Space", icon: Sparkles, hint: "Volume + spatial" },
  { id: "system", label: "System", icon: Settings2, hint: "Diagnostics" },
];

function endpoint(base: string, path: string) {
  return `${base.replace(/\/$/, "")}${path}`;
}

export default function Home() {
  const [view, setView] = useState<WorkstationView>("overview");
  const [gateway, setGatewayState] = useState(DEFAULT_GATEWAY);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [status, setStatus] = useState<GatewayStatus>({
    status: "offline",
    streams: 0,
    timestamp: "",
  });
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [samples, setSamples] = useState<number[]>([]);
  const [channelSamples, setChannelSamples] = useState<number[][]>([]);
  const [latency, setLatency] = useState<number | null>(null);
  const [sampleRate, setSampleRate] = useState(0);
  const [sourceMode, setSourceMode] =
    useState<"live" | "simulation" | "idle">("idle");
  const [sourceName, setSourceName] = useState("");

  const packetCount = useRef(0);
  const lastMessageAt = useRef(0);
  const writeIndex = useRef(0);
  const totalSamples = useRef(0);
  const activeChannelCount = useRef(1);
  const channelRings = useRef(
    Array.from({ length: MAX_UI_CHANNELS }, () => new Float32Array(RING_SIZE)),
  );

  const pushPacket = (values: number[]) => {
    const bounded = values.slice(0, MAX_UI_CHANNELS);
    activeChannelCount.current = Math.max(1, bounded.length);

    for (let channel = 0; channel < activeChannelCount.current; channel += 1) {
      channelRings.current[channel][writeIndex.current] =
        Number.isFinite(Number(bounded[channel])) ? Number(bounded[channel]) : 0;
    }

    writeIndex.current = (writeIndex.current + 1) % RING_SIZE;
    totalSamples.current += 1;
    packetCount.current += 1;
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem("morpheus.gateway");
      if (saved) setGatewayState(saved);
    } catch {}
  }, []);

  const setGateway = (value: string) => {
    setGatewayState(value);
    try {
      localStorage.setItem("morpheus.gateway", value);
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

  useEffect(() => {
    let ws: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let closed = false;

    const connect = () => {
      if (closed) return;

      try {
        ws = new WebSocket(buildWebSocketUrl(gateway, "/ws/samples"));

        ws.onmessage = (event) => {
          try {
            const packet = JSON.parse(event.data) as SamplePacket;
            if (!Array.isArray(packet.channels) || !packet.channels.length) return;

            lastMessageAt.current = Date.now();
            const simulated =
              packet.simulated ||
              packet.stream.toLowerCase().includes("synthetic");

            setSourceMode(simulated ? "simulation" : "live");
            setSourceName(
              packet.stream || (simulated ? "Synthetic source" : "Live source"),
            );
            pushPacket(packet.channels);
          } catch {}
        };

        ws.onclose = () => {
          if (!closed) reconnectTimer = window.setTimeout(connect, 1500);
        };

        ws.onerror = () => ws?.close();
      } catch {
        reconnectTimer = window.setTimeout(connect, 1800);
      }
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [gateway, connectionEpoch]);

  useEffect(() => {
    const rateTimer = window.setInterval(() => {
      setSampleRate(packetCount.current);
      packetCount.current = 0;
    }, 1000);

    const simulationTimer = window.setInterval(() => {
      if (Date.now() - lastMessageAt.current < 2600) return;

      const t = performance.now() / 1000;
      const synthetic = Array.from({ length: 8 }, (_, channel) => {
        const phase = channel * 0.31;
        return (
          Math.sin(t * (5.6 + channel * 0.18) + phase) * 0.2 +
          Math.sin(t * (12.4 + channel * 0.27) + phase * 1.7) * 0.07 +
          Math.sin(t * 1.1 + phase) * 0.025
        );
      });

      pushPacket(synthetic);
      setSourceMode("simulation");
      setSourceName("Local synthetic fallback");
    }, 20);

    const renderTimer = window.setInterval(() => {
      const count = Math.min(VIEW_SAMPLES, totalSamples.current, RING_SIZE);
      if (!count) return;

      const channels = Math.max(1, activeChannelCount.current);
      const start = (writeIndex.current - count + RING_SIZE) % RING_SIZE;
      const snapshots = Array.from({ length: channels }, (_, channel) => {
        const ring = channelRings.current[channel];
        const snapshot = new Array<number>(count);
        for (let index = 0; index < count; index += 1) {
          snapshot[index] = ring[(start + index) % RING_SIZE];
        }
        return snapshot;
      });

      setChannelSamples(snapshots);
      setSamples(snapshots[0] ?? []);
    }, 33);

    return () => {
      window.clearInterval(rateTimer);
      window.clearInterval(simulationTimer);
      window.clearInterval(renderTimer);
    };
  }, []);

  const channelCount = streams.reduce(
    (sum, stream) => sum + Number(stream.channel_count || 0),
    0,
  );
  const activeLabel =
    navItems.find((item) => item.id === view)?.label ?? "Overview";

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
                  Research OS · v0.3
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
            <div className="rounded-xl border border-white/[.06] bg-black/20 p-3">
              <div className="flex items-center justify-between text-[9px] uppercase tracking-[.16em] text-slate-650">
                <span>Acquisition</span>
                <span
                  className={
                    status.status === "online"
                      ? "text-emerald-300"
                      : "text-slate-650"
                  }
                >
                  {status.status}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <div className="text-lg font-semibold text-slate-200">
                    {channelCount || channelSamples.length}
                  </div>
                  <div className="text-[9px] text-slate-700">channels</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-slate-200">
                    {sampleRate}
                  </div>
                  <div className="text-[9px] text-slate-700">packets/s</div>
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

            <div className="flex items-center gap-2">
              <div className="hidden rounded-lg border border-white/[.06] bg-black/20 px-3 py-2 text-[10px] text-slate-600 sm:block">
                {sourceMode === "live"
                  ? sourceName || "LIVE"
                  : sourceMode === "simulation"
                    ? "SIMULATION"
                    : "IDLE"}
              </div>

              <div className="rounded-lg border border-white/[.06] bg-black/20 px-3 py-2 text-[10px] text-slate-600">
                RTT{" "}
                <span className="ml-1 text-slate-300">
                  {latency === null ? "—" : `${latency} ms`}
                </span>
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

          <div
            className={`workstation-content ${
              view === "visual" ? "workstation-content-visual" : ""
            }`}
          >
            {view === "overview" ? (
              <OverviewPanel
                status={status}
                streams={streams}
                latency={latency}
                sampleRate={sampleRate}
                sourceMode={sourceMode}
                onNavigate={setView}
              />
            ) : null}

            {view === "acquisition" ? (
              <AcquisitionPanel
                status={status}
                streams={streams}
                samples={samples}
                channelSamples={channelSamples}
                latency={latency}
                sampleRate={sampleRate}
                sourceMode={sourceMode}
                sourceName={sourceName}
                gateway={gateway}
                setGateway={setGateway}
                reconnect={() => setConnectionEpoch((value) => value + 1)}
              />
            ) : null}

            {view === "dataset" ? <DatasetZeroPanel /> : null}
            {view === "experiments" ? (
              <ExperimentsPanel gateway={gateway} />
            ) : null}
            {view === "programs" ? <ResearchProgramsPanel /> : null}
            {view === "models" ? <ModelWorkersPanel samples={samples} /> : null}
            {view === "simulation" ? <SimulationPanel /> : null}
            {view === "public-data" ? <PublicDataPanel /> : null}
            {view === "visual" ? <VisualLab /> : null}
            {view === "system" ? (
              <SystemPanel
                status={status}
                gateway={gateway}
                latency={latency}
                sourceMode={sourceMode}
              />
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
