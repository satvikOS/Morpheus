import { NextRequest } from "next/server";

type DandiRecord = Record<string, unknown>;

function object(value: unknown): DandiRecord {
  return value && typeof value === "object" ? value as DandiRecord : {};
}

function stringValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "electrophysiology";
  const endpoint = new URL("https://api.dandiarchive.org/api/dandisets/");
  endpoint.searchParams.set("page_size", "12");
  endpoint.searchParams.set("search", query);
  endpoint.searchParams.set("empty", "false");

  try {
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      return Response.json(
        { datasets: [], error: `DANDI returned ${response.status}` },
        { status: 502 },
      );
    }

    const payload = object(await response.json());
    const results = Array.isArray(payload.results) ? payload.results : [];

    const datasets = results.map((raw) => {
      const item = object(raw);
      const draft = object(item.draft_version);
      const published = object(item.most_recent_published_version);
      const version = Object.keys(published).length ? published : draft;
      const metadata = object(version.metadata ?? item.metadata);

      const identifier = stringValue(item.identifier, metadata.identifier, item.id)
        .replace(/^DANDI:/i, "");

      const versionName = stringValue(version.version, published.version, draft.version) || "draft";

      return {
        id: identifier || "unknown",
        title: stringValue(metadata.name, metadata.title, item.name) || `Dandiset ${identifier || "unknown"}`,
        description: stringValue(metadata.description, item.description),
        version: versionName,
        modified: stringValue(version.modified, item.modified, version.created, item.created),
        url: identifier
          ? `https://dandiarchive.org/dandiset/${identifier}/${versionName}`
          : "https://dandiarchive.org/",
      };
    });

    return Response.json({
      source: "DANDI Archive",
      query,
      datasets,
      fetched_at: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      {
        datasets: [],
        error: error instanceof Error ? error.message : "Unable to reach DANDI.",
      },
      { status: 502 },
    );
  }
}
