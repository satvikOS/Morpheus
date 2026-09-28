import { NextRequest } from "next/server";
import { apiError, fetchJson } from "@/lib/server/http";

type AllenStructure = {
  id?: number;
  name?: string;
  acronym?: string;
  graph_order?: number;
  hemisphere_id?: number;
  structure_id_path?: string;
  color_hex_triplet?: string;
};

type AllenResponse = {
  success?: boolean;
  msg?: AllenStructure[];
  total_rows?: number;
};

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") || "hippocampus").trim().replace(/['"]/g, "");
  const criteria = [
    "model::Structure",
    "rma::criteria",
    `[name$il'*${q}*']`,
    "ontology[name$eq'Human Brain Atlas']",
    "rma::options[num_rows$eq20]",
  ].join(",");

  const endpoint = new URL("https://api.brain-map.org/api/v2/data/query.json");
  endpoint.searchParams.set("criteria", criteria);

  try {
    const payload = await fetchJson<AllenResponse>(endpoint, {}, 9000);
    const datasets = (payload.msg ?? []).map((item) => ({
      id: String(item.id ?? "unknown"),
      source: "Allen Brain Atlas",
      title: item.name || item.acronym || "Brain structure",
      description: [
        item.acronym ? `Acronym ${item.acronym}` : "",
        item.structure_id_path ? `Ontology path ${item.structure_id_path}` : "",
      ].filter(Boolean).join(" · "),
      version: "Human Brain Atlas",
      modified: "",
      url: "https://brain-map.org/",
      modalities: ["anatomy", "atlas", "gene expression"],
      color: item.color_hex_triplet || null,
    }));

    return Response.json({
      source: "Allen Brain Atlas",
      ok: true,
      total: payload.total_rows ?? datasets.length,
      datasets,
      fetched_at: new Date().toISOString(),
    });
  } catch (error) {
    return apiError("Allen Brain Atlas", error);
  }
}
