"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDrive,
  Radio,
  ShieldCheck,
} from "lucide-react";
import type { GatewayStatus } from "@/lib/morpheus";

export default function EvidenceBar({
  mode,
  status,
  transport,
  packetRate,
  dropped,
  sharedMemory,
  gateway,
}: {
  mode: "live" | "simulation" | "idle";
  status: GatewayStatus;
  transport: string;
  packetRate: number;
  dropped: number;
  sharedMemory: boolean;
  gateway: string;
}) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`${gateway.replace(/\/$/, "")}/recording`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (active) setRecording(Boolean(payload.active));
      } catch {}
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [gateway]);

  const simulation = mode === "simulation";
  const live = mode === "live";

  return (
    <div
      className={`evidence-bar ${
        simulation
          ? "evidence-bar-simulation"
          : live
            ? "evidence-bar-live"
            : "evidence-bar-idle"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="evidence-primary">
        {simulation ? (
          <AlertTriangle size={15} />
        ) : live ? (
          <CheckCircle2 size={15} />
        ) : (
          <Radio size={15} />
        )}
        <div>
          <div className="evidence-mode">
            {simulation
              ? "SIMULATION MODE"
              : live
                ? "HARDWARE / LIVE DATA"
                : "NO AUTHORITATIVE STREAM"}
          </div>
          <div className="evidence-subtitle">
            {simulation
              ? "Synthetic signals are visually segregated and cannot be mistaken for experimental ground truth."
              : live
                ? "Display data is being relayed from the acquisition gateway. Source timestamps remain authoritative."
                : "The workstation is available, but no live acquisition source is authoritative."}
          </div>
        </div>
      </div>

      <div className="evidence-stats">
        <EvidenceStat
          icon={Radio}
          label="Transport"
          value={transport || "—"}
          state={status.status === "online" ? "ok" : "muted"}
        />
        <EvidenceStat
          icon={Database}
          label="Rate"
          value={packetRate ? `${packetRate}/s` : "—"}
          state={packetRate ? "ok" : "muted"}
        />
        <EvidenceStat
          icon={ShieldCheck}
          label="Dropped"
          value={String(dropped)}
          state={dropped > 0 ? "warn" : "ok"}
        />
        <EvidenceStat
          icon={HardDrive}
          label="Recorder"
          value={recording ? "ACTIVE" : "LOCAL"}
          state={recording ? "warn" : "muted"}
        />
        <EvidenceStat
          icon={ShieldCheck}
          label="Memory"
          value={sharedMemory ? "SAB" : "FALLBACK"}
          state={sharedMemory ? "ok" : "warn"}
        />
      </div>
    </div>
  );
}

function EvidenceStat({
  icon: Icon,
  label,
  value,
  state,
}: {
  icon: typeof Radio;
  label: string;
  value: string;
  state: "ok" | "warn" | "muted";
}) {
  return (
    <div className={`evidence-stat evidence-stat-${state}`}>
      <Icon size={12} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
