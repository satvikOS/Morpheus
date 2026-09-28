"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  Cpu,
  DatabaseZap,
  HardDrive,
  MonitorUp,
  Network,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import type { GatewayStatus } from "@/lib/morpheus";
import { Panel, SectionHeader, StatusDot } from "./ui";

type WorkstationHealth = {
  service?: string;
  version?: string;
  ok?: boolean;
  probes?: Array<{
    id: string;
    ok: boolean;
    latency_ms: number;
    status?: number;
    error?: string;
  }>;
  capabilities?: Record<string, boolean>;
  timestamp?: string;
};

export default function SystemPanel({
  status,
  gateway,
  latency,
  sourceMode,
}: {
  status: GatewayStatus;
  gateway: string;
  latency: number | null;
  sourceMode: "live" | "simulation" | "idle";
}) {
  const [health, setHealth] = useState<WorkstationHealth | null>(null);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const response = await fetch("/api/system/health", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as WorkstationHealth;
        if (active) setHealth(payload);
      } catch {}
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const capabilities = Object.entries(health?.capabilities ?? {});
  const rows = [
    {
      label: "Next.js workstation",
      value: `Node 24 · Vercel · v${health?.version || "0.3.0"}`,
      ok: health?.ok !== false,
      icon: ServerCog,
    },
    {
      label: "Acquisition gateway",
      value: gateway,
      ok: status.status === "online",
      icon: Network,
    },
    {
      label: "Signal transport",
      value:
        sourceMode === "live"
          ? "WebSocket live"
          : sourceMode === "simulation"
            ? "simulation fallback"
            : "idle",
      ok: sourceMode === "live",
      icon: Cpu,
    },
    {
      label: "Private corpus policy",
      value: "browser/local storage · raw uploads disabled",
      ok: true,
      icon: ShieldCheck,
    },
    {
      label: "Neurovisualization",
      value: "WebGL2 3D texture raycast · NIfTI · MPR",
      ok: true,
      icon: MonitorUp,
    },
    {
      label: "Public data fabric",
      value: "DANDI · OpenNeuro · NeuroVault · Allen · Zenodo",
      ok: Boolean(health?.probes?.find((probe) => probe.id.includes("public-data"))?.ok ?? true),
      icon: DatabaseZap,
    },
    {
      label: "Compute boundary",
      value: "browser DSP + local gateway + staged GPU workers",
      ok: true,
      icon: HardDrive,
    },
  ];

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Diagnostics"
          title="System topology"
          description="The hosted application handles orchestration, visualization, public-data discovery and browser workers. Hardware I/O, authoritative raw recording and future heavyweight inference remain local or on dedicated compute."
          action={
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.16em] text-slate-600">
              <StatusDot online={health?.ok !== false} />
              {health?.ok === false ? "degraded" : "operational"}
            </div>
          }
        />
        <div className="divide-y divide-white/[.055]">
          {rows.map(({ label, value, ok, icon: Icon }) => (
            <div
              key={label}
              className="grid gap-3 px-5 py-4 md:grid-cols-[220px_1fr_auto] md:items-center"
            >
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <Icon size={14} className="text-slate-600" /> {label}
              </div>
              <div className="truncate font-mono text-[10px] text-slate-600">
                {value}
              </div>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.16em] text-slate-600">
                <StatusDot online={ok} />
                {ok ? "ready" : "waiting"}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="p-5">
          <CheckCircle2 size={18} className="text-emerald-300/70" />
          <div className="mt-6 text-sm font-medium">Low-latency boundary</div>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            Preallocated channel ring buffers keep high-rate packets out of React state. The UI samples bounded windows independently of acquisition cadence.
          </p>
        </Panel>

        <Panel className="p-5">
          <CheckCircle2 size={18} className="text-emerald-300/70" />
          <div className="mt-6 text-sm font-medium">Evidence boundary</div>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            Live signals, simulations, engineering scaffolds and scientifically validated outputs are represented as different system states.
          </p>
        </Panel>

        <Panel className="p-5">
          <CircleDashed size={18} className="text-amber-200/70" />
          <div className="mt-6 text-sm font-medium">Native expansion</div>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            XDF/NWB-grade recording, Rust/C++ hot paths, GPU inference services and atlas registration belong in the local/native plane as the research stack matures.
          </p>
        </Panel>
      </div>

      <Panel>
        <SectionHeader
          eyebrow="Capability registry"
          title="Runtime capabilities"
          description="This registry is served by Morpheus itself and can be used for deployment smoke tests."
        />
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          {capabilities.length ? capabilities.map(([key, value]) => (
            <div
              key={key}
              className="rounded-xl border border-white/[.07] bg-black/10 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[10px] text-slate-500">
                  {key.replaceAll("_", " ")}
                </span>
                <StatusDot online={value} />
              </div>
              <div className="mt-4 text-xs text-slate-300">
                {value ? "available" : "unavailable"}
              </div>
            </div>
          )) : (
            <div className="col-span-full rounded-xl border border-white/[.06] bg-black/10 p-6 text-center text-xs text-slate-600">
              Waiting for workstation health registry…
            </div>
          )}
        </div>
      </Panel>

      <Panel>
        <SectionHeader eyebrow="Performance" title="Current transport and render path" />
        <div className="grid gap-3 p-4 md:grid-cols-5">
          {[
            ["Gateway RTT", latency === null ? "—" : `${latency} ms`],
            ["Render path", "WebGL2 GPU"],
            ["Viewport", "UHD capable"],
            ["Client buffering", "bounded"],
            ["Private uploads", "disabled"],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-white/[.07] bg-black/10 p-4"
            >
              <div className="text-[10px] uppercase tracking-[.16em] text-slate-600">
                {label}
              </div>
              <div className="mt-3 font-mono text-sm text-slate-300">{value}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
