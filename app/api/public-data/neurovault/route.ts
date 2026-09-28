import { NextRequest } from "next/server";
import { apiError, fetchJson } from "@/lib/server/http";

type NeuroVaultCollection = {
  id?: number | string;
  name?: string;
  description?: string;
  DOI?: string | null;
  doi?: string | null;
  modify_date?: string;
  add_date?: string;
  url?: string;
};

type NeuroVaultResponse = {
  results?: NeuroVaultCollection[];
};

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  const endpoint = new URL("https://neurovault.org/api/collections/");
  endpoint.searchParams.set("limit", "40");
  if (q) endpoint.searchParams.set("name", q);

  try {
    const payload = await fetchJson<NeuroVaultResponse | NeuroVaultCollection[]>(endpoint, {}, 9000);
    const raw = Array.isArray(payload) ? payload : payload.results ?? [];

    const datasets = raw.slice(0, 16).map((item) => ({
      id: String(item.id ?? "unknown"),
      source: "NeuroVault",
      title: item.name || `Collection ${item.id ?? ""}`,
      description: item.description || (item.DOI || item.doi ? `DOI: ${item.DOI || item.doi}` : "Open brain statistical maps and atlases"),
      version: "collection",
      modified: item.modify_date || item.add_date || "",
      url: item.url || (item.id ? `https://neurovault.org/collections/${item.id}/` : "https://neurovault.org/"),
      modalities: ["MRI", "PET", "statistical maps"],
    }));

    return Response.json({
      source: "NeuroVault",
      ok: true,
      datasets,
      fetched_at: new Date().toISOString(),
    });
  } catch (error) {
    return apiError("NeuroVault", error);
  }
}
