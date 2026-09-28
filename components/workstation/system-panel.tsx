"use client";

import { CheckCircle2, CircleDashed, Cpu, HardDrive, Network, ServerCog, ShieldCheck } from "lucide-react";
import type { GatewayStatus } from "@/lib/morpheus";
import { Panel, SectionHeader, StatusDot } from "./ui";

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
  const rows = [
    { label: "Next.js workstation", value: "Node 24 · Vercel", ok: true, icon: ServerCog },
    { label: "Acquisition gateway", value: gateway, ok: status.status === "online", icon: Network },
    { label: "Signal transport", value: sourceMode === "live" ? "WebSocket live" : sourceMode === "simulation" ? "simulation fallback" : "idle", ok: sourceMode === "live", icon: Cpu },
    { label: "Private corpus policy", value: "browser/local storage", ok: true, icon: ShieldCheck },
    { label: "Heavy processing", value: "native/local planned", ok: true, icon: HardDrive },
  ];

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Diagnostics"
          title="System topology"
          description="The hosted application is the orchestration surface. Acquisition, high-rate buffering, and future heavy model execution belong on the local workstation or dedicated compute node."
        />
        <div className="divide-y divide-white/[.055]">
          {rows.map(({ label, value, ok, icon: Icon }) => (
            <div key={label} className="grid gap-3 px-5 py-4 md:grid-cols-[220px_1fr_auto] md:items-center">
              <div className="flex items-center gap-2 text-xs text-slate-300"><Icon size={14} className="text-slate-600" /> {label}</div>
              <div className="truncate font-mono text-[10px] text-slate-600">{value}</div>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.16em] text-slate-600"><StatusDot online={ok}/>{ok ? "ready" : "waiting"}</div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="p-5">
          <CheckCircle2 size={18} className="text-emerald-300/70" />
          <div className="mt-6 text-sm font-medium">Low-latency boundary</div>
          <p className="mt-2 text-xs leading-5 text-slate-600">Sensor I/O, clock synchronization, buffering, filtering, and recording stay close to the hardware instead of traversing Vercel.</p>
        </Panel>
        <Panel className="p-5">
          <CheckCircle2 size={18} className="text-emerald-300/70" />
          <div className="mt-6 text-sm font-medium">Evidence boundary</div>
          <p className="mt-2 text-xs leading-5 text-slate-600">The interface distinguishes live acquisition, simulation, planned subsystems, and unvalidated research targets instead of visually conflating them.</p>
        </Panel>
        <Panel className="p-5">
          <CircleDashed size={18} className="text-amber-200/70" />
          <div className="mt-6 text-sm font-medium">Next compute layer</div>
          <p className="mt-2 text-xs leading-5 text-slate-600">Rust/C++ hot-path processing, persistent session storage, XDF/NWB recording, GPU model workers, and subject-specific atlas services are the next native layer.</p>
        </Panel>
      </div>

      <Panel>
        <SectionHeader eyebrow="Performance" title="Current browser transport" />
        <div className="grid gap-3 p-4 md:grid-cols-4">
          {[
            ["Gateway RTT", latency === null ? "—" : `${latency} ms`],
            ["Render path", "WebGL"],
            ["Client buffering", "bounded"],
            ["Private uploads", "disabled"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/[.07] bg-black/10 p-4">
              <div className="text-[10px] uppercase tracking-[.16em] text-slate-600">{label}</div>
              <div className="mt-3 font-mono text-sm text-slate-300">{value}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
