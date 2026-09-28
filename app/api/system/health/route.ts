import { NextRequest } from "next/server";

type Probe = {
  id: string;
  ok: boolean;
  latency_ms: number;
  status?: number;
  error?: string;
};

async function probe(url: URL): Promise<Probe> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    return {
      id: url.pathname,
      ok: response.ok,
      status: response.status,
      latency_ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      id: url.pathname,
      ok: false,
      latency_ms: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : "probe failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const targets = [
    new URL("/api/health", origin),
    new URL("/api/public-data/catalog?q=sleep", origin),
  ];

  const probes = await Promise.all(targets.map(probe));

  return Response.json({
    service: "morpheus-workstation",
    version: "0.3.0",
    ok: probes.every((item) => item.ok),
    probes,
    capabilities: {
      multichannel_ring_buffers: true,
      browser_dsp_worker: true,
      synthetic_brain_simulations: true,
      nifti_volume_import: true,
      gpu_volume_raycast: true,
      multiplanar_slices: true,
      public_neurodata_fabric: true,
      dataset_zero_local_hashing: true,
      m0_m5_program_registry: true,
      local_lsl_gateway: true,
    },
    timestamp: new Date().toISOString(),
  });
}
