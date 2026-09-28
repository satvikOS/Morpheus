"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Gauge,
  Keyboard,
  MonitorCog,
  SlidersHorizontal,
} from "lucide-react";
import type { SharedSignalRing } from "@/lib/use-signal-engine";

type Montage = "raw" | "average";
type Polarity = "negative-up" | "positive-up";

export default function SignalCanvas({
  ring,
  snapshots,
  sampleRate,
  sourceMode,
  sourceName,
  channelUnit = "",
  channelLabels = [],
  compact = false,
  active = true,
}: {
  ring: SharedSignalRing | null;
  snapshots: number[][];
  sampleRate: number;
  sourceMode: "live" | "simulation" | "idle";
  sourceName: string;
  channelUnit?: string;
  channelLabels?: string[];
  compact?: boolean;
  active?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const [renderer, setRenderer] = useState("initializing");
  const [timeWindow, setTimeWindow] = useState(compact ? 5 : 10);
  const [gain, setGain] = useState(1);
  const [polarity, setPolarity] = useState<Polarity>("negative-up");
  const [montage, setMontage] = useState<Montage>("raw");
  const [uvPerMm, setUvPerMm] = useState(10);
  const [pxPerMm, setPxPerMm] = useState(0);
  const [canvasCssWidth, setCanvasCssWidth] = useState(0);

  const normalizedUnit = channelUnit.toLowerCase().replace("μ", "u").replace("µ", "u");
  const calibratedUv = normalizedUnit === "uv" || normalizedUnit.includes("microvolt");

  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem("morpheus.display.px-per-mm") || "0");
      if (Number.isFinite(stored) && stored > 0) setPxPerMm(stored);
    } catch {}
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!("transferControlToOffscreen" in canvas)) {
      setRenderer("offscreen-unavailable");
      return;
    }

    const worker = new Worker("/workers/signal-render-worker.js");
    workerRef.current = worker;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    setCanvasCssWidth(rect.width);

    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage(
      {
        type: "init",
        canvas: offscreen,
        dataBuffer: ring?.data.buffer,
        controlBuffer: ring?.control.buffer,
        capacity: ring?.capacity || 0,
        maxChannels: ring?.maxChannels || 0,
        width: rect.width,
        height: rect.height,
        dpr,
      },
      [offscreen],
    );

    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === "renderer-ready") {
        setRenderer(String(message.backend || "offscreen-webgl2"));
      }
      if (message.type === "renderer-error") {
        setRenderer("renderer-error");
      }
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const next = entry.contentRect;
      setCanvasCssWidth(next.width);
      worker.postMessage({
        type: "resize",
        width: next.width,
        height: next.height,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      });
    });

    observer.observe(canvas);

    return () => {
      observer.disconnect();
      worker.postMessage({ type: "stop" });
      worker.terminate();
      workerRef.current = null;
    };
  }, [ring]);

  useEffect(() => {
    workerRef.current?.postMessage({
      type: "settings",
      settings: {
        timeWindow,
        gain,
        polarity,
        montage,
        sampleRate: Math.max(1, sampleRate || 256),
        pxPerMm,
        uvPerMm,
        calibratedUv,
      },
    });
  }, [
    timeWindow,
    gain,
    polarity,
    montage,
    sampleRate,
    pxPerMm,
    uvPerMm,
    calibratedUv,
  ]);

  useEffect(() => {
    workerRef.current?.postMessage({ type: "active", active });
  }, [active]);

  useEffect(() => {
    if (ring || !workerRef.current) return;
    workerRef.current.postMessage({
      type: "snapshot",
      channels: snapshots,
    });
  }, [ring, snapshots]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "SELECT" ||
        target?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (event.key === "[") {
        setTimeWindow((value) => Math.max(1, value / 2));
      } else if (event.key === "]") {
        setTimeWindow((value) => Math.min(60, value * 2));
      } else if (event.key.toLowerCase() === "p") {
        setPolarity((value) =>
          value === "negative-up" ? "positive-up" : "negative-up",
        );
      } else if (event.key.toLowerCase() === "m") {
        setMontage((value) => (value === "raw" ? "average" : "raw"));
      } else if (event.key === "-" || event.key === "_") {
        setGain((value) => Math.max(0.25, value / 2));
      } else if (event.key === "=" || event.key === "+") {
        setGain((value) => Math.min(8, value * 2));
      }
    };

    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  const channels = ring
    ? Math.max(0, Math.min(ring.maxChannels, Atomics.load(ring.control, 1)))
    : snapshots.length;

  const timebase = useMemo(() => {
    if (!pxPerMm || !canvasCssWidth || !timeWindow) return null;
    const widthMm = canvasCssWidth / pxPerMm;
    return widthMm / timeWindow;
  }, [pxPerMm, canvasCssWidth, timeWindow]);

  const setCalibration = (value: number) => {
    const next = Number.isFinite(value) ? Math.max(0, Math.min(30, value)) : 0;
    setPxPerMm(next);
    try {
      if (next > 0) {
        localStorage.setItem("morpheus.display.px-per-mm", String(next));
      } else {
        localStorage.removeItem("morpheus.display.px-per-mm");
      }
    } catch {}
  };

  return (
    <div className="signal-surface">
      <div className="signal-toolbar">
        <div className="flex min-w-0 items-center gap-2">
          <Activity size={13} className="text-slate-500" />
          <span className="truncate text-[10px] uppercase tracking-[.15em] text-slate-500">
            {sourceName || "Signal monitor"}
          </span>
          <span className="renderer-badge">{renderer}</span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <ControlSelect
            label="Window"
            value={String(timeWindow)}
            onChange={(value) => setTimeWindow(Number(value))}
            options={[
              ["2", "2 s"],
              ["5", "5 s"],
              ["10", "10 s"],
              ["20", "20 s"],
            ]}
          />
          <ControlSelect
            label="Gain"
            value={String(gain)}
            onChange={(value) => setGain(Number(value))}
            options={[
              ["0.5", "0.5×"],
              ["1", "1×"],
              ["2", "2×"],
              ["4", "4×"],
            ]}
          />
          <ControlSelect
            label="Polarity"
            value={polarity}
            onChange={(value) => setPolarity(value as Polarity)}
            options={[
              ["negative-up", "Negative up"],
              ["positive-up", "Positive up"],
            ]}
          />
          <ControlSelect
            label="Montage"
            value={montage}
            onChange={(value) => setMontage(value as Montage)}
            options={[
              ["raw", "As acquired"],
              ["average", "Average ref"],
            ]}
          />
        </div>
      </div>

      <div
        className={`signal-canvas-wrap ${compact ? "signal-canvas-compact" : ""}`}
      >
        <canvas ref={canvasRef} className="signal-canvas" />

        <div className="pointer-events-none absolute inset-y-0 left-0 flex w-16 flex-col justify-around py-4 pl-2">
          {Array.from(
            { length: Math.min(channels || 8, compact ? 8 : 16) },
            (_, index) => (
              <span
                key={index}
                className="font-mono text-[9px] tracking-wide text-slate-600"
              >
                {channelLabels[index] ||
                  `CH${String(index + 1).padStart(2, "0")}`}
              </span>
            ),
          )}
        </div>

        <div className="pointer-events-none absolute bottom-2 right-3 flex gap-2 text-[9px] uppercase tracking-[.12em] text-slate-650">
          <span>OffscreenCanvas</span>
          <span>WebGL2</span>
          <span>Min/Max envelope</span>
          <span>{ring ? "Shared memory" : "Snapshot fallback"}</span>
        </div>

        {sourceMode === "simulation" ? (
          <div className="simulation-watermark">
            SIMULATION · NOT EXPERIMENTAL DATA
          </div>
        ) : null}
      </div>

      {!compact ? (
        <div className="signal-calibration-panel">
          <div className="signal-calibration-row">
            <div className="flex items-center gap-2">
              <MonitorCog size={13} />
              <div>
                <strong>Display calibration</strong>
                <span>
                  Set measured CSS pixels per physical millimetre. Until calibrated,
                  Morpheus does not claim a physical mm/s scale.
                </span>
              </div>
            </div>
            <label className="calibration-input">
              <span>px/mm</span>
              <input
                type="number"
                min="0"
                max="30"
                step="0.01"
                value={pxPerMm || ""}
                placeholder="unset"
                onChange={(event) => setCalibration(Number(event.target.value))}
              />
            </label>
          </div>

          <div className="signal-calibration-grid">
            <div>
              <Gauge size={12} />
              <span>Timebase</span>
              <strong>{timebase ? `${timebase.toFixed(2)} mm/s` : "UNCALIBRATED"}</strong>
            </div>
            <div>
              <SlidersHorizontal size={12} />
              <span>Amplitude</span>
              <strong>
                {calibratedUv && pxPerMm
                  ? `${uvPerMm} µV/mm`
                  : "RELATIVE"}
              </strong>
            </div>
            <div>
              <Keyboard size={12} />
              <span>Hotkeys</span>
              <strong>[ ] window · - + gain · P polarity · M montage</strong>
            </div>
          </div>

          {calibratedUv && pxPerMm ? (
            <label className="amplitude-scale-control">
              <span>µV/mm</span>
              <select
                value={uvPerMm}
                onChange={(event) => setUvPerMm(Number(event.target.value))}
              >
                {[2, 5, 10, 20, 50, 100].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="signal-calibration-note">
        <SlidersHorizontal size={12} />
        The renderer runs in a dedicated OffscreenCanvas worker with antialiasing
        disabled. When samples exceed horizontal pixel density it renders a
        per-pixel min/max envelope so narrow transients are not erased by naive
        point skipping.
      </div>
    </div>
  );
}

function ControlSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="signal-control">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
