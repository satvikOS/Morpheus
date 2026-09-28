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
  TimerReset,
} from "lucide-react";
import type { GatewayStatus, StreamInfo, WorkstationView } from "@/lib/morpheus";
import type {
  ClockSyncState,
  SharedSignalRing,
  SignalEngineState,
} from "@/lib/use-signal-engine";
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
  status,
  streams,
  latency,
  dropped,
  clockSync,
  emitMarker,
  active,
  onNavigate,
}: {
  ring: SharedSignalRing | null;
  snapshots: number[][];
  packetRate: number;
  sourceMode: "live" | "simulation" | "idle";
  sourceName: string;
  status: GatewayStatus;
  streams: StreamInfo[];
  latency: number | null;
  dropped: number;
  clockSync: ClockSyncState;
  emitMarker: SignalEngineState["emitMarker"];
  active: boolean;
  onNavigate: (view: WorkstationView) => void;
}) {
  const [markerLabel, setMarkerLabel] = useState("AWAKE_REPORT");
  const [markerState, setMarkerState] = useState("READY");
  const [markerArmed, setMarkerArmed] = useState(false);

  const primaryStream = streams[0];
  const nominalRate =
    Number(primaryStream?.nominal_srate || 0) || packetRate || 256;

  const emit = async () => {
    if (markerState === "SENDING" || !markerArmed) return;
    setMarkerState("SENDING");

    const result = await emitMarker(markerLabel);

    if (result.accepted) {
      const method = result.marker?.timestamp_method;
      setMarkerState(
        result.transport === "webrtc-control"
          ? method === "browser_event_mapped_to_gateway_clock"
            ? "SYNC ACK"
            : "ARRIVAL ACK"
          : "HTTP ACK",
      );
    } else {
      setMarkerState("FAILED");
    }

    window.setTimeout(() => setMarkerState("READY"), 1400);
  };

  const channelCount =
    streams.reduce(
      (sum, stream) => sum + Number(stream.channel_count || 0),
      0,
    ) || snapshots.length;

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
          sampleRate={nominalRate}
          sourceMode={sourceMode}
          sourceName={sourceName}
          channelLabels={primaryStream?.channel_labels || []}
          channelUnit={primaryStream?.channel_units?.[0] || ""}
          compact
          active={active}
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
          <VisualLab compact active={active} />
        </div>
      </section>

      <section className="workspace-pane workspace-pane-control">
        <PaneHeader
          icon={CircleDot}
          title="Experiment control"
          subtitle="Synchronized control path"
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

          <div className="workspace-action-row">
            <button
              className={
                markerArmed ? "mode-pill mode-pill-live" : "mode-pill"
              }
              onClick={() => setMarkerArmed((value) => !value)}
            >
              {markerArmed ? "MARKERS ARMED" : "ARM MARKERS"}
            </button>
            <button
              className="button-primary workspace-emit"
              onClick={emit}
              disabled={!markerArmed || markerState === "SENDING"}
            >
              <Send size={13} />
              {markerArmed ? `Emit ${markerLabel}` : "Arm first"}
            </button>
            <div className="workspace-marker-state">{markerState}</div>
          </div>

          <div className="workspace-clock-line">
            <TimerReset size={12} />
            <span>
              {clockSync.ready
                ? `Gateway clock mapped · ±${clockSync.uncertaintyMs?.toFixed(2) ?? "—"} ms`
                : "Gateway clock not synchronized"}
            </span>
          </div>

          <p className="workspace-footnote">
            The click event is timestamped on the browser monotonic clock and mapped
            into the gateway clock domain before transmission when synchronization
            quality is acceptable. Gateway arrival time is retained as a fallback,
            not silently substituted.
          </p>
        </div>
      </section>

      <section className="workspace-pane workspace-pane-health">
        <PaneHeader
          icon={ShieldCheck}
          title="System health"
          subtitle="Experiment-critical state"
          action={() => onNavigate("system")}
        />
        <div className="workspace-health-grid">
          <HealthCell
            label="Gateway"
            value={status.status.toUpperCase()}
            good={status.status === "online"}
          />
          <HealthCell
            label="Channels"
            value={String(channelCount)}
            good={channelCount > 0}
          />
          <HealthCell
            label="Control RTT"
            value={latency === null ? "—" : `${latency} ms`}
            good={latency !== null && latency < 100}
          />
          <HealthCell
            label="Clock uncertainty"
            value={
              clockSync.ready
                ? `±${clockSync.uncertaintyMs?.toFixed(2) ?? "—"} ms`
                : "UNSYNC"
            }
            good={
              clockSync.ready &&
              (clockSync.uncertaintyMs ?? Infinity) <= 5
            }
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
          Critical transport, timing, and evidence state is duplicated in the
          persistent global header so a pane cannot hide an acquisition fault.
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
      <button
        className="button-icon"
        onClick={action}
        title={`Open ${title}`}
      >
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
        <span
          className={good ? "health-dot health-dot-ok" : "health-dot"}
        />
        {value}
      </div>
    </div>
  );
}
