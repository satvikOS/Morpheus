import { NextRequest } from "next/server";
import { apiError, fetchJson } from "@/lib/server/http";

type ZenodoRecord = {
  id?: number | string;
  doi?: string;
  links?: { html?: string };
  metadata?: {
    title?: string;
    description?: string;
    publication_date?: string;
    resource_type?: { title?: string; type?: string; subtype?: string };
    keywords?: string[];
    creators?: Array<{ name?: string }>;
  };
  updated?: string;
  created?: string;
};

type ZenodoResponse = {
  hits?: {
    total?: number | { value?: number };
    hits?: ZenodoRecord[];
  };
};

export async function GET(request: NextRequest) {
  const rawQuery = (request.nextUrl.searchParams.get("q") || "brain EEG").trim();
  const query = rawQuery.length ? rawQuery : "brain EEG";

  const endpoint = new URL("https://zenodo.org/api/records");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("size", "16");
  endpoint.searchParams.set("sort", "bestmatch");

  try {
    const payload = await fetchJson<ZenodoResponse>(endpoint, {}, 10000);
    const records = payload.hits?.hits ?? [];

    const datasets = records.map((record) => {
      const metadata = record.metadata ?? {};
      const resourceType = metadata.resource_type?.title || metadata.resource_type?.type || "research record";
      const creator = metadata.creators?.[0]?.name;

      return {
        id: String(record.id ?? record.doi ?? "unknown"),
        source: "Zenodo",
        title: metadata.title || ("Zenodo record " + String(record.id ?? "")),
        description: [
          resourceType,
          creator ? ("by " + creator) : "",
          record.doi ? ("DOI: " + record.doi) : "",
        ].filter(Boolean).join(" · "),
        version: resourceType,
        modified: record.updated || record.created || metadata.publication_date || "",
        url: record.links?.html || (record.id ? ("https://zenodo.org/records/" + record.id) : "https://zenodo.org/"),
        modalities: (metadata.keywords ?? []).slice(0, 4),
      };
    });

    return Response.json({
      source: "Zenodo",
      ok: true,
      datasets,
      fetched_at: new Date().toISOString(),
    });
  } catch (error) {
    return apiError("Zenodo", error);
  }
}