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
import { SignalWorkerClient, type SignalAnalysis } from "@/lib/worker-client";
import { Metric, Panel, SectionHeader, StatusDot } from "./ui";

const engines = [
  {
    name: "Signal DSP Worker",
    kind: "Browser Worker",
    status: "READY",
    body: "Time-domain metrics and spectral band estimation off the React main thread.",
    icon: Activity,
  },
  {
    name: "Feature Extraction Worker",
    kind: "Browser Worker",
    status: "READY",
    body: "Feature runtime boundary for embeddings, event windows and compact model inputs.",
    icon: Sparkles,
  },
  {
    name: "Neural Inference Worker",
    kind: "Local/GPU",
    status: "STAGED",
    body: "Reserved for subject-specific decoders. Models are not shipped until validated checkpoints exist.",
    icon: BrainCircuit,
  },
  {
    name: "Volume Compute Worker",
    kind: "GPU",
    status: "STAGED",
    body: "Target backend for volumetric preprocessing, ray-casting support and atlas transforms.",
    icon: Microchip,
  },
  {
    name: "Gateway Model Service",
    kind: "Native",
    status: "STAGED",
    body: "Long-running native workers belong beside the acquisition node rather than inside Vercel functions.",
    icon: ServerCog,
  },
];

export default function ModelWorkersPanel({ samples }: { samples: number[] }) {
  const worker = useRef<SignalWorkerClient | null>(null);
  const [analysis, setAnalysis] = useState<SignalAnalysis | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    worker.current = new SignalWorkerClient();
    worker.current.start();
    return () => worker.current?.stop();
  }, []);

  const analyze = async () => {
    if (!samples.length || running) return;
    setRunning(true);
    try {
      const result = await worker.current?.analyze(samples, 256);
      if (result) {
        setAnalysis(result.metrics);
        setLatency(result.latencyMs);
      }
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (!auto || samples.length < 32) return;
    const timer = window.setInterval(() => void analyze(), 1400);
    return () => window.clearInterval(timer);
  }, [auto, samples]);

  const dominant = useMemo(() => {
    if (!analysis) return "—";
    const entries = Object.entries(analysis.bands);
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0]?.toUpperCase() || "—";
  }, [analysis]);

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Compute fabric"
          title="Model and signal workers"
          description="Morpheus separates high-frequency analysis from the UI thread. Browser workers handle lightweight DSP now; validated neural models and heavy volumetric compute are staged for the local/GPU worker plane."
          action={
            <button onClick={() => setAuto((value) => !value)} className="button-secondary">
              <StatusDot online={auto} /> Auto analysis {auto ? "on" : "off"}
            </button>
          }
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Worker backend" value="Web Worker" detail="main-thread isolated" />
          <Metric label="Analysis latency" value={latency === null ? "—" : `${latency.toFixed(1)} ms`} />
          <Metric label="RMS" value={analysis ? analysis.rms.toFixed(4) : "—"} />
          <Metric label="Peak" value={analysis ? analysis.peak.toFixed(4) : "—"} />
          <Metric label="Dominant band" value={dominant} detail="reference spectral estimate" />
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <Panel>
          <SectionHeader eyebrow="Runtime registry" title="Worker engines" />
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {engines.map(({ name, kind, status, body, icon: Icon }) => (
              <div key={name} className="rounded-xl border border-white/[.07] bg-black/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[.07] bg-black/20 text-slate-500">
                    <Icon size={16} />
                  </span>
                  <span className={status === "READY" ? "tag" : "tag-muted"}>{status}</span>
                </div>
                <div className="mt-5 text-sm font-medium text-slate-200">{name}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[.15em] text-slate-650">{kind}</div>
                <p className="mt-3 text-xs leading-5 text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionHeader
            eyebrow="Reference DSP"
            title="Spectral analysis"
            action={
              <button onClick={() => void analyze()} className="button-primary" disabled={running || !samples.length}>
                {running ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
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
                    <span>{band}</span><span>{(value * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[.04]">
                    <div className="h-full rounded-full bg-sky-300/55" style={{ width: `${Math.max(1, value * 100)}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="mt-5 rounded-xl border border-white/[.06] bg-black/15 p-3">
              <div className="flex items-center gap-2 text-xs text-slate-400"><Gauge size={13}/> Reference only</div>
              <p className="mt-2 text-[11px] leading-5 text-slate-650">
                These bands are a lightweight workstation diagnostic, not a clinical interpretation or a dream-state decoder.
              </p>
            </div>
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHeader eyebrow="Compute policy" title="Where work runs" />
        <div className="grid gap-3 p-4 lg:grid-cols-3">
          {[
            ["Browser", "Rendering, interaction, lightweight DSP and local record hashing.", Cpu],
            ["Gateway", "Acquisition, synchronization, recording, preprocessing and native adapters.", ServerCog],
            ["GPU worker", "Validated model inference, high-density volume operations and reconstruction workloads.", Microchip],
          ].map(([title, body, Icon]) => {
            const Component = Icon as typeof Cpu;
            return (
              <div key={String(title)} className="rounded-xl border border-white/[.07] bg-black/10 p-4">
                <Component size={16} className="text-slate-500" />
                <div className="mt-5 text-sm font-medium text-slate-200">{String(title)}</div>
                <p className="mt-2 text-xs leading-5 text-slate-600">{String(body)}</p>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
