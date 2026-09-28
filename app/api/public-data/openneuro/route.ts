import { NextRequest } from "next/server";
import { apiError, fetchJson } from "@/lib/server/http";

type OpenNeuroEdge = {
  node?: {
    id?: string;
    name?: string;
    publishDate?: string | null;
    latestSnapshot?: {
      tag?: string;
      created?: string;
      description?: {
        Name?: string;
        DatasetDOI?: string;
      };
    } | null;
  };
};

type OpenNeuroResponse = {
  data?: {
    datasets?: {
      edges?: OpenNeuroEdge[];
    };
  };
  errors?: Array<{ message?: string }>;
};

const QUERY = `
query MorpheusPublicDatasets($count: Int) {
  datasets(
    first: $count
    orderBy: { created: descending }
    filterBy: { public: true }
  ) {
    edges {
      node {
        id
        name
        publishDate
        latestSnapshot {
          tag
          created
          description {
            Name
            DatasetDOI
          }
        }
      }
    }
  }
}
`;

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

  try {
    const payload = await fetchJson<OpenNeuroResponse>(
      "https://openneuro.org/crn/graphql",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: QUERY,
          variables: { count: 60 },
        }),
      },
      10000,
    );

    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).filter(Boolean).join("; "));
    }

    const datasets = (payload.data?.datasets?.edges ?? [])
      .map((edge) => {
        const node = edge.node ?? {};
        const snapshot = node.latestSnapshot ?? {};
        const description = snapshot.description ?? {};
        const id = node.id || "";
        const title = description.Name || node.name || id;
        return {
          id,
          source: "OpenNeuro",
          title,
          description: description.DatasetDOI ? `DOI: ${description.DatasetDOI}` : "Public BIDS neuroimaging dataset",
          version: snapshot.tag || "latest",
          modified: snapshot.created || node.publishDate || "",
          url: id ? `https://openneuro.org/datasets/${id}` : "https://openneuro.org/",
          modalities: ["BIDS"],
        };
      })
      .filter((item) => !q || `${item.id} ${item.title} ${item.description}`.toLowerCase().includes(q))
      .slice(0, 16);

    return Response.json({
      source: "OpenNeuro",
      ok: true,
      datasets,
      fetched_at: new Date().toISOString(),
    });
  } catch (error) {
    return apiError("OpenNeuro", error);
  }
}
