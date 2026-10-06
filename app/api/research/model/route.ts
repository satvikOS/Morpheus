import type { NextRequest } from "next/server";
import { UNIFIED_GRAPH_SCHEMA, unifiedModel, unifiedSlots, unifiedGraphSummary, unifiedContributionManifest, queryUnifiedContributions, type ContributionStatus, type UnifiedSlotId } from "@/lib/unified-model";

/** Public model architecture/admission metadata; private rows and weights are local gateway data. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    const format = params.get("format") || "graph";
    if (!["graph", "manifest", "export"].includes(format)) throw new Error("Unknown model export format.");
    const page = queryUnifiedContributions({ q: params.get("q") || "", status: (params.get("status") || "all") as ContributionStatus | "all",
      slot: (params.get("slot") || "all") as UnifiedSlotId | "all", paperId: params.get("paperId") || undefined,
      offset: Number(params.get("offset") || 0), limit: Number(params.get("limit") || 25), graphVersion: params.get("graphVersion") || undefined });
    const payload = { ok: true, schema: UNIFIED_GRAPH_SCHEMA, model: unifiedModel, slots: unifiedSlots, summary: unifiedGraphSummary(), ...page,
      ...(format !== "graph" ? { contributionManifest: await unifiedContributionManifest() } : {}) };
    return Response.json({ ...payload, ...(format === "export" ? { export: { schema: UNIFIED_GRAPH_SCHEMA, graphVersion: page.graphVersion, model: unifiedModel, slots: unifiedSlots, contributions: page.contributions,
      page: { offset: page.offset, limit: page.limit, total: page.total, nextOffset: page.nextOffset }, contributionManifest: payload.contributionManifest,
      interpretation: "The complete frozen admission manifest is separate from this exploration page. No private training rows, checkpoint weights or paper-reproduction claims are exported." } } : {}) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unified model query failed." }, { status: 400 });
  }
}
