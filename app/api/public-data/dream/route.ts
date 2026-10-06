import { NextRequest } from "next/server";
import { mapDreamPublicDatasets, parsePublicCsv } from "@/lib/research-registry";
import { apiError, fetchJson } from "@/lib/server/http";

type FigshareRegistry = {
  version?: number;
  doi?: string;
  license?: { name?: string; url?: string };
  files?: Array<{ name?: string; download_url?: string; computed_md5?: string; size?: number }>;
};

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 200);
  try {
    const registry = await fetchJson<FigshareRegistry>("https://api.figshare.com/v2/articles/22133105", {}, 8000);
    const file = registry.files?.find((item) => item.name === "Datasets.csv");
    if (!file?.download_url || !/^https:\/\/ndownloader\.figshare\.com\/files\/\d+$/.test(file.download_url)) {
      throw new Error("DREAM public metadata download endpoint changed");
    }
    if (file.size && file.size > 2_000_000) throw new Error("DREAM registry exceeds metadata size limit");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let csv: string;
    try {
      const response = await fetch(file.download_url, { cache: "no-store", signal: controller.signal, headers: { accept: "text/csv" } });
      if (!response.ok) throw new Error(`DREAM registry download returned ${response.status}`);
      csv = await response.text();
      if (csv.length > 2_000_000) throw new Error("DREAM registry exceeds metadata size limit");
    } finally { clearTimeout(timer); }
    const allDatasets = mapDreamPublicDatasets(parsePublicCsv(csv));
    const datasets = allDatasets.filter((item) => !q || [item.title, item.description, ...item.modalities].join(" ").toLowerCase().includes(q));
    return Response.json({
      ok: true, source: "DREAM", datasets, registry_version: registry.version ?? null,
      registry_doi: registry.doi ?? null, registry_license: registry.license?.name ?? "Check upstream registry terms",
      registry_file_md5: file.computed_md5 ?? null, active_dataset_count: allDatasets.length,
      open_dataset_count: allDatasets.filter((item) => item.access === "Open").length,
      fetched_at: new Date().toISOString(),
      primary_publication: "https://www.nature.com/articles/s41467-025-61945-1",
      report_labels: ["Experience", "No experience", "Without recall", "No experience or without recall", "Unknown"],
      limitations: ["Public registry metadata only; no raw neural signals or dream reports are fetched.", "Dataset counts exclude revoked and superseded amendments. Participants may overlap between studies.", "Without recall is separate from No experience; ambiguous labels must not become binary training targets."],
    });
  } catch (error) { return apiError("DREAM", error); }
}
