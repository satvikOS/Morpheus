"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDrive,
  Radio,
  ShieldCheck,
  TimerReset,
} from "lucide-react";
import type { GatewayStatus } from "@/lib/morpheus";
import type { ClockSyncState } from "@/lib/use-signal-engine";

type AlarmLevel = "critical" | "warning" | "normal";

export default function EvidenceBar({
  mode,
  status,
  transport,
  packetRate,
  dropped,
  sharedMemory,
  gateway,
  clockSync,
}: {
  mode: "live" | "simulation" | "idle";
  status: GatewayStatus;
  transport: string;
  packetRate: number;
  dropped: number;
  sharedMemory: boolean;
  gateway: string;
  clockSync: ClockSyncState;
}) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(
          `${gateway.replace(/\/$/, "")}/recording`,
          { cache: "no-store" },
        );
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

  const alarm = useMemo(() => {
    if (live && status.status !== "online") {
      return {
        level: "critical" as AlarmLevel,
        message: "LIVE SOURCE WITHOUT HEALTHY GATEWAY",
      };
    }

    if (dropped >= 10) {
      return {
        level: "critical" as AlarmLevel,
        message: `PACKET / DECODE ERRORS: ${dropped}`,
      };
    }

    if (live && (!clockSync.ready || (clockSync.uncertaintyMs ?? Infinity) > 10)) {
      return {
        level: "warning" as AlarmLevel,
        message: clockSync.ready
          ? `CLOCK UNCERTAINTY ±${clockSync.uncertaintyMs?.toFixed(2)} ms`
          : "CLOCK NOT SYNCHRONIZED",
      };
    }

    if (dropped > 0) {
      return {
        level: "warning" as AlarmLevel,
        message: `DROPPED / INVALID PACKETS: ${dropped}`,
      };
    }

    return {
      level: "normal" as AlarmLevel,
      message: live ? "ACQUISITION HEALTH NOMINAL" : simulation ? "SIMULATION ONLY" : "NO LIVE SOURCE",
    };
  }, [live, simulation, status.status, dropped, clockSync]);

  return (
    <>
      {alarm.level !== "normal" ? (
        <div className={`alarm-strip alarm-strip-${alarm.level}`} role="alert">
          {alarm.level === "critical" ? (
            <AlertOctagon size={15} />
          ) : (
            <AlertTriangle size={15} />
          )}
          <strong>{alarm.message}</strong>
          <span>
            {alarm.level === "critical"
              ? "Pause acquisition-sensitive actions until the fault is resolved."
              : "Review timing and transport quality before interpreting event-locked data."}
          </span>
        </div>
      ) : null}

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
                ? "Synthetic streams are visibly segregated and cannot be sealed as live evidence."
                : live
                  ? "Source timestamps and gateway clock mapping are retained with each acquisition/control event."
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
            icon={TimerReset}
            label="Clock"
            value={
              clockSync.ready
                ? `±${clockSync.uncertaintyMs?.toFixed(2) ?? "—"} ms`
                : "UNSYNC"
            }
            state={
              clockSync.ready && (clockSync.uncertaintyMs ?? Infinity) <= 5
                ? "ok"
                : "warn"
            }
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
    </>
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
