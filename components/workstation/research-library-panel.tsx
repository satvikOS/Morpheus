"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import {
  getResearchLibrary,
  RESEARCH_DOMAINS,
  type DreamPublicDataset,
  type ResearchDataset,
  type ResearchHypothesis,
  type ResearchModel,
  type ResearchPaper,
} from "@/lib/research-registry";

type Library = ReturnType<typeof getResearchLibrary>;
type Tab = "papers" | "hypotheses" | "datasets" | "models";
type Entry = ResearchPaper | ResearchDataset | ResearchHypothesis | ResearchModel;
type DreamResponse = {
  ok: boolean;
  datasets: DreamPublicDataset[];
  registry_version: number;
  fetched_at: string;
  active_dataset_count: number;
  open_dataset_count: number;
  error?: string;
};

const tabs: { id: Tab; label: string }[] = [
  { id: "papers", label: "Studies" }, { id: "hypotheses", label: "Testable hypotheses" },
  { id: "datasets", label: "Datasets" }, { id: "models", label: "Models and methods" },
];
const speciesLabels: Record<ResearchPaper["species"], string> = {
  human: "Human", mouse: "Mouse", "human-and-mouse": "Human and mouse", "cultured-neurons": "Cultured neurons",
};
const reviewLabels: Record<ResearchPaper["reviewStatus"], string> = {
  NOT_REVIEWED: "Not reviewed", SOURCE_REVIEWED: "Source checked", METHODS_REVIEWED: "Methods reviewed",
};
const reproductionLabels: Record<ResearchPaper["reproductionStatus"], string> = {
  NOT_REPRODUCED: "Not reproduced in Morpheus", ENGINEERING_BASELINE: "Engineering only", REPRODUCED: "Reproduced in Morpheus",
};

function SourceLink({ url, children }: { url: string; children: React.ReactNode }) {
  return <a className="research-library-source-link" href={url} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={12} aria-hidden="true" /></a>;
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return <section className="research-library-detail-section"><h4>{title}</h4><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}

