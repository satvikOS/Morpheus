"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BrainCircuit,
  Cpu,
  Gauge,
  Microchip,
  Play,
  RefreshCw,
  ServerCog,
  Sparkles,
} from "lucide-react";
import {
  SignalWorkerClient,
  type SignalAnalysis,
} from "@/lib/worker-client";
import { Metric, Panel, SectionHeader, StatusDot } from "./ui";

const engines = [
  {
    name: "Signal DSP Worker",
    kind: "Browser Worker",
    status: "READY",
    body: "Multichannel time-domain, spectral and signal-quality metrics off the React main thread.",
    icon: Activity,
  },
  {
    name: "Feature Extraction Worker",
    kind: "Browser Worker",
    status: "READY",
    body: "Runtime boundary for event windows, compact features and future representation models.",
    icon: Sparkles,
  },
  {
    name: "Neural Inference Worker",
    kind: "Local/GPU",
    status: "STAGED",
    body: "Reserved for validated subject-specific decoders and reconstruction models.",
    icon: BrainCircuit,
  },
  {
    name: "Volume Compute Worker",
    kind: "GPU",
    status: "STAGED",
    body: "Target backend for high-cost volume preprocessing, registration and future WebGPU compute.",
    icon: Microchip,
  },
  {
    name: "Gateway Model Service",
    kind: "Native",
    status: "STAGED",
    body: "Long-running native workers stay beside acquisition and dedicated compute rather than serverless functions.",
    icon: ServerCog,
  },
];

