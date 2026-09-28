import { NextRequest } from "next/server";

const sources = [
  { id: "dandi", label: "DANDI", route: "/api/public-data/dandi" },
  { id: "openneuro", label: "OpenNeuro", route: "/api/public-data/openneuro" },
  { id: "neurovault", label: "NeuroVault", route: "/api/public-data/neurovault" },
  { id: "allen", label: "Allen Brain Atlas", route: "/api/public-data/allen" },
];

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") || "";
  const origin = request.nextUrl.origin;

  const results = await Promise.all(
    sources.map(async (source) => {
      const url = new URL(source.route, origin);
      if (q) url.searchParams.set("q", q);
      const started = performance.now();
      try {
        const response = await fetch(url, { cache: "no-store" });
        const payload = await response.json();
        return {
          ...source,
          ok: response.ok && payload.ok !== false,
          latency_ms: Math.round(performance.now() - started),
          datasets: Array.isArray(payload.datasets) ? payload.datasets : [],
          error: payload.error || null,
        };
      } catch (error) {
        return {
          ...source,
          ok: false,
          latency_ms: Math.round(performance.now() - started),
          datasets: [],
          error: error instanceof Error ? error.message : "Failed",
        };
      }
    }),
  );

  return Response.json({
    ok: results.some((source) => source.ok),
    query: q,
    sources: results,
    fetched_at: new Date().toISOString(),
  });
}
