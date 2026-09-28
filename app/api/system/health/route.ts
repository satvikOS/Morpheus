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
    version: "0.7.0",
    ok: probes.every((item) => item.ok),
    probes,
    capabilities: {
      native_rust_ring_buffers: true,
      native_mrph_binary_protocol: true,
      native_fft_and_notch_primitives: true,
      native_gateway_recorder: true,
      native_udp_bridge: true,
      multichannel_ring_buffers: true,
      shared_array_buffer_signal_path: true,
      worker_owned_websocket: true,
      optional_webrtc_data_channel: true,
      webgl2_signal_renderer: true,
      offscreen_canvas_signal_renderer: true,
      minmax_signal_envelope: true,
      gateway_clock_sync: true,
      reliable_webrtc_control_channel: true,
      persistent_operational_views: true,
      sealed_session_manifest_sha256: true,
      public_neuroanatomy_presets: true,
      live_public_knowledge_graph_3d: true,
      persistent_public_knowledge_graph_indexeddb: true,
      neurovault_live_volume_presets: true,
      volume_derived_voxel_field: true,
      volume_derived_region_topology: true,
      source_access_classification: true,
      hosted_clock_guard: true,
      browser_dsp_worker: true,
      synthetic_brain_simulations: true,
      nifti_volume_import: true,
      gpu_volume_raycast: true,
      multiplanar_slices: true,
      public_neurodata_fabric: true,
      dataset_zero_local_hashing: true,
      dataset_zero_indexeddb: true,
      marker_gateway_clock_authority: true,
      m0_dataset_zero_execution: true,
      m1_recurrence_null_baseline: true,
      m2_reinstatement_trial_runner: true,
      m3_heldout_permutation_harness: true,
      m4_native_binary_acquisition_path: true,
      m5_subject_local_atlas_builder: true,
      m0_m5_program_registry: true,
      local_lsl_gateway: true,
    },
    timestamp: new Date().toISOString(),
  });
}
