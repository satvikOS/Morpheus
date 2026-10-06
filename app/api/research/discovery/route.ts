import type { NextRequest } from "next/server";
import { mapDiscoveredPaper, METHOD_REGISTRY_VERSION, normalizedDoi } from "@/lib/method-recipes";

/** Public metadata only. Arbitrary paper/code URLs never become execution endpoints. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = (params.get("q") || "neuroscience dreams memory").trim();
  const cursor = params.get("cursor") || "*";
  const limit = Number(params.get("limit") || 25);
  const doiInput = params.get("doi");
  const doi = doiInput ? normalizedDoi(doiInput) : null;
  if (query.length > 256 || cursor.length > 8192 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (doiInput && !doi)) return Response.json({ ok: false, error: "Use a bounded query/cursor, a limit from 1 to 100, or a valid DOI." }, { status: 400 });
  const upstream = new URL(doi ? "https://api.crossref.org/works/" + encodeURIComponent(doi) : "https://api.crossref.org/works");
  if (!doi) {
    upstream.searchParams.set("query", query);
    upstream.searchParams.set("rows", String(limit));
    upstream.searchParams.set("cursor", cursor);
    upstream.searchParams.set("filter", "type:journal-article");
    upstream.searchParams.set("select", "DOI,title,published,type");
  }
  try {
    const response = await fetch(upstream, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json", "user-agent": "Morpheus-Research-Metadata/0.8 (bounded-public-discovery)" }, next: { revalidate: 900 } });
    if (!response.ok) return Response.json({ ok: false, error: response.status === 429 ? "Crossref rate limit reached. Retry later." : "Crossref metadata is temporarily unavailable.", source: "Crossref", upstreamStatus: response.status }, { status: response.status === 429 ? 429 : 502 });
    const payload = await response.json() as { message?: { items?: Record<string, unknown>[]; "next-cursor"?: string; "total-results"?: number } & Record<string, unknown> };
    if (!payload.message || (!doi && !Array.isArray(payload.message.items))) throw new Error("Crossref metadata schema changed.");
    const raw = doi ? [payload.message] : payload.message.items!;
    const items = raw.slice(0, limit).map(mapDiscoveredPaper);
    const nextCursor = !doi && raw.length >= limit && typeof payload.message["next-cursor"] === "string" && payload.message["next-cursor"].length <= 8192 ? payload.message["next-cursor"] : null;
    return Response.json({ ok: true, schema: "morpheus-paper-discovery-v1", methodRegistryVersion: METHOD_REGISTRY_VERSION,
      source: "Crossref", sourceUrl: upstream.toString(), query: doi || query, total: doi ? 1 : payload.message["total-results"] ?? null,
      limit, nextCursor, items, interpretation: "Metadata discovery maps exact DOIs to reviewed software adapters. An available adapter is an analysis adaptation, not paper reproduction or automatic execution." });
  } catch {
    return Response.json({ ok: false, error: "Crossref metadata request failed or timed out. Retry later.", source: "Crossref" }, { status: 502 });
  }
}