export default function ResearchLibraryPanel() {
  const [library, setLibrary] = useState<Library>(() => getResearchLibrary());
  const [tab, setTab] = useState<Tab>("papers");
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("all");
  const [selectedId, setSelectedId] = useState("boyden-2005");
  const [libraryNote, setLibraryNote] = useState("");
  const [dream, setDream] = useState<DreamResponse | null>(null);
  const [dreamError, setDreamError] = useState("");
  const [dreamBusy, setDreamBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/research/library", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Library request failed");
        return response.json() as Promise<Library>;
      })
      .then(setLibrary)
      .catch((error) => { if (error.name !== "AbortError") setLibraryNote("Showing the bundled source registry. Reload to retry the library API."); });
    return () => controller.abort();
  }, []);

  const eligiblePapers = useMemo(() => library.papers.filter((paper) => domain === "all" || paper.domains.some((value) => value === domain)), [library, domain]);
  const entries = useMemo<Entry[]>(() => {
    const paperIds = new Set(eligiblePapers.map((paper) => paper.id));
    const hypothesisIds = new Set(eligiblePapers.flatMap((paper) => paper.hypothesisIds));
    const source: Entry[] = tab === "papers" ? eligiblePapers
      : tab === "hypotheses" ? library.hypotheses.filter((item) => domain === "all" || hypothesisIds.has(item.id))
      : library[tab].filter((item) => domain === "all" || item.paperIds.some((id) => paperIds.has(id)));
    const q = query.trim().toLowerCase();
    return source.filter((item) => !q || JSON.stringify(item).toLowerCase().includes(q));
  }, [eligiblePapers, library, tab, query, domain]);
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0];

  async function refreshDream() {
    setDreamBusy(true); setDreamError("");
    try {
      const response = await fetch("/api/public-data/dream", { cache: "no-store" });
      const payload = await response.json() as DreamResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "DREAM metadata could not be fetched");
      setDream(payload);
    } catch (error) { setDreamError(error instanceof Error ? error.message : "DREAM metadata could not be fetched"); }
    finally { setDreamBusy(false); }
  }

  function selectRelated(nextTab: Tab, id: string) {
    setQuery(""); setDomain("all"); setTab(nextTab); setSelectedId(id);
  }

  function relatedPapers(ids: string[]) {
    return <div className="research-library-related-links">{ids.map((id) => {
      const paper = library.papers.find((item) => item.id === id);
      return paper ? <button type="button" key={id} onClick={() => selectRelated("papers", id)}>{paper.authors}, {paper.year}</button> : null;
    })}</div>;
  }

  function relatedHypotheses(ids: string[]) {
    return <div className="research-library-related-links">{ids.map((id) => <button key={id} type="button" onClick={() => selectRelated("hypotheses", id)}>{id}</button>)}</div>;
  }

  function renderDetail(item: Entry) {
    if ("doi" in item) {
      return <>
        <p className="research-library-citation">{item.authors}. {item.journal}, {item.year}. {speciesLabels[item.species]}.</p>
        <div className="research-library-status-line"><span>{reviewLabels[item.reviewStatus]}</span><span>{reproductionLabels[item.reproductionStatus]}</span></div>
        <p>{item.finding}</p>
        <SourceLink url={item.url}>Read primary publication</SourceLink>
        <p className="research-library-doi">DOI {item.doi}</p>
        <DetailList title="What the experiment can establish" items={[item.modality]} />
        <DetailList title="Limits of interpretation" items={item.limitations} />
        <section className="research-library-detail-section"><h4>Related hypotheses</h4>{relatedHypotheses(item.hypothesisIds)}</section>
        {item.datasetIds.length > 0 && <section className="research-library-detail-section"><h4>Data references</h4><div className="research-library-related-links">{item.datasetIds.map((id) => <button key={id} type="button" onClick={() => selectRelated("datasets", id)}>{library.datasets.find((value) => value.id === id)?.title ?? id}</button>)}</div></section>}
        {item.modelIds.length > 0 && <section className="research-library-detail-section"><h4>Methods to inspect</h4><div className="research-library-related-links">{item.modelIds.map((id) => <button key={id} type="button" onClick={() => selectRelated("models", id)}>{library.models.find((value) => value.id === id)?.title ?? id}</button>)}</div></section>}
        <p className="research-library-review-note">{item.reviewNote}</p>
      </>;
    }
    if ("statement" in item) return <>
      <p>{item.statement}</p>
      <section className="research-library-detail-section"><h4>Measurable target</h4><p>{item.measurableTarget}</p></section>
      <section className="research-library-detail-section"><h4>Null prediction</h4><p>{item.null}</p></section>
      <DetailList title="Required controls and records" items={item.requirements} />
      <section className="research-library-detail-section"><h4>How to interpret a result</h4><p>{item.interpretation}</p></section>
      <section className="research-library-detail-section"><h4>Relevant studies</h4>{relatedPapers(library.papers.filter((paper) => paper.hypothesisIds.includes(item.id)).map((paper) => paper.id))}</section>
    </>;
    if ("target" in item) return <>
      <p>{item.modality}</p>
      <section className="research-library-detail-section"><h4>Measurement target</h4><p>{item.target}</p></section>
      <SourceLink url={item.url}>Open data source</SourceLink>
      <section className="research-library-detail-section"><h4>Access and license</h4><p>{item.license}</p>{item.licenseUrl && <SourceLink url={item.licenseUrl}>License text</SourceLink>}</section>
      <DetailList title="Before using these data" items={item.limitations} />
      <section className="research-library-detail-section"><h4>Primary studies</h4>{relatedPapers(item.paperIds)}</section>
      {item.id === "dream" && <section className="research-library-detail-section"><h4>Current public registry</h4><button type="button" className="research-library-refresh" onClick={() => void refreshDream()} disabled={dreamBusy}><RefreshCw size={14} aria-hidden="true" />{dreamBusy ? "Fetching metadata…" : "Refresh DREAM metadata"}</button>
        {dreamError && <p role="alert">{dreamError}. Retry the refresh or open the source above.</p>}
        {dream && <><p role="status">Registry version {dream.registry_version}: {dream.active_dataset_count} active datasets; {dream.open_dataset_count} marked open. Fetched {new Date(dream.fetched_at).toLocaleString()}.</p><ul className="research-library-live-datasets">{dream.datasets.map((dataset) => <li key={dataset.id}><SourceLink url={dataset.url}>{dataset.title}</SourceLink><span>{dataset.samples ?? "Unknown"} records · {dataset.access.toLowerCase()} access</span></li>)}</ul></>}
        <p className="research-library-review-note">Public metadata only. Keep “without recall” separate from “no experience.” Raw signals and dream reports remain at the source.</p>
      </section>}
    </>;
    return <>
      <div className="research-library-status-line"><span>{item.state === "BASELINE_IMPLEMENTED" ? "Implemented baseline" : "Reference method"}</span><span>{reproductionLabels[item.reproductionStatus]}</span></div>
      <SourceLink url={item.url}>Inspect method source</SourceLink>
      <DetailList title="Required inputs and environment" items={item.requirements} />
      <DetailList title="Evaluation targets" items={item.metrics} />
      <DetailList title="Limits of interpretation" items={item.limitations} />
      <section className="research-library-detail-section"><h4>License</h4><p>{item.license}</p></section>
      <section className="research-library-detail-section"><h4>Related hypotheses</h4>{relatedHypotheses(item.hypothesisIds)}</section>
      <section className="research-library-detail-section"><h4>Primary studies</h4>{relatedPapers(item.paperIds)}</section>
    </>;
  }

  return <section className="research-library" aria-labelledby="research-library-heading">
    <header className="research-library-header"><div><h2 id="research-library-heading">Research library</h2><p>Follow a result from its original experiment to the data, method and testable question.</p></div><span className="research-library-verified">Sources checked {library.verifiedAt}</span></header>
    <aside className="research-library-development"><SourceLink url={library.developments[0].url}>{library.developments[0].title}</SourceLink><p>{library.developments[0].description}</p></aside>
    <div className="research-library-toolbar"><label className="research-library-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search the research library</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search studies, methods or hypotheses" /></label><label className="research-library-filter">Research area<select value={domain} onChange={(event) => setDomain(event.target.value)}><option value="all">All areas</option>{Object.entries(RESEARCH_DOMAINS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
    <nav className="research-library-tabs" aria-label="Library sections">{tabs.map((item) => <button key={item.id} type="button" aria-pressed={tab === item.id} onClick={() => { setTab(item.id); setSelectedId(""); }}>{item.label}</button>)}</nav>
    {libraryNote && <p className="research-library-review-note" role="status">{libraryNote}</p>}
    <div className="research-library-layout"><div className="research-library-index"><div className="research-library-count">{entries.length} {tab === "papers" ? "studies" : "entries"}</div><table className="research-library-table"><thead><tr><th scope="col">{tab === "papers" ? "Study" : "Reference"}</th><th scope="col">{tab === "papers" ? "Evidence" : "Scope"}</th></tr></thead><tbody>{entries.map((item) => <tr key={item.id} data-selected={selected?.id === item.id}><td><button type="button" aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}>{item.title}</button><span>{"year" in item ? `${item.authors}, ${item.year}` : item.id}</span></td><td>{"species" in item ? speciesLabels[item.species] : "statement" in item ? "Research hypothesis" : "target" in item ? "Data source" : item.state === "BASELINE_IMPLEMENTED" ? "Engineering baseline" : "Reference method"}</td></tr>)}</tbody></table>
      {entries.length === 0 && <p className="research-library-empty">No entries match these filters. Clear the search or choose another research area.</p>}
    </div><article className="research-library-detail" aria-label="Selected research reference">{selected ? <><h3>{selected.title}</h3>{renderDetail(selected)}</> : <p>Select a reference to inspect its evidence and requirements.</p>}</article></div>
    <footer className="research-library-boundary"><p>{library.claimBoundary}</p><p>Art and cinema are creative research directions. Disease work requires separate datasets and validation; it is not a clinical capability of this workstation.</p></footer>
  </section>;
}
