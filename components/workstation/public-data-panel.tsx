"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  DatabaseZap,
  ExternalLink,
  RefreshCw,
  Search,
  Server,
  Waves,
} from "lucide-react";
import type { PublicDataSource, PublicDataset } from "@/lib/morpheus";
import { EmptyState, Panel, SectionHeader, StatusDot } from "./ui";

type CatalogResponse = {
  ok: boolean;
  query: string;
  sources: PublicDataSource[];
};

const presets = ["sleep", "EEG", "memory", "hippocampus", "dream", "human"];

export default function PublicDataPanel() {
  const [query, setQuery] = useState("sleep");
  const [sources, setSources] = useState<PublicDataSource[]>([]);
  const [activeSource, setActiveSource] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const search = async (value = query) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/public-data/catalog?q=${encodeURIComponent(value)}`, {
        cache: "no-store",
      });
      const payload = await response.json() as CatalogResponse;
      if (!response.ok) throw new Error("Public data catalog request failed.");
      setSources(payload.sources ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to query public neuroscience sources.");
      setSources([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void search("sleep");
  }, []);

  const datasets = useMemo(() => {
    const selected = activeSource === "all"
      ? sources
      : sources.filter((source) => source.id === activeSource);

    return selected.flatMap((source) =>
      source.datasets.map((dataset) => ({
        ...dataset,
        source: dataset.source || source.label,
      })),
    );
  }, [activeSource, sources]);

  const onlineCount = sources.filter((source) => source.ok).length;

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Open neuroscience data fabric"
          title="Live public repositories"
          description="Morpheus queries multiple public neuroscience archives through server-side adapters so the research workstation can discover electrophysiology, neuroimaging, brain maps, anatomy, and atlas data from one surface."
          action={
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.16em] text-slate-600">
              <StatusDot online={onlineCount > 0} />
              {onlineCount}/{sources.length || 4} sources online
            </div>
          }
        />

        <div className="p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-650" size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void search();
                }}
                placeholder="Search sleep, EEG, hippocampus, memory..."
                className="w-full rounded-xl border border-white/[.08] bg-black/20 py-3 pl-9 pr-3 text-xs text-slate-300 outline-none placeholder:text-slate-700 focus:border-sky-300/30"
              />
            </div>
            <button onClick={() => void search()} className="button-primary px-4">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
              Search all
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset}
                onClick={() => {
                  setQuery(preset);
                  void search(preset);
                }}
                className="tag-muted hover:!text-slate-300"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          eyebrow="Source health"
          title="Repository adapters"
          description="Each adapter is isolated so one upstream outage does not take down the rest of the public-data layer."
        />
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          {sources.length ? sources.map((source) => (
            <button
              key={source.id}
              onClick={() => setActiveSource((current) => current === source.id ? "all" : source.id)}
              className={`rounded-xl border p-4 text-left transition ${
                activeSource === source.id
                  ? "border-sky-300/20 bg-sky-300/[.045]"
                  : "border-white/[.07] bg-black/10 hover:bg-white/[.02]"
              }`}
            >
              <div className="flex items-center justify-between">
                <Server size={15} className="text-slate-500" />
                <StatusDot online={source.ok} />
              </div>
              <div className="mt-5 text-xs font-medium text-slate-300">{source.label}</div>
              <div className="mt-1 text-[10px] text-slate-650">
                {source.ok ? `${source.datasets.length} results · ${source.latency_ms} ms` : source.error || "offline"}
              </div>
            </button>
          )) : (
            Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-xl border border-white/[.06] bg-white/[.015]" />
            ))
          )}
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          eyebrow={activeSource === "all" ? "Unified results" : sources.find((source) => source.id === activeSource)?.label || "Results"}
          title="Neuroscience datasets and atlas entities"
          action={<span className="tag-muted">{datasets.length} LOADED</span>}
        />

        {error ? (
          <div className="border-b border-red-400/10 bg-red-400/[.03] px-5 py-3 text-xs text-red-300/80">{error}</div>
        ) : null}

        {datasets.length ? (
          <div className="grid gap-3 p-4 lg:grid-cols-2 2xl:grid-cols-3">
            {datasets.map((dataset, index) => (
              <DatasetCard key={`${dataset.source}-${dataset.id}-${index}`} dataset={dataset} />
            ))}
          </div>
        ) : (
          <EmptyState>{loading ? "Querying public archives..." : "No matching public data returned."}</EmptyState>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="p-5">
          <DatabaseZap size={17} className="text-sky-200/70" />
          <div className="mt-5 text-sm font-medium text-slate-200">DANDI</div>
          <p className="mt-2 text-xs leading-5 text-slate-600">NWB, electrophysiology, imaging and related public neurophysiology assets.</p>
          <a className="mt-4 inline-flex items-center gap-2 text-xs text-sky-200" href="https://dandiarchive.org/" target="_blank" rel="noreferrer">
            Open archive <ExternalLink size={12} />
          </a>
        </Panel>

        <Panel className="p-5">
          <Waves size={17} className="text-sky-200/70" />
          <div className="mt-5 text-sm font-medium text-slate-200">OpenNeuro + NeuroVault</div>
          <p className="mt-2 text-xs leading-5 text-slate-600">BIDS neuroimaging datasets plus public statistical maps, parcellations and atlases.</p>
          <div className="mt-4 flex gap-4">
            <a className="text-xs text-sky-200" href="https://openneuro.org/" target="_blank" rel="noreferrer">OpenNeuro</a>
            <a className="text-xs text-sky-200" href="https://neurovault.org/" target="_blank" rel="noreferrer">NeuroVault</a>
          </div>
        </Panel>

        <Panel className="p-5">
          <Activity size={17} className="text-sky-200/70" />
          <div className="mt-5 text-sm font-medium text-slate-200">Allen Brain Atlas</div>
          <p className="mt-2 text-xs leading-5 text-slate-600">Human and animal anatomical ontology, reference atlas and molecular brain data through the Allen RMA API.</p>
          <a className="mt-4 inline-flex items-center gap-2 text-xs text-sky-200" href="https://brain-map.org/" target="_blank" rel="noreferrer">
            Brain Map <ExternalLink size={12} />
          </a>
        </Panel>
      </div>
    </div>
  );
}

function DatasetCard({ dataset }: { dataset: PublicDataset }) {
  return (
    <a
      href={dataset.url}
      target="_blank"
      rel="noreferrer"
      className="group rounded-xl border border-white/[.07] bg-black/10 p-4 transition hover:border-sky-300/20 hover:bg-white/[.025]"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="tag">{dataset.source || "PUBLIC"}</span>
        <ExternalLink size={12} className="text-slate-700 transition group-hover:text-slate-400" />
      </div>
      <div className="mt-5 font-mono text-[10px] text-sky-300">{dataset.id}</div>
      <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-5 text-slate-200">{dataset.title}</h3>
      <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-600">{dataset.description || "No description supplied."}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {dataset.version ? <span className="tag-muted">{dataset.version}</span> : null}
        {(dataset.modalities || []).slice(0, 3).map((modality) => (
          <span className="tag-muted" key={modality}>{modality}</span>
        ))}
      </div>
    </a>
  );
}
