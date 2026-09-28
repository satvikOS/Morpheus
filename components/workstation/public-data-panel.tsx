"use client";

import { useEffect, useState } from "react";
import { DatabaseZap, ExternalLink, RefreshCw, Search } from "lucide-react";
import type { PublicDataset } from "@/lib/morpheus";
import { EmptyState, Panel, SectionHeader } from "./ui";

export default function PublicDataPanel() {
  const [query, setQuery] = useState("electrophysiology");
  const [datasets, setDatasets] = useState<PublicDataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const search = async (value = query) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/public-data/dandi?q=${encodeURIComponent(value)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`DANDI request failed (${response.status})`);
      const data = await response.json() as { datasets?: PublicDataset[] };
      setDatasets(data.datasets ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reach DANDI.");
      setDatasets([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void search("electrophysiology"); }, []);

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Open neuroscience"
          title="Public data fabric"
          description="Read-only access to public neuroscience datasets gives Morpheus reproducible baselines before any subject-specific claims are attempted."
          action={
            <a href="https://dandiarchive.org/" target="_blank" rel="noreferrer" className="button-secondary">
              DANDI <ExternalLink size={12} />
            </a>
          }
        />
        <div className="p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-650" size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void search(); }}
                placeholder="Search DANDI: EEG, electrophysiology, sleep..."
                className="w-full rounded-xl border border-white/[.08] bg-black/20 py-3 pl-9 pr-3 text-xs text-slate-300 outline-none placeholder:text-slate-700 focus:border-sky-300/30"
              />
            </div>
            <button onClick={() => void search()} className="button-primary px-4">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} Search
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {["electrophysiology", "EEG", "sleep", "memory", "human"].map((preset) => (
              <button key={preset} onClick={() => { setQuery(preset); void search(preset); }} className="tag-muted hover:!text-slate-300">{preset}</button>
            ))}
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          eyebrow="DANDI REST API"
          title="Dataset results"
          action={<span className="tag-muted">{datasets.length} LOADED</span>}
        />
        {error ? <div className="border-b border-red-400/10 bg-red-400/[.03] px-5 py-3 text-xs text-red-300/80">{error}</div> : null}
        {datasets.length ? (
          <div className="grid gap-3 p-4 lg:grid-cols-2">
            {datasets.map((dataset) => (
              <a
                key={dataset.id}
                href={dataset.url}
                target="_blank"
                rel="noreferrer"
                className="group rounded-xl border border-white/[.07] bg-black/10 p-4 transition hover:border-sky-300/20 hover:bg-white/[.025]"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[.07] bg-black/20 text-slate-500 group-hover:text-sky-200">
                    <DatabaseZap size={16} />
                  </span>
                  <div className="flex gap-2">
                    <span className="tag-muted">{dataset.version || "draft"}</span>
                    <ExternalLink size={12} className="text-slate-700" />
                  </div>
                </div>
                <div className="mt-5 font-mono text-[10px] text-sky-300">{dataset.id}</div>
                <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-5 text-slate-200">{dataset.title}</h3>
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-600">{dataset.description || "No description supplied."}</p>
                <div className="mt-4 text-[10px] text-slate-700">{dataset.modified ? `Updated ${new Date(dataset.modified).toLocaleDateString()}` : "Public dataset"}</div>
              </a>
            ))}
          </div>
        ) : (
          <EmptyState>{loading ? "Querying the public archive..." : "No datasets loaded."}</EmptyState>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <div className="text-[10px] uppercase tracking-[.2em] text-slate-600">OpenNeuro</div>
          <div className="mt-2 text-sm font-medium text-slate-200">BIDS neuroimaging archive</div>
          <p className="mt-2 text-xs leading-5 text-slate-600">MRI, PET, MEG, EEG, iEEG and NIRS datasets provide a second public-data path for later decoding baselines.</p>
          <a href="https://openneuro.org/" target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-xs text-sky-200">Open archive <ExternalLink size={12}/></a>
        </Panel>
        <Panel className="p-5">
          <div className="text-[10px] uppercase tracking-[.2em] text-slate-600">Data policy</div>
          <div className="mt-2 text-sm font-medium text-slate-200">Public inputs, local private ground truth</div>
          <p className="mt-2 text-xs leading-5 text-slate-600">Public repositories can be indexed remotely. Personal dream records and identifiable neural recordings remain separate from the public application.</p>
        </Panel>
      </div>
    </div>
  );
}
