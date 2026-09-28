"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  BrainCircuit,
  Download,
  FlaskConical,
  Play,
  RotateCcw,
  Waves,
} from "lucide-react";
import {
  generateConnectome,
  generateSimulation,
  generateVolumePhantom,
  type SimulationPreset,
} from "@/lib/simulations";
import { downloadJson } from "@/lib/morpheus";
import { Metric, Panel, SectionHeader } from "./ui";

const presets: Array<{
  id: SimulationPreset;
  title: string;
  family: string;
  description: string;
}> = [
  { id: "eeg-awake", title: "Awake EEG reference", family: "Electrophysiology", description: "Alpha/beta-weighted synthetic multichannel reference." },
  { id: "eeg-rem", title: "REM-like signal", family: "Sleep", description: "Theta/mixed-frequency synthetic signal for pipeline testing." },
  { id: "eeg-n3", title: "N3-like slow wave", family: "Sleep", description: "Large slow oscillations for sleep-stage visualization tests." },
  { id: "erp-p300", title: "P300 ERP", family: "Event-related", description: "Event-locked positive deflection over background rhythm." },
  { id: "bold-hrf", title: "BOLD HRF", family: "fMRI", description: "Synthetic hemodynamic-response timecourse for temporal tooling." },
  { id: "connectome", title: "Connectivity signals", family: "Networks", description: "Coupled synthetic channels for graph and connectivity tooling." },
];

export default function SimulationPanel() {
  const [preset, setPreset] = useState<SimulationPreset>("eeg-rem");
  const [seed, setSeed] = useState(42);
  const [seconds, setSeconds] = useState(8);
  const [channelCount, setChannelCount] = useState(8);

  const frame = useMemo(
    () => generateSimulation(preset, seconds, 256, channelCount, seed),
    [preset, seconds, channelCount, seed],
  );

  const connectome = useMemo(() => generateConnectome(seed, 48), [seed]);
  const phantom = useMemo(() => generateVolumePhantom(64), [seed]);

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Simulation laboratory"
          title="Synthetic brain systems"
          description="Controlled synthetic data exercises the workstation before real subjects or hardware are introduced. Every generated stream is explicitly marked synthetic and must never be mixed with experimental ground truth."
          action={
            <button
              className="button-secondary"
              onClick={() => downloadJson(`morpheus-sim-${preset}.json`, frame)}
            >
              <Download size={13} /> Export frame
            </button>
          }
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Preset" value={preset.toUpperCase()} />
          <Metric label="Channels" value={frame.channels.length} />
          <Metric label="Sample rate" value={`${frame.sampleRate} Hz`} />
          <Metric label="Duration" value={`${seconds}s`} />
          <Metric label="Synthetic volume" value={`${phantom.size}³`} detail="brain phantom voxels" />
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[.62fr_1.38fr]">
        <Panel>
          <SectionHeader eyebrow="Presets" title="Simulation library" />
          <div className="space-y-2 p-3">
            {presets.map((item) => (
              <button
                key={item.id}
                onClick={() => setPreset(item.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  preset === item.id
                    ? "border-sky-300/20 bg-sky-300/[.045]"
                    : "border-white/[.06] bg-black/10 hover:bg-white/[.02]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-medium text-slate-300">{item.title}</div>
                  <span className="tag-muted">{item.family}</span>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-slate-650">{item.description}</p>
              </button>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionHeader eyebrow="Multichannel scope" title="Synthetic output" />
          <div className="p-4">
            <MultiScope channels={frame.channels} labels={frame.labels} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel>
          <SectionHeader eyebrow="Parameters" title="Generator controls" />
          <div className="space-y-4 p-4">
            <Control label="Seed" value={seed} min={1} max={999} onChange={setSeed} />
            <Control label="Duration" value={seconds} min={2} max={20} onChange={setSeconds} suffix="s" />
            <Control label="Channels" value={channelCount} min={2} max={16} onChange={setChannelCount} />
            <button onClick={() => setSeed((value) => value + 1)} className="button-primary w-full">
              <RotateCcw size={13}/> Regenerate
            </button>
          </div>
        </Panel>

        <Panel className="p-5">
          <BrainCircuit size={18} className="text-sky-200/70" />
          <div className="mt-6 text-sm font-medium">Connectome phantom</div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="Nodes" value={connectome.nodes.length} />
            <Metric label="Edges" value={connectome.edges.length} />
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-600">Synthetic graph topology for network rendering, connectivity matrices and worker load tests.</p>
        </Panel>

        <Panel className="p-5">
          <FlaskConical size={18} className="text-sky-200/70" />
          <div className="mt-6 text-sm font-medium">Volume phantom</div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="Grid" value={`${phantom.size}³`} />
            <Metric label="Voxels" value={phantom.voxels.length.toLocaleString()} />
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-600">Synthetic structural volume for slice navigation, transfer-function experiments and GPU volume-rendering development.</p>
        </Panel>
      </div>

      <Panel>
        <SectionHeader eyebrow="Simulation boundary" title="What these simulations are for" />
        <div className="grid gap-3 p-4 lg:grid-cols-4">
          {[
            ["Pipeline validation", "Exercise ingestion, buffering, visualization and export paths."],
            ["Load testing", "Stress browser workers and rendering without exposing personal data."],
            ["Protocol rehearsal", "Test experiment markers and user flows before real acquisition."],
            ["Not physiology claims", "Synthetic presets are engineering references, not patient or dream-state models."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-xl border border-white/[.07] bg-black/10 p-4">
              <Activity size={14} className="text-slate-500" />
              <div className="mt-4 text-xs font-medium text-slate-300">{title}</div>
              <p className="mt-2 text-[11px] leading-5 text-slate-650">{body}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Control({
  label,
  value,
  min,
  max,
  onChange,
  suffix = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <div className="mb-2 flex justify-between text-[10px] uppercase tracking-[.15em] text-slate-600">
        <span>{label}</span><span>{value}{suffix}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
    </label>
  );
}

function MultiScope({ channels, labels }: { channels: number[][]; labels: string[] }) {
  const width = 1200;
  const laneHeight = 74;
  const height = Math.max(240, channels.length * laneHeight);

  return (
    <div className="signal-grid max-h-[620px] overflow-auto rounded-xl border border-white/[.07] bg-[#04080c] p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-h-[420px] w-full" preserveAspectRatio="none">
        {channels.map((channel, channelIndex) => {
          const maxAbs = Math.max(0.001, ...channel.map((value) => Math.abs(value)));
          const step = Math.max(1, Math.floor(channel.length / 520));
          const reduced = channel.filter((_, index) => index % step === 0);
          const center = channelIndex * laneHeight + laneHeight / 2;
          const points = reduced.map((value, index) => {
            const x = (index / Math.max(1, reduced.length - 1)) * width;
            const y = center - (value / maxAbs) * (laneHeight * 0.33);
            return `${x},${y}`;
          }).join(" ");

          return (
            <g key={channelIndex}>
              <line x1="0" x2={width} y1={center} y2={center} stroke="#20303c" strokeWidth=".7" />
              <text x="8" y={center - 22} fill="#617080" fontSize="11">{labels[channelIndex] || `CH${channelIndex + 1}`}</text>
              <polyline points={points} fill="none" stroke="#8fd8ff" strokeOpacity=".72" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
