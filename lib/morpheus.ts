export type GatewayStatus = {
  status: "online" | "offline";
  streams: number;
  timestamp: string;
  mode?: string;
};

export type StreamInfo = {
  name: string;
  type: string;
  channel_count: number;
  nominal_srate: number;
  source_id: string;
  uid?: string;
  hostname?: string;
  channel_format?: string | number;
  channel_labels?: string[];
  channel_units?: string[];
};

export type SamplePacket = {
  stream: string;
  ts: number;
  channels: number[];
  simulated?: boolean;
};

export type WorkstationView =
  | "workspace"
  | "overview"
  | "acquisition"
  | "dataset"
  | "experiments"
  | "programs"
  | "models"
  | "simulation"
  | "public-data"
  | "visual"
  | "system";

export type DreamRecord = {
  dream_id: string;
  captured_at: string;
  raw_report: string;
  raw_sha256: string;
  lucid: boolean;
  confidence: number;
  tags: string[];
  sensory_modalities: string[];
};

export type MarkerEvent = {
  id: string;
  label: string;
  timestamp: number;
  source: "local" | "gateway";
  clock_domain?: string;
  wall_timestamp?: number;
};

export type PublicDataset = {
  id: string;
  source?: string;
  title: string;
  description: string;
  version: string;
  modified: string;
  url: string;
  modalities?: string[];
  color?: string | null;
};

export type PublicDataSource = {
  id: string;
  label: string;
  route: string;
  ok: boolean;
  latency_ms: number;
  datasets: PublicDataset[];
  error?: string | null;
};

export type ModelWorkerState = {
  id: string;
  name: string;
  kind: "dsp" | "feature" | "simulation" | "inference";
  status: "idle" | "running" | "ready" | "error";
  backend: "browser-worker" | "gateway" | "gpu";
  lastLatencyMs?: number;
};

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function buildWebSocketUrl(gateway: string, path = "/ws/samples") {
  if (typeof window === "undefined") return "";
  const normalized = gateway.replace(/\/$/, "");
  if (/^https?:\/\//i.test(normalized)) {
    return `${normalized.replace(/^http/i, "ws")}${path}`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${normalized}${path}`;
}

export function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
