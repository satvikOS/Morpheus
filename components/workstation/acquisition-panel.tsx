"use client";

import { Activity, Cable, Cpu, Gauge, Radio, RefreshCw, Router, Waves } from "lucide-react";
import type { GatewayStatus, StreamInfo } from "@/lib/morpheus";
import { Metric, Panel, SectionHeader, StatusDot } from "./ui";

function Waveform({ values }: { values: number[] }) {
  const source = values.length
    ? values
    : Array.from({ length: 180 }, (_, i) => Math.sin(i / 7) * 0.28 + Math.sin(i / 2.9) * 0.07);
  const maxAbs = Math.max(0.001, ...source.map((value) => Math.abs(value)));
  const points = source
    .map((value, index) => {
      const x = (index / Math.max(1, source.length - 1)) * 100;
      const y = 50 - (value / maxAbs) * 34;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
      <line x1="0" x2="100" y1="50" y2="50" stroke="currentColor" strokeOpacity=".12" strokeWidth=".35" />
      <polyline fill="none" stroke="currentColor" strokeWidth="1.05" vectorEffect="non-scaling-stroke" points={points} />
    </svg>
  );
}

export default function AcquisitionPanel({
  status,
  streams,
  samples,
  latency,
  sampleRate,
  sourceMode,
  sourceName,
  gateway,
  setGateway,
  reconnect,
}: {
  status: GatewayStatus;
  streams: StreamInfo[];
  samples: number[];
  latency: number | null;
  sampleRate: number;
  sourceMode: "live" | "simulation" | "idle";
  sourceName: string;
  gateway: string;
  setGateway: (value: string) => void;
  reconnect: () => void;
}) {
  const channels = streams.reduce((sum, stream) => sum + Number(stream.channel_count || 0), 0);
  const rms = samples.length
    ? Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
    : 0;

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Acquisition plane"
          title="Live neural and physiological streams"
          description="Morpheus keeps device I/O and signal acquisition near the hardware. The workstation consumes synchronized metadata and bounded live samples through the gateway."
          action={
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.16em] text-slate-500">
              <StatusDot online={status.status === "online"} />
              {status.status}
            </div>
          }
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Streams" value={status.streams} />
          <Metric label="Channels" value={channels} />
          <Metric label="UI packet rate" value={sampleRate ? `${sampleRate}/s` : "—"} />
          <Metric label="REST RTT" value={latency === null ? "—" : `${latency} ms`} />
          <Metric label="Window RMS" value={rms ? rms.toFixed(4) : "—"} />
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_.5fr]">
        <Panel>
          <SectionHeader
            eyebrow="Realtime monitor"
            title={sourceMode === "simulation" ? "Simulation fallback" : sourceName || "Signal monitor"}
            description={
              sourceMode === "simulation"
                ? "No usable sample WebSocket was available, so the workstation is rendering an explicitly labeled local synthetic trace. It is not experimental data."
                : "The viewport uses a bounded client buffer so the display cannot accumulate unbounded latency."
            }
            action={
              <span className={`rounded-md border px-2 py-1 text-[9px] font-medium tracking-[.18em] ${
                sourceMode === "live"
                  ? "border-emerald-300/20 bg-emerald-300/[.05] text-emerald-200"
                  : sourceMode === "simulation"
                    ? "border-amber-300/20 bg-amber-300/[.05] text-amber-200"
                    : "border-white/10 text-slate-600"
              }`}>
                {sourceMode.toUpperCase()}
              </span>
            }
          />
          <div className="p-4">
            <div className="signal-grid relative h-[390px] overflow-hidden rounded-xl border border-white/[.07] bg-[#05090e] text-sky-300">
              <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-md border border-white/[.06] bg-black/35 px-2 py-1 text-[10px] text-slate-500 backdrop-blur">
                <Waves size={12} /> CH 01
              </div>
              <div className="absolute bottom-3 right-3 z-10 text-[9px] uppercase tracking-[.18em] text-slate-700">bounded · 240 samples</div>
              <div className="h-full w-full p-3"><Waveform values={samples} /></div>
            </div>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <SectionHeader eyebrow="Gateway" title="Connection" />
            <div className="space-y-3 p-4">
              <label className="block">
                <span className="mb-2 block text-[10px] uppercase tracking-[.16em] text-slate-600">Endpoint</span>
                <input
                  value={gateway}
                  onChange={(event) => setGateway(event.target.value)}
                  className="w-full rounded-lg border border-white/[.08] bg-black/20 px-3 py-2.5 text-xs text-slate-300 outline-none transition focus:border-sky-300/30"
                  placeholder="/api/signal-gateway"
                />
              </label>
              <button onClick={reconnect} className="button-primary w-full">
                <RefreshCw size={14} /> Reconnect
              </button>
              <div className="rounded-lg border border-white/[.06] bg-black/15 p-3 text-[11px] leading-5 text-slate-600">
                For hardware work, point this at the local Morpheus gateway. Keep raw acquisition off the public internet.
              </div>
            </div>
          </Panel>

          <Panel>
            <SectionHeader eyebrow="Transport" title="Pipeline" />
            <div className="space-y-2 p-4">
              {[
                [Radio, "Device", "EEG / physiology"],
                [Cable, "LSL", "clocked transport"],
                [Cpu, "Gateway", "native processing"],
                [Router, "WebSocket", "bounded UI relay"],
                [Gauge, "Workstation", "monitor + control"],
              ].map(([Icon, label, detail]) => {
                const Component = Icon as typeof Activity;
                return (
                  <div key={String(label)} className="flex items-center gap-3 rounded-lg border border-white/[.055] bg-white/[.015] px-3 py-2.5">
                    <Component size={14} className="text-slate-500" />
                    <div className="min-w-0">
                      <div className="text-xs text-slate-300">{String(label)}</div>
                      <div className="text-[10px] text-slate-650">{String(detail)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>

      <Panel>
        <SectionHeader eyebrow="Discovery" title="Available streams" description="Metadata discovered through Lab Streaming Layer." />
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[1.3fr_.8fr_.55fr_.7fr_1fr] px-5 py-3 text-[9px] uppercase tracking-[.18em] text-slate-600">
              <span>Name</span><span>Type</span><span>Channels</span><span>Rate</span><span>Source ID</span>
            </div>
            {streams.length ? streams.map((stream) => (
              <div key={stream.source_id || stream.name} className="grid grid-cols-[1.3fr_.8fr_.55fr_.7fr_1fr] border-t border-white/[.055] px-5 py-3 text-xs">
                <span className="text-slate-200">{stream.name}</span>
                <span className="text-slate-500">{stream.type || "unknown"}</span>
                <span className="text-slate-500">{stream.channel_count}</span>
                <span className="text-slate-500">{stream.nominal_srate ? `${stream.nominal_srate} Hz` : "irregular"}</span>
                <span className="truncate pr-3 font-mono text-[10px] text-slate-650">{stream.source_id}</span>
              </div>
            )) : (
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
