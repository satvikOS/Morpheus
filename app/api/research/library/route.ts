import { NextRequest } from "next/server";
import { getResearchLibrary, RESEARCH_DOMAINS } from "@/lib/research-registry";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const domain = request.nextUrl.searchParams.get("domain") ?? "all";
  if (domain !== "all" && !Object.hasOwn(RESEARCH_DOMAINS, domain)) {
    return Response.json({ ok: false, error: "Unknown research domain" }, { status: 400 });
  }
  return Response.json({ ok: true, ...getResearchLibrary(query, domain) });
}
