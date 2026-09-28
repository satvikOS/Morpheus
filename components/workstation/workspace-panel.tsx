"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import {
  Activity,
  Box,
  CircleDot,
  Maximize2,
  Radio,
  Send,
  ShieldCheck,
} from "lucide-react";
import type { GatewayStatus, StreamInfo, WorkstationView } from "@/lib/morpheus";
import type { SharedSignalRing } from "@/lib/use-signal-engine";
import SignalCanvas from "./signal-canvas";

const VisualLab = dynamic(() => import("@/app/visual-lab"), {
  ssr: false,
  loading: () => (
    <div className="workspace-loading">Initializing spatial engine…</div>
  ),
});

export default function WorkspacePanel({
  ring,
  snapshots,
  packetRate,
  sourceMode,
  sourceName,
  gateway,
  status,
  streams,
  latency,
  dropped,
  onNavigate,
}: {
  ring: SharedSignalRing | null;
  snapshots: number[][];
  packetRate: number;
  sourceMode: "live" | "simulation" | "idle";
  sourceName: string;
  gateway: string;
  status: GatewayStatus;
  streams: StreamInfo[];
  latency: number | null;
  dropped: number;
  onNavigate: (view: WorkstationView) => void;
}) {
  const [markerLabel, setMarkerLabel] = useState("AWAKE_REPORT");
  const [markerState, setMarkerState] = useState("READY");

  const emitMarker = async () => {
    if (markerState === "SENDING") return;
    setMarkerState("SENDING");

    try {
      const response = await fetch(`${gateway.replace(/\/$/, "")}/markers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: markerLabel }),
      });

      const payload = await response.json();
      setMarkerState(
        response.ok && payload.accepted
          ? payload.lsl_emitted
            ? "LSL ACK"
            : "GATEWAY ACK"
          : "FAILED",
      );
    } catch {
      setMarkerState("FAILED");
    }

    window.setTimeout(() => setMarkerState("READY"), 1400);
  };

  const channelCount =
    streams.reduce((sum, stream) => sum + Number(stream.channel_count || 0), 0) ||
    snapshots.length;

  return (
    <div className="workspace-board">
      <section className="workspace-pane workspace-pane-signal">
        <PaneHeader
          icon={Activity}
          title="Live signal plane"
          subtitle={sourceName || "Acquisition monitor"}
          action={() => onNavigate("acquisition")}
        />
        <SignalCanvas
          ring={ring}
          snapshots={snapshots}
          packetRate={packetRate}
          sourceMode={sourceMode}
          sourceName={sourceName}
          compact
        />
      </section>

      <section className="workspace-pane workspace-pane-spatial">
        <PaneHeader
          icon={Box}
          title="Neuro spatial"
          subtitle="Volume / atlas / connectome"
          action={() => onNavigate("visual")}
        />
        <div className="workspace-spatial-inner">
          <VisualLab compact />
        </div>
      </section>

      <section className="workspace-pane workspace-pane-control">
        <PaneHeader
          icon={CircleDot}
          title="Experiment control"
          subtitle="Authoritative marker path"
          action={() => onNavigate("experiments")}
        />
        <div className="workspace-control-body">
          <div className="workspace-marker-grid">
            {["DREAM_ONSET", "AWAKEN", "LUCID_SIGNAL", "REPORT_END"].map(
              (preset) => (
                <button
                  key={preset}
                  className={
                    markerLabel === preset
                      ? "workspace-marker workspace-marker-active"
                      : "workspace-marker"
                  }
                  onClick={() => setMarkerLabel(preset)}
                >
                  {preset}
                </button>
              ),
            )}
          </div>
          <button className="button-primary workspace-emit" onClick={emitMarker}>
            <Send size={13} />
            Emit {markerLabel}
          </button>
          <div className="workspace-marker-state">{markerState}</div>
          <p className="workspace-footnote">
            Browser click time is not used as the experimental timestamp. The gateway
            assigns the authoritative arrival/LSL time.
          </p>
        </div>
      </section>

      <section className="workspace-pane workspace-pane-health">
        <PaneHeader
          icon={ShieldCheck}
          title="System health"
          subtitle="Glanceable experiment-critical state"
          action={() => onNavigate("system")}
        />
        <div className="workspace-health-grid">
          <HealthCell
            label="Gateway"
            value={status.status.toUpperCase()}
            good={status.status === "online"}
          />
          <HealthCell label="Channels" value={String(channelCount)} good={channelCount > 0} />
          <HealthCell
            label="Transport RTT"
            value={latency === null ? "—" : `${latency} ms`}
            good={latency !== null && latency < 100}
          />
          <HealthCell
            label="Packet rate"
            value={packetRate ? `${packetRate}/s` : "—"}
            good={packetRate > 0}
          />
          <HealthCell
            label="Dropped"
            value={String(dropped)}
            good={dropped === 0}
          />
          <HealthCell
            label="Evidence"
            value={
              sourceMode === "live"
                ? "LIVE"
                : sourceMode === "simulation"
                  ? "SIM"
                  : "IDLE"
            }
            good={sourceMode === "live"}
          />
        </div>

        <div className="workspace-health-note">
          <Radio size={13} />
          Critical state remains visible beside acquisition and spatial work; it is no
          longer buried in a separate diagnostics tab.
        </div>
      </section>
    </div>
  );
}

function PaneHeader({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: typeof Activity;
  title: string;
  subtitle: string;
  action: () => void;
}) {
  return (
    <div className="workspace-pane-header">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="workspace-pane-icon">
          <Icon size={14} />
        </span>
        <div className="min-w-0">
          <div className="workspace-pane-title">{title}</div>
          <div className="workspace-pane-subtitle">{subtitle}</div>
        </div>
      </div>
      <button className="button-icon" onClick={action} title={`Open ${title}`}>
        <Maximize2 size={13} />
      </button>
    </div>
  );
}

function HealthCell({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good: boolean;
}) {
  return (
    <div className="workspace-health-cell">
      <div className="workspace-health-label">{label}</div>
      <div className="workspace-health-value">
        <span className={good ? "health-dot health-dot-ok" : "health-dot"} />
        {value}
      </div>
    </div>
  );
}
