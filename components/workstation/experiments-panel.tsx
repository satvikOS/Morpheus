"use client";

import { useState } from "react";
import { CircleDot, FlaskConical, Play, Plus, Send, TimerReset } from "lucide-react";
import type { MarkerEvent } from "@/lib/morpheus";
import { Panel, SectionHeader } from "./ui";

const milestones = [
  { id: "M0", title: "Dataset Zero", status: "ACTIVE", body: "Immutable reports, timestamps, provenance, annotations, and recurrence links." },
  { id: "M1", title: "Recurrence", status: "NEXT", body: "Objective semantic, spatial, and narrative continuity analysis across records." },
  { id: "M2", title: "Reinstatement", status: "PLANNED", body: "Controlled interruption duration and pre-registered dream continuation criteria." },
  { id: "M3", title: "Neural baseline", status: "PLANNED", body: "Reproduce public EEG/fMRI decoding baselines with held-out evaluation." },
  { id: "M4", title: "Live physiology", status: "BOOTSTRAP", body: "Synchronized markers, EEG streams, XDF/NWB-compatible acquisition, and quality metrics." },
  { id: "M5", title: "Individual atlas", status: "RESEARCH", body: "Subject-specific alignment across perception, imagery, sleep, and session boundaries." },
];

export default function ExperimentsPanel({ gateway }: { gateway: string }) {
  const [events, setEvents] = useState<MarkerEvent[]>([]);
  const [label, setLabel] = useState("AWAKE_REPORT");
  const [sending, setSending] = useState(false);

  const sendMarker = async () => {
    const markerLabel = label.trim();
    if (!markerLabel || sending) return;
    setSending(true);
    const timestamp = Date.now() / 1000;
    let source: MarkerEvent["source"] = "local";
    try {
      const response = await fetch(`${gateway.replace(/\/$/, "")}/markers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: markerLabel, timestamp }),
      });
      if (response.ok) source = "gateway";
    } catch {}
    setEvents((current) => [
      { id: crypto.randomUUID(), label: markerLabel, timestamp, source },
      ...current,
    ].slice(0, 40));
    setSending(false);
  };

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Research program"
          title="Experiment control"
          description="Milestones are ordered by evidentiary dependency. Later reconstruction work does not become a scientific claim until upstream measurement and decoding survive validation."
        />
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {milestones.map((milestone) => (
            <div key={milestone.id} className="rounded-xl border border-white/[.07] bg-black/10 p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-sky-200">{milestone.id}</span>
                <span className="tag-muted">{milestone.status}</span>
              </div>
              <div className="mt-5 text-sm font-medium text-slate-200">{milestone.title}</div>
              <p className="mt-2 text-xs leading-5 text-slate-600">{milestone.body}</p>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[.65fr_1.35fr]">
        <Panel>
          <SectionHeader eyebrow="Synchronized events" title="Marker console" description="Markers timestamp experimental events. Gateway acknowledgement is recorded when available." />
          <div className="space-y-3 p-4">
            <label className="block">
              <span className="mb-2 block text-[10px] uppercase tracking-[.16em] text-slate-600">Marker label</span>
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value.toUpperCase().replace(/\s+/g, "_"))}
                onKeyDown={(event) => { if (event.key === "Enter") void sendMarker(); }}
                className="w-full rounded-lg border border-white/[.08] bg-black/20 px-3 py-2.5 font-mono text-xs text-slate-300 outline-none focus:border-sky-300/30"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              {["DREAM_ONSET", "AWAKEN", "LUCID_SIGNAL", "REPORT_END"].map((preset) => (
                <button key={preset} onClick={() => setLabel(preset)} className="button-secondary justify-center text-[9px]">{preset}</button>
              ))}
            </div>
            <button onClick={sendMarker} className="button-primary w-full"><Send size={13} /> {sending ? "Sending..." : "Emit marker"}</button>
            <div className="rounded-xl border border-white/[.06] bg-black/15 p-3 text-[11px] leading-5 text-slate-600">
              Local-only markers are useful for interface testing but are not equivalent to synchronized acquisition-clock markers.
            </div>
          </div>
        </Panel>

        <Panel>
          <SectionHeader eyebrow="Event timeline" title="Current session" action={<span className="tag-muted">{events.length} EVENTS</span>} />
          {events.length ? (
            <div className="divide-y divide-white/[.055]">
              {events.map((event, index) => (
                <div key={event.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[.07] bg-black/20 text-slate-500">
                    {index === 0 ? <Play size={12} /> : <CircleDot size={11} />}
                  </span>
                  <div>
                    <div className="font-mono text-xs text-slate-300">{event.label}</div>
                    <div className="mt-1 text-[10px] text-slate-650">{new Date(event.timestamp * 1000).toISOString()}</div>
                  </div>
                  <span className={`tag-muted ${event.source === "gateway" ? "!text-emerald-300" : ""}`}>{event.source}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <TimerReset size={24} className="text-slate-700" />
              <p className="mt-3 text-xs text-slate-600">No markers in this session.</p>
              <button onClick={() => setLabel("SESSION_START")} className="mt-4 button-secondary"><Plus size={12} /> Prepare session start</button>
            </div>
          )}
        </Panel>
      </div>

      <Panel>
        <SectionHeader eyebrow="Protocol skeleton" title="Immediate reinstatement study" />
        <div className="grid gap-3 p-4 lg:grid-cols-5">
          {[
            ["01", "Dream", "Natural or lucid dream state."],
            ["02", "Wake", "Controlled interruption with exact timestamp."],
            ["03", "Report", "Immediate raw report before outside information."],
            ["04", "Return", "Return to sleep under defined delay condition."],
            ["05", "Score", "Pre-registered continuation criteria and blinded comparison."],
          ].map(([step, title, body]) => (
            <div key={step} className="rounded-xl border border-white/[.07] bg-black/10 p-4">
              <div className="font-mono text-[10px] text-sky-300">{step}</div>
              <div className="mt-4 text-xs font-medium text-slate-300">{title}</div>
              <p className="mt-2 text-[11px] leading-5 text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
