"use client";

import {
  Activity,
  BrainCircuit,
  Database,
  FlaskConical,
  Radio,
  ScanSearch,
  Sparkles,
  Waypoints,
} from "lucide-react";
import type { GatewayStatus, StreamInfo, WorkstationView } from "@/lib/morpheus";
import { Metric, Panel, SectionHeader, StatusDot } from "./ui";

export default function OverviewPanel({
  status,
  streams,
  latency,
  sampleRate,
  sourceMode,
  onNavigate,
}: {
  status: GatewayStatus;
  streams: StreamInfo[];
  latency: number | null;
  sampleRate: number;
  sourceMode: "live" | "simulation" | "idle";
  onNavigate: (view: WorkstationView) => void;
}) {
  const channelCount = streams.reduce((total, stream) => total + (stream.channel_count || 0), 0);
  const modules = [
    {
      title: "Acquisition",
      body: "Discover LSL sources, inspect channel topology, measure transport latency, and monitor the live signal plane.",
      icon: Radio,
      view: "acquisition" as const,
      state: status.status === "online" ? "READY" : "LOCAL",
    },
    {
      title: "Dataset Zero",
      body: "Capture raw dream reports, seal originals with SHA-256, preserve provenance, and export machine-readable records.",
      icon: Database,
      view: "dataset" as const,
      state: "LOCAL FIRST",
    },
    {
      title: "Experiment Control",
      body: "Timestamp experimental markers and operate the staged M0–M5 research program without collapsing hypotheses into claims.",
      icon: FlaskConical,
      view: "experiments" as const,
      state: "M0 ACTIVE",
    },
    {
      title: "Public Neurodata",
      body: "Search the DANDI open neuroscience archive from inside Morpheus and stage datasets for baseline work.",
      icon: ScanSearch,
      view: "public-data" as const,
      state: "LIVE API",
    },
    {
      title: "3D Visual Space",
      body: "GPU workspace for latent geometry, point clouds, scene reconstruction, spatial annotations, and future volumetric overlays.",
      icon: Sparkles,
      view: "visual" as const,
      state: "WEBGL",
    },
    {
      title: "Neural Atlas",
      body: "The future subject-specific alignment layer connecting perception, imagery, sleep states, and decoded latent representations.",
      icon: BrainCircuit,
      view: "experiments" as const,
      state: "ROADMAP",
    },
  ];

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Command layer"
          title="Morpheus Research Workstation"
          description="A local-first neural research environment. The hosted interface coordinates acquisition, evidence, experiments, open datasets, and spatial reconstruction; latency-critical sensor work stays close to the hardware."
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Gateway" value={status.status.toUpperCase()} detail={status.status === "online" ? "acquisition plane reachable" : "waiting for gateway"} />
          <Metric label="Signal mode" value={sourceMode.toUpperCase()} detail={sourceMode === "simulation" ? "clearly marked fallback" : "stream source"} />
          <Metric label="Channels" value={channelCount} detail={`${streams.length} discovered streams`} />
          <Metric label="Transport" value={latency === null ? "—" : `${latency} ms`} detail={sampleRate ? `~${sampleRate} packets/s UI` : "REST round trip"} />
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <Panel>
          <SectionHeader eyebrow="Subsystem map" title="Operational surfaces" />
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {modules.map(({ title, body, icon: Icon, view, state }) => (
              <button
                key={title}
                onClick={() => onNavigate(view)}
                className="group min-h-48 rounded-xl border border-white/[.07] bg-white/[.018] p-4 text-left transition hover:border-sky-300/25 hover:bg-white/[.035]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[.08] bg-black/20 text-slate-400 transition group-hover:text-sky-200">
                    <Icon size={17} />
                  </span>
                  <span className="rounded-md border border-white/[.07] px-2 py-1 text-[9px] tracking-[.16em] text-slate-600">{state}</span>
                </div>
                <div className="mt-7 text-sm font-medium text-slate-200">{title}</div>
                <p className="mt-2 text-xs leading-5 text-slate-600">{body}</p>
              </button>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionHeader eyebrow="System state" title="Research integrity" />
          <div className="space-y-3 p-4">
            {[
              ["Raw reports remain local", true],
              ["SHA-256 provenance available", true],
              ["Public data reads are unauthenticated", true],
              ["Invasive intervention layer", false],
              ["Historical reconstruction validated", false],
            ].map(([label, enabled]) => (
              <div key={String(label)} className="flex items-center justify-between rounded-xl border border-white/[.06] bg-black/10 px-3 py-3 text-xs">
                <span className="text-slate-400">{String(label)}</span>
                <span className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-600">
                  <StatusDot online={Boolean(enabled)} />
                  {enabled ? "active" : "not claimed"}
                </span>
              </div>
            ))}
            <div className="rounded-xl border border-sky-300/10 bg-sky-300/[.035] p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-sky-100"><Waypoints size={14} /> Evidence rule</div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Radical hypotheses are preserved as hypotheses. Every promotion in the roadmap requires measurable variables, a null, provenance, and held-out evaluation.
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
