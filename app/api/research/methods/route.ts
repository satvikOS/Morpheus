import type { NextRequest } from "next/server";
import { methodRecipeExport, queryMethodRecipes, type MethodDomain, type MethodStatus } from "@/lib/method-recipes";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    const query = queryMethodRecipes({ q: params.get("q") || "", status: (params.get("status") || "all") as MethodStatus | "all",
      domain: (params.get("domain") || "all") as MethodDomain | "all", paperId: params.get("paperId") || undefined,
      offset: Number(params.get("offset") || 0), limit: Number(params.get("limit") || 25) });
    return Response.json({ ok: true, ...query, ...(params.get("format") === "export" ? { export: methodRecipeExport(query.methods) } : {}) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Method query failed." }, { status: 400 });
  }
}
