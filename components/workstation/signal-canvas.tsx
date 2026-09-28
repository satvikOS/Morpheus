"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, SlidersHorizontal } from "lucide-react";
import type { SharedSignalRing } from "@/lib/use-signal-engine";

type Montage = "raw" | "average";
type Polarity = "negative-up" | "positive-up";

const MAX_RENDER_SAMPLES = 4096;

export default function SignalCanvas({
  ring,
  snapshots,
  packetRate,
  sourceMode,
  sourceName,
  compact = false,
}: {
  ring: SharedSignalRing | null;
  snapshots: number[][];
  packetRate: number;
  sourceMode: "live" | "simulation" | "idle";
  sourceName: string;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [timeWindow, setTimeWindow] = useState(compact ? 5 : 10);
  const [gain, setGain] = useState(1);
  const [polarity, setPolarity] = useState<Polarity>("negative-up");
  const [montage, setMontage] = useState<Montage>("raw");
  const settingsRef = useRef({ timeWindow, gain, polarity, montage, packetRate });

  useEffect(() => {
    settingsRef.current = { timeWindow, gain, polarity, montage, packetRate };
  }, [timeWindow, gain, polarity, montage, packetRate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      desynchronized: true,
      powerPreference: "high-performance",
    });
    if (!gl) return;

    const vertex = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(
      vertex,
      `#version 300 es
      in vec2 aPosition;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }`,
    );
    gl.compileShader(vertex);

    const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(
      fragment,
      `#version 300 es
      precision highp float;
      out vec4 outColor;
      uniform float uAlpha;
      void main() {
        outColor = vec4(0.48, 0.78, 0.95, uAlpha);
      }`,
    );
    gl.compileShader(fragment);

    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.useProgram(program);

    const positionLocation = gl.getAttribLocation(program, "aPosition");
    const alphaLocation = gl.getUniformLocation(program, "uAlpha");
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let raf = 0;
    let vertices = new Float32Array(MAX_RENDER_SAMPLES * 2);

    const frame = () => {
      resize();
      gl.clearColor(0.012, 0.025, 0.035, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const { timeWindow: seconds, gain: currentGain, polarity: currentPolarity, montage: currentMontage, packetRate: rate } =
        settingsRef.current;

      const channelCount = ring
        ? Math.max(0, Math.min(ring.maxChannels, Atomics.load(ring.control, 1)))
        : snapshots.length;

      const totalFrames = ring
        ? Math.max(0, Atomics.load(ring.control, 2))
        : Math.max(0, snapshots[0]?.length || 0);

      const writeIndex = ring ? Atomics.load(ring.control, 0) : totalFrames;
      const desired = Math.max(64, Math.round(Math.max(1, rate || 50) * seconds));
      const sampleCount = Math.min(MAX_RENDER_SAMPLES, desired, totalFrames, ring?.capacity || totalFrames);

      if (channelCount && sampleCount > 1) {
        const polarityScale = currentPolarity === "negative-up" ? -1 : 1;
        const laneHeight = 2 / channelCount;

        for (let channel = 0; channel < channelCount; channel += 1) {
          let maxAbs = 1e-6;
          const values = new Float32Array(sampleCount);

          for (let i = 0; i < sampleCount; i += 1) {
            let value = 0;

            if (ring) {
              const start = (writeIndex - sampleCount + ring.capacity) % ring.capacity;
              const frameIndex = (start + i) % ring.capacity;

              if (currentMontage === "average") {
                let sum = 0;
                for (let c = 0; c < channelCount; c += 1) {
                  sum += ring.data[frameIndex * ring.maxChannels + c];
                }
                value =
                  ring.data[frameIndex * ring.maxChannels + channel] -
                  sum / channelCount;
              } else {
                value = ring.data[frameIndex * ring.maxChannels + channel];
              }
            } else {
              const source = snapshots[channel] || [];
              const sourceIndex = Math.max(0, source.length - sampleCount + i);
              value = source[sourceIndex] || 0;

              if (currentMontage === "average") {
                let sum = 0;
                let contributors = 0;
                for (const series of snapshots) {
                  const idx = Math.max(0, series.length - sampleCount + i);
                  if (idx < series.length) {
                    sum += series[idx] || 0;
                    contributors += 1;
                  }
                }
                if (contributors) value -= sum / contributors;
              }
            }

            values[i] = value;
            maxAbs = Math.max(maxAbs, Math.abs(value));
          }

          if (vertices.length < sampleCount * 2) {
            vertices = new Float32Array(sampleCount * 2);
          }

          const laneCenter = 1 - laneHeight * (channel + 0.5);
          const amplitude = laneHeight * 0.34 * currentGain;

          for (let i = 0; i < sampleCount; i += 1) {
            const x = -1 + (i / (sampleCount - 1)) * 2;
            const normalized = Math.max(-1, Math.min(1, values[i] / maxAbs));
            const y = laneCenter + normalized * amplitude * polarityScale;
            vertices[i * 2] = x;
            vertices[i * 2 + 1] = y;
          }

          gl.bufferData(
            gl.ARRAY_BUFFER,
            vertices.subarray(0, sampleCount * 2),
            gl.DYNAMIC_DRAW,
          );
          gl.uniform1f(alphaLocation, channel % 2 === 0 ? 0.86 : 0.72);
          gl.drawArrays(gl.LINE_STRIP, 0, sampleCount);
        }
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [ring, snapshots]);

  const channels = ring
    ? Math.max(0, Math.min(ring.maxChannels, Atomics.load(ring.control, 1)))
    : snapshots.length;

  return (
    <div className="signal-surface">
      <div className="signal-toolbar">
        <div className="flex min-w-0 items-center gap-2">
          <Activity size={13} className="text-slate-500" />
          <span className="truncate text-[10px] uppercase tracking-[.15em] text-slate-500">
            {sourceName || "Signal monitor"}
          </span>
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

      <div className={`signal-canvas-wrap ${compact ? "signal-canvas-compact" : ""}`}>
        <canvas ref={canvasRef} className="signal-canvas" />

        <div className="pointer-events-none absolute inset-y-0 left-0 flex w-14 flex-col justify-around py-4 pl-2">
          {Array.from({ length: Math.min(channels || 8, compact ? 8 : 16) }, (_, index) => (
            <span
              key={index}
              className="font-mono text-[9px] tracking-wide text-slate-600"
            >
              CH{String(index + 1).padStart(2, "0")}
            </span>
          ))}
        </div>

        <div className="pointer-events-none absolute bottom-2 right-3 flex gap-2 text-[9px] uppercase tracking-[.12em] text-slate-650">
          <span>WebGL2</span>
          <span>{ring ? "Shared memory" : "Snapshot fallback"}</span>
        </div>

        {sourceMode === "simulation" ? (
          <div className="simulation-watermark">
            SIMULATION · NOT EXPERIMENTAL DATA
          </div>
        ) : null}
      </div>

      <div className="signal-calibration-note">
        <SlidersHorizontal size={12} />
        Relative gain is active. Physical mm/s and µV/mm display claims require a calibrated monitor and calibrated channel units from the acquisition source.
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