export default function ModelWorkersPanel({
  samples,
  channelSamples,
}: {
  samples: number[];
  channelSamples: number[][];
}) {
  const worker = useRef<SignalWorkerClient | null>(null);
  const [analysis, setAnalysis] = useState<SignalAnalysis | null>(null);
  const [channelAnalysis, setChannelAnalysis] = useState<SignalAnalysis[]>([]);
  const [latency, setLatency] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    worker.current = new SignalWorkerClient();
    worker.current.start();
    return () => worker.current?.stop();
  }, []);

  const analyze = async () => {
    const source = channelSamples.length ? channelSamples : samples.length ? [samples] : [];
    if (!source.length || running) return;

    setRunning(true);
    try {
      const result = await worker.current?.analyzeChannels(source, 256);
      if (result) {
        setAnalysis(result.metrics);
        setChannelAnalysis(result.channels);
        setLatency(result.latencyMs);
      }
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    const available =
      channelSamples.some((channel) => channel.length >= 32) || samples.length >= 32;
    if (!auto || !available) return;

    const timer = window.setInterval(() => void analyze(), 1400);
    return () => window.clearInterval(timer);
  }, [auto, channelSamples, samples]);

  const dominant = useMemo(() => {
    if (!analysis) return "—";
    const entries = Object.entries(analysis.bands).sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0]?.toUpperCase() || "—";
  }, [analysis]);

  const quality = useMemo(() => {
    if (!analysis) return "—";
    if (analysis.flatlineRatio > 0.25) return "FLATLINE RISK";
    if (analysis.clippingRatio > 0.05) return "CLIPPING";
    return "NOMINAL";
  }, [analysis]);

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Compute fabric"
          title="Model and signal workers"
          description="Morpheus isolates lightweight multichannel DSP in browser workers now, while keeping future validated inference and heavy GPU compute behind explicit local/native worker boundaries."
          action={
            <button
              onClick={() => setAuto((value) => !value)}
              className="button-secondary"
            >
              <StatusDot online={auto} /> Auto analysis {auto ? "on" : "off"}
            </button>
          }
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label="Worker backend" value="Web Worker" detail="main-thread isolated" />
          <Metric label="Channels" value={channelAnalysis.length || channelSamples.length || 1} />
          <Metric
            label="Analysis latency"
            value={latency === null ? "—" : `${latency.toFixed(1)} ms`}
          />
          <Metric label="Mean RMS" value={analysis ? analysis.rms.toFixed(4) : "—"} />
          <Metric label="Peak" value={analysis ? analysis.peak.toFixed(4) : "—"} />
          <Metric label="Quality" value={quality} detail={dominant === "—" ? "" : `dominant ${dominant}`} />
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <Panel>
          <SectionHeader eyebrow="Runtime registry" title="Worker engines" />
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {engines.map(({ name, kind, status, body, icon: Icon }) => (
              <div
                key={name}
                className="rounded-xl border border-white/[.07] bg-black/10 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[.07] bg-black/20 text-slate-500">
                    <Icon size={16} />
                  </span>
                  <span className={status === "READY" ? "tag" : "tag-muted"}>
                    {status}
                  </span>
                </div>
                <div className="mt-5 text-sm font-medium text-slate-200">{name}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[.15em] text-slate-650">
                  {kind}
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionHeader
            eyebrow="Reference DSP"
            title="Aggregate spectral analysis"
            action={
              <button
                onClick={() => void analyze()}
                className="button-primary"
                disabled={running || (!samples.length && !channelSamples.length)}
              >
                {running ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Play size={13} />
                )}
                Analyze
              </button>
            }
          />
          <div className="space-y-3 p-4">
            {["delta", "theta", "alpha", "beta", "gamma"].map((band) => {
              const value = analysis?.bands?.[band] ?? 0;
              return (
                <div key={band}>
                  <div className="mb-1.5 flex justify-between text-[10px] uppercase tracking-[.13em] text-slate-600">
                    <span>{band}</span>
                    <span>{(value * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[.04]">
                    <div
                      className="h-full rounded-full bg-sky-300/55"
                      style={{ width: `${Math.max(1, value * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}

            <div className="mt-5 rounded-xl border border-white/[.06] bg-black/15 p-3">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Gauge size={13} /> Engineering diagnostic
              </div>
              <p className="mt-2 text-[11px] leading-5 text-slate-650">
                Band fractions and quality flags are lightweight signal diagnostics.
                They are not clinical interpretations and are not dream-state decoders.
              </p>
            </div>
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHeader
          eyebrow="Channel quality"
          title="Multichannel worker output"
          description="Per-channel metrics make flatline/clipping failures visible before higher-level models consume the signal."
          action={<span className="tag-muted">{channelAnalysis.length} CHANNELS</span>}
        />
        {channelAnalysis.length ? (
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[90px_1fr_1fr_1fr_1fr_1fr] px-5 py-3 text-[9px] uppercase tracking-[.16em] text-slate-600">
                <span>Channel</span>
                <span>RMS</span>
                <span>Peak</span>
                <span>Flatline</span>
                <span>Clipping</span>
                <span>Dominant</span>
              </div>
              {channelAnalysis.map((channel, index) => {
                const dominantBand =
                  Object.entries(channel.bands).sort((a, b) => b[1] - a[1])[0]?.[0]?.toUpperCase() || "—";

                return (
                  <div
                    key={index}
                    className="grid grid-cols-[90px_1fr_1fr_1fr_1fr_1fr] border-t border-white/[.055] px-5 py-3 font-mono text-[10px] text-slate-500"
                  >
                    <span className="text-sky-200">CH {String(index + 1).padStart(2, "0")}</span>
                    <span>{channel.rms.toFixed(4)}</span>
                    <span>{channel.peak.toFixed(4)}</span>
                    <span>{(channel.flatlineRatio * 100).toFixed(2)}%</span>
                    <span>{(channel.clippingRatio * 100).toFixed(2)}%</span>
                    <span>{dominantBand}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="px-5 py-10 text-center text-xs text-slate-600">
            Waiting for enough samples to analyze.
          </div>
        )}
      </Panel>

      <Panel>
        <SectionHeader eyebrow="Compute policy" title="Where work runs" />
        <div className="grid gap-3 p-4 lg:grid-cols-3">
          {[
            [
              "Browser",
              "Rendering, interaction, lightweight DSP and local record hashing.",
              Cpu,
            ],
            [
              "Gateway",
              "Acquisition, synchronization, local recording, preprocessing and native device adapters.",
              ServerCog,
            ],
            [
              "GPU worker",
              "Validated model inference, registration, high-density volume operations and reconstruction workloads.",
              Microchip,
            ],
          ].map(([title, body, Icon]) => {
            const Component = Icon as typeof Cpu;
            return (
              <div
                key={String(title)}
                className="rounded-xl border border-white/[.07] bg-black/10 p-4"
              >
                <Component size={16} className="text-slate-500" />
                <div className="mt-5 text-sm font-medium text-slate-200">
                  {String(title)}
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  {String(body)}
                </p>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
