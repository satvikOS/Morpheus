"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Activity,
  DatabaseZap,
  ExternalLink,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  Waves,
} from "lucide-react";
import type {
  PublicDataSource,
  PublicDataset,
} from "@/lib/morpheus";
import PublicDataGraph, {
  type KnowledgeRecord,
} from "./public-data-graph";
import {
  listKnowledgeRecords,
  upsertKnowledgeRecords,
} from "@/lib/public-graph-store";
import {
  EmptyState,
  Panel,
  SectionHeader,
  StatusDot,
} from "./ui";

type CatalogResponse = {
  ok: boolean;
  query: string;
  sources: PublicDataSource[];
  fetched_at?: string;
};

const presets = [
  "sleep",
  "EEG",
  "memory",
  "hippocampus",
  "dream",
  "human",
];

export default function PublicDataPanel() {
  const [query, setQuery] = useState("sleep");
  const [sources, setSources] = useState<PublicDataSource[]>([]);
  const [activeSource, setActiveSource] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState(true);
  const [records, setRecords] = useState<KnowledgeRecord[]>([]);
  const [ingestCycles, setIngestCycles] = useState(0);
  const [newRecords, setNewRecords] = useState(0);
  const [lastIngest, setLastIngest] = useState("");
  const [graphLoaded, setGraphLoaded] = useState(false);

  const mergeIntoGraph = useCallback(
    (nextSources: PublicDataSource[]) => {
      const incoming: KnowledgeRecord[] = [];

      for (const source of nextSources) {
        for (const dataset of source.datasets || []) {
          const graphKey = `${source.id}:${dataset.id}:${dataset.version || ""}`;
          incoming.push({
            ...dataset,
            source: dataset.source || source.label,
            sourceId: source.id,
            graphKey,
            firstSeenAt: Date.now(),
          });
        }
      }

      setRecords((current) => {
        const seen = new Set(
          current.map((record) => record.graphKey),
        );
        const additions = incoming.filter(
          (record) => !seen.has(record.graphKey),
        );
        setNewRecords(additions.length);

        if (additions.length) {
          void upsertKnowledgeRecords(additions);
        }

        const merged = [...current, ...additions];
        return merged.slice(-1200);
      });
      setIngestCycles((value) => value + 1);
      setLastIngest(new Date().toISOString());
    },
    [],
  );

  const search = useCallback(
    async (value: string, background = false) => {
      if (!background) setLoading(true);
      setError("");

      try {
        const response = await fetch(
          `/api/public-data/catalog?q=${encodeURIComponent(value)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as CatalogResponse;

        if (!response.ok) {
          throw new Error(
            "Public data catalog request failed.",
          );
        }

        const nextSources = payload.sources ?? [];
        setSources(nextSources);
        mergeIntoGraph(nextSources);
      } catch (reason) {
        if (!background) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to query public neuroscience sources.",
          );
        }
      } finally {
        if (!background) setLoading(false);
      }
    },
    [mergeIntoGraph],
  );

  useEffect(() => {
    let active = true;

    void listKnowledgeRecords()
      .then((stored) => {
        if (!active) return;
        setRecords(stored);
        setGraphLoaded(true);
      })
      .catch(() => {
        if (active) setGraphLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!graphLoaded) return;
    void search("sleep");
  }, [graphLoaded, search]);

  useEffect(() => {
    if (!live) return;

    const timer = window.setInterval(() => {
      void search(query, true);
    }, 5 * 60 * 1000);

    return () => window.clearInterval(timer);
  }, [live, query, search]);

  const datasets = useMemo(() => {
    const selected =
      activeSource === "all"
        ? sources
        : sources.filter(
            (source) => source.id === activeSource,
          );

    return selected.flatMap((source) =>
      source.datasets.map((dataset) => ({
        ...dataset,
        source: dataset.source || source.label,
      })),
    );
  }, [activeSource, sources]);

  const onlineCount = sources.filter(
    (source) => source.ok,
  ).length;
  const anonymousApiCount = sources.filter(
    (source) => source.access_mode === "anonymous-api",
  ).length;

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader
          eyebrow="Federated neuroscience data fabric"
          title="Public research sources"
          description="Morpheus queries anonymous public APIs directly through isolated server-side adapters and represents credentialed or controlled repositories explicitly instead of pretending that restricted research data are public."
          action={
            <div className="public-data-live-control">
              <StatusDot online={onlineCount > 0} />
              <span>
                {onlineCount}/{anonymousApiCount || 5} live API adapters
              </span>
              <button
                onClick={() => setLive((value) => !value)}
                className={live ? "mode-pill mode-pill-live" : "mode-pill"}
              >
                {live ? <Pause size={11} /> : <Play size={11} />}
                {live ? "LIVE INGEST" : "PAUSED"}
              </button>
            </div>
          }
        />

        <div className="p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                size={14}
              />
              <input
                value={query}
                onChange={(event) =>
                  setQuery(event.target.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void search(query);
                  }
                }}
                placeholder="Search sleep, EEG, hippocampus, memory..."
                className="public-data-search"
              />
            </div>
            <button
              onClick={() => void search(query)}
              className="button-primary px-4"
            >
              {loading ? (
                <RefreshCw
                  size={14}
                  className="animate-spin"
                />
              ) : (
                <Search size={14} />
              )}
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
                className="tag-muted hover:!text-slate-200"
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="public-ingest-line">
            <span>
              Persistent graph records: {records.length}
            </span>
            <span>
              Last ingest:{" "}
              {lastIngest
                ? new Date(lastIngest).toLocaleTimeString()
                : "—"}
            </span>
            <span>
              Poll cadence: {live ? "5 min" : "paused"} · IndexedDB retained
            </span>
          </div>
        </div>
      </Panel>

      <Panel>
        <PublicDataGraph
          sources={sources}
          records={records}
          ingestCycles={ingestCycles}
          newRecords={newRecords}
          live={live}
        />
      </Panel>

      <Panel>
        <SectionHeader
          eyebrow="Source matrix"
          title="Repository and access state"
          description="A grey source is not treated as an outage when its upstream service requires registration, authentication, a data-use agreement, or a separate licence."
        />
        <div className="public-source-grid">
          {sources.length
            ? sources.map((source) => (
                <button
                  key={source.id}
                  onClick={() =>
                    setActiveSource((current) =>
                      current === source.id
                        ? "all"
                        : source.id,
                    )
                  }
                  className={`public-source-card ${
                    activeSource === source.id
                      ? "public-source-card-active"
                      : ""
                  }`}
                >
                  <div className="public-source-card-top">
                    <Server
                      size={15}
                      className="text-slate-500"
                    />
                    {source.access_mode === "anonymous-api" ? (
                      <StatusDot online={source.ok} />
                    ) : (
                      <span className="access-dot" />
                    )}
                  </div>

                  <div className="public-source-name">
                    {source.label}
                  </div>
                  <div className="public-source-institution">
                    {source.institution ||
                      source.platform ||
                      "Research source"}
                  </div>

                  <div className="public-source-access">
                    {formatAccess(source.access_mode)}
                  </div>

                  <div className="public-source-status">
                    {source.ok
                      ? `${source.datasets.length} results · ${source.latency_ms} ms`
                      : source.status_note ||
                        source.error ||
                        "No anonymous adapter"}
                  </div>
                </button>
              ))
            : Array.from({ length: 8 }).map(
                (_, index) => (
                  <div
                    key={index}
                    className="h-32 animate-pulse rounded-lg border border-white/[.06] bg-white/[.015]"
                  />
                ),
              )}
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          eyebrow={
            activeSource === "all"
              ? "Unified results"
              : sources.find(
                    (source) =>
                      source.id === activeSource,
                  )?.label || "Results"
          }
          title="Neuroscience datasets and atlas entities"
          action={
            <span className="tag-muted">
              {datasets.length} LOADED
            </span>
          }
        />

        {error ? (
          <div className="border-b border-red-400/10 bg-red-400/[.03] px-5 py-3 text-xs text-red-300/80">
            {error}
          </div>
        ) : null}

        {datasets.length ? (
          <div className="public-result-grid">
            {datasets.map((dataset, index) => (
              <DatasetCard
                key={`${dataset.source}-${dataset.id}-${index}`}
                dataset={dataset}
              />
            ))}
          </div>
        ) : (
          <EmptyState>
            {loading
              ? "Querying public archives..."
              : "No matching anonymous API data returned for this source/query."}
          </EmptyState>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="p-5">
          <DatabaseZap
            size={17}
            className="text-slate-300"
          />
          <div className="mt-5 text-sm font-medium text-slate-100">
            Neurophysiology
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            DANDI contributes NWB-oriented
            electrophysiology and imaging metadata to the
            live graph.
          </p>
          <a
            className="public-source-link"
            href="https://dandiarchive.org/"
            target="_blank"
            rel="noreferrer"
          >
            DANDI Archive <ExternalLink size={12} />
          </a>
        </Panel>

        <Panel className="p-5">
          <Waves
            size={17}
            className="text-slate-300"
          />
          <div className="mt-5 text-sm font-medium text-slate-100">
            Neuroimaging
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            OpenNeuro and NeuroVault supply BIDS dataset
            metadata, statistical maps, atlases and public
            NIfTI volumes.
          </p>
          <div className="mt-4 flex gap-4">
            <a
              className="public-source-link !mt-0"
              href="https://openneuro.org/"
              target="_blank"
              rel="noreferrer"
            >
              OpenNeuro
            </a>
            <a
              className="public-source-link !mt-0"
              href="https://neurovault.org/"
              target="_blank"
              rel="noreferrer"
            >
              NeuroVault
            </a>
          </div>
        </Panel>

        <Panel className="p-5">
          <Activity
            size={17}
            className="text-slate-300"
          />
          <div className="mt-5 text-sm font-medium text-slate-100">
            Brain atlases
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Allen Brain Map metadata is queried directly.
            Brainnetome, EBRAINS, HCP and controlled
            biobanks remain explicit access-gated sources
            until their required credentials or licences
            are configured.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function DatasetCard({
  dataset,
}: {
  dataset: PublicDataset;
}) {
  return (
    <a
      href={dataset.url}
      target="_blank"
      rel="noreferrer"
      className="public-result-card"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="tag">
          {dataset.source || "PUBLIC"}
        </span>
        <ExternalLink
          size={12}
          className="text-slate-600"
        />
      </div>
      <div className="mt-5 font-mono text-[10px] text-slate-400">
        {dataset.id}
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-5 text-slate-100">
        {dataset.title}
      </h3>
      <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-500">
        {dataset.description ||
          "No description supplied."}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {dataset.version ? (
          <span className="tag-muted">
            {dataset.version}
          </span>
        ) : null}
        {(dataset.modalities || [])
          .slice(0, 3)
          .map((modality) => (
            <span
              className="tag-muted"
              key={modality}
            >
              {modality}
            </span>
          ))}
      </div>
    </a>
  );
}

function formatAccess(
  access?: PublicDataSource["access_mode"],
) {
  switch (access) {
    case "anonymous-api":
      return "ANONYMOUS API";
    case "authenticated-api":
      return "AUTHENTICATED API";
    case "registration":
      return "REGISTRATION";
    case "controlled":
      return "CONTROLLED ACCESS";
    case "download-license":
      return "LICENCE GATE";
    case "portal":
      return "FEDERATED PORTAL";
    default:
      return "SOURCE";
  }
}
