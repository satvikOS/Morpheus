"use client";

import {
  Activity,
  Cable,
  Cpu,
  Gauge,
  Radio,
  RefreshCw,
  Router,
  Waves,
} from "lucide-react";
import type { GatewayStatus, StreamInfo } from "@/lib/morpheus";
import { Metric, Panel, SectionHeader, StatusDot } from "./ui";

export default function AcquisitionPanel({
  status,
  streams,
  samples,
  channelSamples,
  latency,
  sampleRate,
  sourceMode,
  sourceName,
  gateway,
  setGateway,
  reconnect,
  selectedSourceId,
  setSelectedSourceId,
}: {
  status: GatewayStatus;
  streams: StreamInfo[];
  samples: number[];
  channelSamples: number[][];
  latency: number | null;
  sampleRate: number;
  sourceMode: "live" | "simulation" | "idle";
  sourceName: string;
  gateway: string;
  setGateway: (value: string) => void;
  reconnect: () => void;
  selectedSourceId: string;
  setSelectedSourceId: (value: string) => void;
}) {
  const discoveredChannels = streams.reduce(
    (sum, stream) => sum + Number(stream.channel_count || 0),
    0,
  );
  const visibleChannels = channelSamples.length || 0;
  const rms = samples.length
    ? Math.sqrt(
        samples.reduce((sum, value) => sum + value * value, 0) /
          samples.length,
      )
    : 0;

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Acquisition plane"
          title="Live neural and physiological streams"
          description="Bounded ring buffers decouple high-rate acquisition from React rendering. The UI can inspect up to 16 live channels while the native gateway remains responsible for authoritative recording and synchronization."
          action={
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.16em] text-slate-500">
              <StatusDot online={status.status === "online"} />
              {status.status}
            </div>
          }
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Streams" value={status.streams} />
          <Metric
            label="Channels"
            value={discoveredChannels || visibleChannels}
            detail={visibleChannels ? `${visibleChannels} visible` : "awaiting samples"}
          />
          <Metric
            label="Packet rate"
            value={sampleRate ? `${sampleRate}/s` : "—"}
          />
          <Metric
            label="REST RTT"
            value={latency === null ? "—" : `${latency} ms`}
          />
          <Metric
            label="CH01 RMS"
            value={rms ? rms.toFixed(4) : "—"}
          />
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_.5fr]">
        <Panel>
          <SectionHeader
            eyebrow="Multichannel monitor"
            title={
              sourceMode === "simulation"
                ? "Simulation fallback"
                : sourceName || "Signal monitor"
            }
            description={
              sourceMode === "simulation"
                ? "Synthetic channels are active because no authoritative local stream is connected. They are engineering references, not experimental measurements."
                : "Live packet ingestion is isolated from the viewport cadence to prevent UI rendering from back-pressuring acquisition."
            }
            action={
              <span
                className={`rounded-md border px-2 py-1 text-[9px] font-medium tracking-[.18em] ${
                  sourceMode === "live"
                    ? "border-emerald-300/20 bg-emerald-300/[.05] text-emerald-200"
                    : sourceMode === "simulation"
                      ? "border-amber-300/20 bg-amber-300/[.05] text-amber-200"
                      : "border-white/10 text-slate-600"
                }`}
              >
                {sourceMode.toUpperCase()}
              </span>
            }
          />
          <div className="p-4">
            <MultiChannelScope
              channels={channelSamples.length ? channelSamples : [samples]}
            />
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <SectionHeader eyebrow="Gateway" title="Connection" />
            <div className="space-y-3 p-4">
              <label className="block">
                <span className="mb-2 block text-[10px] uppercase tracking-[.16em] text-slate-600">
                  Endpoint
                </span>
                <input
                  value={gateway}
                  onChange={(event) => setGateway(event.target.value)}
                  className="w-full rounded-lg border border-white/[.08] bg-black/20 px-3 py-2.5 text-xs text-slate-300 outline-none transition focus:border-sky-300/30"
                  placeholder="/api/signal-gateway"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-[10px] uppercase tracking-[.16em] text-slate-600">
                  Stream
                </span>
                <select
                  value={selectedSourceId}
                  onChange={(event) => setSelectedSourceId(event.target.value)}
                  className="w-full rounded-lg border border-white/[.08] bg-black/20 px-3 py-2.5 text-xs text-slate-300 outline-none transition focus:border-sky-300/30"
                >
                  <option value="">Auto select first available</option>
                  {streams.map((stream) => (
                    <option
                      key={stream.source_id || stream.name}
                      value={stream.source_id || stream.name}
                    >
                      {stream.name} · {stream.channel_count} ch · {stream.nominal_srate || "irregular"} Hz
                    </option>
                  ))}
                </select>
              </label>

              <button onClick={reconnect} className="button-primary w-full">
                <RefreshCw size={14} /> Reconnect
              </button>

              <div className="rounded-lg border border-white/[.06] bg-black/15 p-3 text-[11px] leading-5 text-slate-600">
                For real hardware acquisition, use the local Morpheus gateway.
                The hosted service is an orchestration and simulation surface.
              </div>
            </div>
          </Panel>

          <Panel>
            <SectionHeader eyebrow="Transport" title="Pipeline" />
            <div className="space-y-2 p-4">
              {[
                [Radio, "Device", "EEG / physiology"],
                [Cable, "LSL", "clock sync"],
                [Cpu, "Gateway", "native hot path"],
                [Router, "WebSocket", "bounded relay"],
                [Gauge, "Workstation", "30 fps viewport"],
              ].map(([Icon, label, detail]) => {
                const Component = Icon as typeof Activity;
                return (
                  <div
                    key={String(label)}
                    className="flex items-center gap-3 rounded-lg border border-white/[.055] bg-white/[.015] px-3 py-2.5"
                  >
                    <Component size={14} className="text-slate-500" />
                    <div className="min-w-0">
                      <div className="text-xs text-slate-300">
                        {String(label)}
                      </div>
                      <div className="text-[10px] text-slate-650">
                        {String(detail)}
                      </div>
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
          description="Metadata discovered through Lab Streaming Layer."
        />
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[1.3fr_.8fr_.55fr_.7fr_1fr] px-5 py-3 text-[9px] uppercase tracking-[.18em] text-slate-600">
              <span>Name</span>
              <span>Type</span>
              <span>Channels</span>
              <span>Rate</span>
              <span>Source ID</span>
            </div>

            {streams.length ? (
              streams.map((stream) => (
                <div
                  key={stream.source_id || stream.name}
                  className="grid grid-cols-[1.3fr_.8fr_.55fr_.7fr_1fr] border-t border-white/[.055] px-5 py-3 text-xs"
                >
                  <span className="text-slate-200">{stream.name}</span>
                  <span className="text-slate-500">
                    {stream.type || "unknown"}
                  </span>
                  <span className="text-slate-500">
                    {stream.channel_count}
                  </span>
                  <span className="text-slate-500">
                    {stream.nominal_srate
                      ? `${stream.nominal_srate} Hz`
                      : "irregular"}
                  </span>
                  <span className="truncate pr-3 font-mono text-[10px] text-slate-650">
                    {stream.source_id}
                  </span>
                </div>
              ))
            ) : (
              <div className="border-t border-white/[.055] px-5 py-10 text-center text-xs text-slate-600">
                No native LSL streams currently discovered.
              </div>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function MultiChannelScope({ channels }: { channels: number[][] }) {
  const shown = channels.slice(0, 16).filter((channel) => channel.length);
  const source =
    shown.length > 0
      ? shown
      : [
          Array.from(
            { length: 240 },
            (_, index) => Math.sin(index / 7) * 0.2,
          ),
        ];

  const width = 1200;
  const laneHeight = 68;
  const height = Math.max(300, source.length * laneHeight);

  return (
    <div className="signal-grid max-h-[620px] overflow-auto rounded-xl border border-white/[.07] bg-[#04080c] p-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-h-[390px] w-full"
        preserveAspectRatio="none"
      >
        {source.map((channel, channelIndex) => {
          const maxAbs = Math.max(
            0.001,
            ...channel.map((value) => Math.abs(value)),
          );
          const center = channelIndex * laneHeight + laneHeight / 2;
          const points = channel
            .map((value, index) => {
              const x =
                (index / Math.max(1, channel.length - 1)) * width;
              const y =
                center - (value / maxAbs) * (laneHeight * 0.31);
              return `${x},${y}`;
            })
            .join(" ");

          return (
            <g key={channelIndex}>
              <line
                x1="0"
                x2={width}
                y1={center}
                y2={center}
                stroke="#20303c"
                strokeWidth=".7"
              />
              <text
                x="8"
                y={center - 20}
                fill="#617080"
                fontSize="10"
              >
                CH {String(channelIndex + 1).padStart(2, "0")}
              </text>
              <polyline
                fill="none"
                stroke="#8fd8ff"
                strokeOpacity=".72"
                strokeWidth="1.15"
                vectorEffect="non-scaling-stroke"
                points={points}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
