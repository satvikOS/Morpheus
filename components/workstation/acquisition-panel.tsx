"use client";

import {
  Activity,
  Cable,
  Cpu,
  Gauge,
  Radio,
  RefreshCw,
  Router,
  ShieldAlert,
} from "lucide-react";
import type { GatewayStatus, StreamInfo } from "@/lib/morpheus";
import type { SharedSignalRing } from "@/lib/use-signal-engine";
import SignalCanvas from "./signal-canvas";
import { Metric, Panel, SectionHeader, StatusDot } from "./ui";

export default function AcquisitionPanel({
  status,
  streams,
  samples,
  channelSamples,
  ring,
  latency,
  sampleRate,
  sourceMode,
  sourceName,
  gateway,
  setGateway,
  reconnect,
  selectedSourceId,
  setSelectedSourceId,
  dropped,
  transport,
  sharedMemory,
  active,
}: {
  status: GatewayStatus;
  streams: StreamInfo[];
  samples: number[];
  channelSamples: number[][];
  ring: SharedSignalRing | null;
  latency: number | null;
  sampleRate: number;
  sourceMode: "live" | "simulation" | "idle";
  sourceName: string;
  gateway: string;
  setGateway: (value: string) => void;
  reconnect: () => void;
  selectedSourceId: string;
  setSelectedSourceId: (value: string) => void;
  dropped: number;
  transport: string;
  sharedMemory: boolean;
  active: boolean;
}) {
  const discoveredChannels = streams.reduce(
    (sum, stream) => sum + Number(stream.channel_count || 0),
    0,
  );
  const visibleChannels = channelSamples.length || 0;
  const selectedStream =
    streams.find(
      (stream) =>
        (stream.source_id || stream.name) === selectedSourceId,
    ) || streams[0];
  const nominalSampleRate =
    Number(selectedStream?.nominal_srate || 0) || sampleRate || 256;
  const rms = samples.length
    ? Math.sqrt(
        samples.reduce((sum, value) => sum + value * value, 0) /
          samples.length,
      )
    : 0;

  return (
    <div className="space-y-4">
      {sourceMode === "simulation" ? (
        <div className="simulation-callout">
          <ShieldAlert size={16} />
          <div>
            <strong>Simulation evidence boundary</strong>
            <span>
              The waveform below is synthetic engineering data. It is intentionally
              segregated from experimental ground truth and cannot be sealed as a live
              acquisition.
            </span>
          </div>
        </div>
      ) : null}

      <Panel>
        <SectionHeader
          eyebrow="Acquisition plane"
          title="Live neural and physiological streams"
          description="High-rate packets are ingested in a dedicated Worker. When cross-origin isolation is available, the Worker writes directly into SharedArrayBuffer ring memory while the WebGL2 scope reads it without routing each frame through React."
          action={
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.16em] text-slate-500">
              <StatusDot online={status.status === "online"} />
              {status.status}
            </div>
          }
        />
        <div className="metric-grid metric-grid-six">
          <Metric label="Streams" value={status.streams} />
          <Metric
            label="Channels"
            value={discoveredChannels || visibleChannels}
            detail={visibleChannels ? `${visibleChannels} rendered` : "awaiting samples"}
          />
          <Metric
            label="Packet rate"
            value={sampleRate ? `${sampleRate}/s` : "—"}
          />
          <Metric
            label="REST RTT"
            value={latency === null ? "—" : `${latency} ms`}
          />
          <Metric label="Data gaps" value={dropped} detail="missing packets + invalid frames" />
          <Metric
            label="Memory path"
            value={sharedMemory ? "SAB" : "FALLBACK"}
            detail={sharedMemory ? "zero-copy browser ring" : "snapshot relay"}
          />
        </div>
      </Panel>

      <div className="acquisition-layout">
        <Panel className="overflow-hidden">
          <SectionHeader
            eyebrow="Multichannel monitor"
            title={
              sourceMode === "simulation"
                ? "Simulation fallback"
                : sourceName || "Signal monitor"
            }
            description="The signal scope is rendered by a dedicated OffscreenCanvas WebGL2 worker reading shared ring memory. Min/max envelope decimation preserves narrow transients when source density exceeds screen pixel density."
            action={
              <span
                className={
                  sourceMode === "live"
                    ? "mode-pill mode-pill-live"
                    : sourceMode === "simulation"
                      ? "mode-pill mode-pill-simulation"
                      : "mode-pill"
                }
              >
                {sourceMode.toUpperCase()}
              </span>
            }
          />
          <SignalCanvas
            ring={ring}
            snapshots={channelSamples.length ? channelSamples : samples.length ? [samples] : []}
            sampleRate={nominalSampleRate}
            sourceMode={sourceMode}
            sourceName={sourceName}
            channelLabels={selectedStream?.channel_labels || []}
            channelUnit={selectedStream?.channel_units?.[0] || ""}
            active={active}
          />
        </Panel>

        <div className="space-y-4">
          <Panel>
            <SectionHeader eyebrow="Gateway" title="Connection" />
            <div className="space-y-3 p-4">
              <label className="field-label">
                <span>Endpoint</span>
                <input
                  value={gateway}
                  onChange={(event) => setGateway(event.target.value)}
                  className="field-control"
                  placeholder="/api/signal-gateway"
                />
              </label>

              <label className="field-label">
                <span>Stream</span>
                <select
                  value={selectedSourceId}
                  onChange={(event) => setSelectedSourceId(event.target.value)}
                  className="field-control"
                >
                  <option value="">Auto select first available</option>
                  {streams.map((stream) => (
                    <option
                      key={stream.source_id || stream.name}
                      value={stream.source_id || stream.name}
                    >
                      {stream.name} · {stream.channel_count} ch ·{" "}
                      {stream.nominal_srate || "irregular"} Hz
                    </option>
                  ))}
                </select>
              </label>

              <button onClick={reconnect} className="button-primary w-full">
                <RefreshCw size={14} /> Reconnect transport
              </button>

              <div className="connection-summary">
                <div>
                  <span>Transport</span>
                  <strong>{transport || "—"}</strong>
                </div>
                <div>
                  <span>CH01 RMS</span>
                  <strong>{rms ? rms.toFixed(4) : "—"}</strong>
                </div>
              </div>

              <div className="operator-note">
                Real sensor I/O and authoritative recording run on the local Morpheus
                gateway. The hosted interface is the orchestration and rendering client.
              </div>
            </div>
          </Panel>

          <Panel>
            <SectionHeader eyebrow="Transport" title="Clock & compute path" />
            <div className="transport-stack">
              {[
                [Radio, "Device", "hardware clock / source units"],
                [Cable, "LSL", "time correction + source timestamps"],
                [Cpu, "Gateway", "native/local acquisition boundary"],
                [Router, "Worker relay", sharedMemory ? "SharedArrayBuffer ring" : "bounded snapshots"],
                [Gauge, "WebGL2", "independent 60 fps scope"],
              ].map(([Icon, label, detail]) => {
                const Component = Icon as typeof Activity;
                return (
                  <div key={String(label)} className="transport-row">
                    <Component size={14} />
                    <div>
                      <strong>{String(label)}</strong>
                      <span>{String(detail)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>

      <Panel>
        <SectionHeader
          eyebrow="Discovery"
          title="Available streams"
          description="Metadata discovered from the local Lab Streaming Layer domain. No stream is treated as authoritative until it is explicitly selected or acquired."
        />
        <div className="stream-table">
          <div className="stream-table-head">
            <span>Name</span>
            <span>Type</span>
            <span>Channels</span>
            <span>Rate</span>
            <span>Source ID</span>
          </div>

          {streams.length ? (
            streams.map((stream) => (
              <button
                key={stream.source_id || stream.name}
                className={
                  selectedSourceId === (stream.source_id || stream.name)
                    ? "stream-table-row stream-table-row-active"
                    : "stream-table-row"
                }
                onClick={() => setSelectedSourceId(stream.source_id || stream.name)}
              >
                <span>{stream.name}</span>
                <span>{stream.type || "unknown"}</span>
                <span>{stream.channel_count}</span>
                <span>
                  {stream.nominal_srate ? `${stream.nominal_srate} Hz` : "irregular"}
                </span>
                <span className="font-mono">{stream.source_id}</span>
              </button>
            ))
          ) : (
            <div className="stream-empty">
              No native LSL streams discovered. The workstation remains in explicit
              simulation mode until a local source is available.
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
