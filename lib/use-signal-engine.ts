"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { buildWebSocketUrl } from "@/lib/morpheus";

export type SharedSignalRing = {
  data: Float32Array;
  control: Int32Array;
  capacity: number;
  maxChannels: number;
};

export type ClockSyncState = {
  ready: boolean;
  offsetSeconds: number;
  rttMs: number | null;
  uncertaintyMs: number | null;
  clockDomain: string;
  sampledAt: number | null;
};

export type MarkerEmitResult = {
  accepted: boolean;
  lsl_emitted?: boolean;
  transport: "webrtc-control" | "http" | "local-failed";
  marker?: {
    sequence?: number;
    label?: string;
    timestamp?: number;
    wall_timestamp?: number;
    clock_domain?: string;
    timestamp_method?: string;
    temporal_status?: "software_clock_mapped" | "gateway_arrival_only";
    hardware_trigger_verified?: boolean;
    sync_uncertainty_ms?: number | null;
  };
};

export type SignalEngineState = {
  ring: SharedSignalRing | null;
  snapshots: number[][];
  packetRate: number;
  frameRate: number;
  byteRate: number;
  sourceName: string;
  nominalSampleRate: number | null;
  sourceMode: "live" | "simulation" | "idle";
  dropped: number;
  transport: string;
  sharedMemory: boolean;
  clockSync: ClockSyncState;
  emitMarker: (
    label: string,
    payload?: Record<string, unknown>,
  ) => Promise<MarkerEmitResult>;
};

const CONTROL = {
  WRITE_INDEX: 0,
  CHANNELS: 1,
  TOTAL_FRAMES: 2,
  PACKET_RATE: 3,
  STATE: 4,
  SIMULATED: 5,
  DROPPED: 6,
  LAST_TS_MS: 7,
} as const;

const MAX_CHANNELS = 32;
const CAPACITY = 32768;
const SNAPSHOT_SAMPLES = 1024;
const MAX_MARKER_SYNC_UNCERTAINTY_MS = 5;

type PendingMarker = {
  resolve: (value: MarkerEmitResult) => void;
  reject: (reason?: unknown) => void;
  timer: number;
};

export function useSignalEngine(
  gateway: string,
  selectedSourceId: string,
  connectionEpoch: number,
): SignalEngineState {
  const [packetRate, setPacketRate] = useState(0);
  const [frameRate, setFrameRate] = useState(0);
  const [byteRate, setByteRate] = useState(0);
  const [sourceName, setSourceName] = useState("");
  const [nominalSampleRate, setNominalSampleRate] = useState<number | null>(null);
  const [sourceMode, setSourceMode] =
    useState<"live" | "simulation" | "idle">("idle");
  const [dropped, setDropped] = useState(0);
  const [transport, setTransport] = useState("initializing");
  const [snapshots, setSnapshots] = useState<number[][]>([]);
  const [clockSync, setClockSync] = useState<ClockSyncState>({
    ready: false,
    offsetSeconds: 0,
    rttMs: null,
    uncertaintyMs: null,
    clockDomain: "unsynchronized",
    sampledAt: null,
  });

  const controlChannelRef = useRef<RTCDataChannel | null>(null);
  const pendingMarkers = useRef(new Map<string, PendingMarker>());

  const ring = useMemo<SharedSignalRing | null>(() => {
    if (
      typeof window === "undefined" ||
      typeof SharedArrayBuffer === "undefined" ||
      !globalThis.crossOriginIsolated
    ) {
      return null;
    }

    try {
      const dataBuffer = new SharedArrayBuffer(
        Float32Array.BYTES_PER_ELEMENT * MAX_CHANNELS * CAPACITY,
      );
      const controlBuffer = new SharedArrayBuffer(
        Int32Array.BYTES_PER_ELEMENT * 16,
      );

      return {
        data: new Float32Array(dataBuffer),
        control: new Int32Array(controlBuffer),
        capacity: CAPACITY,
        maxChannels: MAX_CHANNELS,
      };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const synchronize = async (samplesPerRound: number) => {
      const candidates: Array<{
        offsetSeconds: number;
        rttMs: number;
        clockDomain: string;
        instanceId: string;
      }> = [];
      let stableForMarkers = true;
      let rejectedRuntime = "";

      for (let index = 0; index < samplesPerRound; index += 1) {
        if (cancelled) return;

        const t0 = performance.now() / 1000;
        try {
          const response = await fetch(
            `${gateway.replace(/\/$/, "")}/clock?nonce=${crypto.randomUUID()}`,
            { cache: "no-store" },
          );
          const t1 = performance.now() / 1000;

          if (response.ok) {
            const payload = await response.json();
            const remote = Number(payload.clock_time);
            stableForMarkers = payload.stable_for_markers !== false;
            rejectedRuntime = String(payload.runtime || "");
            const instanceId = String(payload.instance_id || "unknown");

            if (stableForMarkers && Number.isFinite(remote)) {
              candidates.push({
                offsetSeconds: remote - (t0 + t1) / 2,
                rttMs: (t1 - t0) * 1000,
                clockDomain: String(payload.clock_domain || "gateway_clock"),
                instanceId,
              });
            }
          }
        } catch {}

        if (index + 1 < samplesPerRound) {
          await new Promise((resolve) => window.setTimeout(resolve, 35));
        }
      }

      if (!stableForMarkers || !candidates.length || cancelled) {
        setClockSync({
          ready: false,
          offsetSeconds: 0,
          rttMs: null,
          uncertaintyMs: null,
          clockDomain:
            rejectedRuntime === "hosted"
              ? "hosted_gateway_not_authoritative"
              : "unsynchronized",
          sampledAt: Date.now(),
        });
        return;
      }

      const grouped = new Map<string, typeof candidates>();
      for (const candidate of candidates) {
        const list = grouped.get(candidate.instanceId) || [];
        list.push(candidate);
        grouped.set(candidate.instanceId, list);
      }

      const coherent = Array.from(grouped.values()).sort(
        (a, b) => b.length - a.length,
      )[0] || [];

      if (coherent.length < Math.min(3, samplesPerRound)) {
        setClockSync({
          ready: false,
          offsetSeconds: 0,
          rttMs: null,
          uncertaintyMs: null,
          clockDomain: "gateway_instance_unstable",
          sampledAt: Date.now(),
        });
        return;
      }

      coherent.sort((a, b) => a.rttMs - b.rttMs);
      const candidatesForEstimate = coherent;
      const best = candidatesForEstimate.slice(
        0,
        Math.min(3, candidatesForEstimate.length),
      );
      const offsets = best
        .map((candidate) => candidate.offsetSeconds)
        .sort((a, b) => a - b);
      const medianOffset = offsets[Math.floor(offsets.length / 2)];
      const spreadMs =
        offsets.length > 1
          ? (offsets[offsets.length - 1] - offsets[0]) * 1000
          : 0;
      const bestRtt = best[0].rttMs;
      const uncertaintyMs = Math.max(bestRtt / 2, spreadMs / 2);
      const acceptableForMarkers =
        uncertaintyMs <= MAX_MARKER_SYNC_UNCERTAINTY_MS;

      setClockSync({
        ready: acceptableForMarkers,
        offsetSeconds: acceptableForMarkers ? medianOffset : 0,
        rttMs: bestRtt,
        uncertaintyMs,
        clockDomain: acceptableForMarkers
          ? best[0].clockDomain
          : "gateway_clock_uncertainty_too_high",
        sampledAt: Date.now(),
      });
    };

    void synchronize(7);
    const timer = window.setInterval(() => void synchronize(4), 10000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [gateway, connectionEpoch]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    let worker: Worker | null = null;
    let peer: RTCPeerConnection | null = null;
    let sampleChannel: RTCDataChannel | null = null;
    let controlChannel: RTCDataChannel | null = null;
    if (ring) {
      ring.control.fill(0);
      ring.data.fill(0);
    }

    worker = new Worker("/workers/stream-worker.js");
    worker.postMessage({
      type: "init",
      maxChannels: MAX_CHANNELS,
      capacity: CAPACITY,
      dataBuffer: ring?.data.buffer,
      controlBuffer: ring?.control.buffer,
    });

    worker.onmessage = (event) => {
      const message = event.data || {};

      if (message.type === "metrics") {
        setPacketRate(Number(message.packetRate || 0));
        setFrameRate(Number(message.frameRate || 0));
        setByteRate(Number(message.byteRate || 0));
        setDropped(Number(message.dropped || 0));
        if (message.sourceName) setSourceName(String(message.sourceName));
        if (message.simulated) {
          setSourceMode("simulation");
        } else if (message.state === 2) {
          setSourceMode("live");
        }
        return;
      }

      if (message.type === "stream-metadata") {
        if (message.sourceName) setSourceName(String(message.sourceName));
        const rate = Number(message.sampleRate);
        if (Number.isFinite(rate) && rate > 0) setNominalSampleRate(rate);
        if (typeof message.simulated === "boolean") {
          setSourceMode(message.simulated ? "simulation" : "live");
        }
        return;
      }

      if (message.type === "snapshot" && Array.isArray(message.channels)) {
        setSnapshots(message.channels);
        return;
      }

      if (message.type === "transport") {
        setTransport(String(message.transport || "unknown"));
        if (message.state === "simulation") setSourceMode("simulation");
        if (message.state === "offline") setSourceMode("idle");
        if (message.state === "online" && message.transport === "webrtc-datachannel") {
          setSourceMode("live");
        }
        return;
      }

    };

    const startWorkerWebSocket = () => {
      if (cancelled || !worker) return;
      const sourceQuery = selectedSourceId
        ? `?source_id=${encodeURIComponent(selectedSourceId)}`
        : "";
      const url = buildWebSocketUrl(
        gateway,
        `/ws/samples${sourceQuery}`,
      );
      worker.postMessage({ type: "connect-websocket", url });
    };

    const tryWebRTC = async () => {
      if (!("RTCPeerConnection" in window) || !worker) return false;

      try {
        peer = new RTCPeerConnection({ iceServers: [] });

        sampleChannel = peer.createDataChannel("morpheus-samples", {
          // Acquisition samples are evidence. A partially reliable channel
          // silently discards them under congestion and turns ordinary load
          // into sequence gaps. Preserve ordering and delivery; the renderer
          // still consumes only a bounded, recent display window.
          ordered: true,
        });
        controlChannel = peer.createDataChannel("morpheus-control", {
          ordered: true,
        });

        sampleChannel.binaryType = "arraybuffer";

        sampleChannel.onmessage = (event) => {
          if (!worker || cancelled) return;

          if (event.data instanceof ArrayBuffer) {
            worker.postMessage(
              { type: "webrtc-packet", payload: event.data },
              [event.data],
            );
          } else {
            worker.postMessage({
              type: "webrtc-packet",
              payload: event.data,
            });
          }
        };

        controlChannel.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data));
            if (message.type !== "marker_ack" || !message.request_id) return;
            const pending = pendingMarkers.current.get(message.request_id);
            if (!pending) return;

            window.clearTimeout(pending.timer);
            pendingMarkers.current.delete(message.request_id);
            pending.resolve({
              accepted: Boolean(message.accepted),
              lsl_emitted: Boolean(message.lsl_emitted),
              marker: message.marker,
              transport: "webrtc-control",
            });
          } catch {}
        };

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await waitForIceGathering(peer, 1300);

        const response = await fetch(
          `${gateway.replace(/\/$/, "")}/webrtc/offer`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sdp: peer.localDescription?.sdp,
              type: peer.localDescription?.type || "offer",
              source_id: selectedSourceId || null,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`WebRTC signaling failed: ${response.status}`);
        }

        const answer = await response.json();
        if (!answer.available || !answer.sdp) {
          throw new Error(answer.reason || "WebRTC unavailable");
        }

        await peer.setRemoteDescription({
          sdp: answer.sdp,
          type: answer.type || "answer",
        });

        await Promise.all([
          waitForDataChannel(sampleChannel, 2500),
          waitForDataChannel(controlChannel, 2500),
        ]);

        if (cancelled) return false;

        controlChannelRef.current = controlChannel;
        setTransport("webrtc-datachannel");

        if (ring) {
          Atomics.store(ring.control, CONTROL.STATE, 2);
        }

        sampleChannel.onclose = () => {
          if (cancelled) return;
          controlChannelRef.current = null;
          setTransport("webrtc-closed");
          setSourceMode("idle");
          startWorkerWebSocket();
        };

        return true;
      } catch {
        try {
          sampleChannel?.close();
          controlChannel?.close();
          peer?.close();
        } catch {}

        controlChannelRef.current = null;
        return false;
      }
    };

    setTransport("negotiating");

    void (async () => {
      const connected = await tryWebRTC();
      if (!connected && !cancelled) startWorkerWebSocket();
    })();

    const snapshotTimer = window.setInterval(() => {
      if (ring) {
        const channels = Math.max(
          0,
          Math.min(
            MAX_CHANNELS,
            Atomics.load(ring.control, CONTROL.CHANNELS),
          ),
        );
        const versionBefore = Atomics.load(ring.control, 11);
        if (versionBefore & 1) return;
        const writeIndex = Atomics.load(ring.control, CONTROL.WRITE_INDEX);
        const totalFrames =
          Atomics.load(ring.control, CONTROL.TOTAL_FRAMES) >>> 0;
        const count = Math.min(
          SNAPSHOT_SAMPLES,
          totalFrames,
          CAPACITY,
        );

        if (channels > 0 && count > 0) {
          const start = (writeIndex - count + CAPACITY) % CAPACITY;
          const next = Array.from({ length: channels }, (_, channel) => {
            const values = new Array<number>(count);
            for (let index = 0; index < count; index += 1) {
              const frame = (start + index) % CAPACITY;
              values[index] =
                ring.data[frame * MAX_CHANNELS + channel];
            }
            return values;
          });
          const versionAfter = Atomics.load(ring.control, 11);
          if (versionBefore === versionAfter && !(versionAfter & 1)) {
            setSnapshots(next);
          }
        }

        setPacketRate(
          Atomics.load(ring.control, CONTROL.PACKET_RATE),
        );
        setFrameRate(
          Atomics.load(ring.control, 8),
        );
        setByteRate(
          Atomics.load(ring.control, 9),
        );
        setDropped(
          Atomics.load(ring.control, CONTROL.DROPPED),
        );

        const simulated =
          Atomics.load(ring.control, CONTROL.SIMULATED) === 1;
        const state = Atomics.load(ring.control, CONTROL.STATE);

        if (simulated) setSourceMode("simulation");
        else if (state === 2) setSourceMode("live");
      } else {
        // The ingest worker owns a bounded fallback ring when SharedArrayBuffer
        // is unavailable. Only its low-rate snapshots cross into React.
      }
    }, 250);

    return () => {
      cancelled = true;
      worker?.postMessage({ type: "disconnect" });
      worker?.terminate();

      controlChannelRef.current = null;
      sampleChannel?.close();
      controlChannel?.close();
      peer?.close();

      window.clearInterval(snapshotTimer);
    };
  }, [gateway, selectedSourceId, connectionEpoch, ring]);

  const emitMarker = useCallback(
    async (
      label: string,
      payload: Record<string, unknown> = {},
    ): Promise<MarkerEmitResult> => {
      const markerLabel = label.trim().toUpperCase();
      if (!markerLabel) {
        return {
          accepted: false,
          transport: "local-failed",
        };
      }

      const clientMonotonic = performance.now() / 1000;
      const requestId = crypto.randomUUID();
      const markerRequest = {
        type: "marker",
        request_id: requestId,
        label: markerLabel,
        payload,
        client_monotonic: clientMonotonic,
        client_clock_domain: "browser_performance",
        estimated_gateway_time: clockSync.ready
          ? clientMonotonic + clockSync.offsetSeconds
          : null,
        sync_uncertainty_ms: clockSync.uncertaintyMs,
      };

      const channel = controlChannelRef.current;

      if (channel?.readyState === "open") {
        return new Promise<MarkerEmitResult>((resolve, reject) => {
          const timer = window.setTimeout(() => {
            pendingMarkers.current.delete(requestId);
            reject(new Error("Marker acknowledgement timeout"));
          }, 1500);

          pendingMarkers.current.set(requestId, {
            resolve,
            reject,
            timer,
          });

          try {
            channel.send(JSON.stringify(markerRequest));
          } catch (error) {
            window.clearTimeout(timer);
            pendingMarkers.current.delete(requestId);
            reject(error);
          }
        }).catch(async () =>
          emitMarkerHttp(gateway, markerRequest),
        );
      }

      return emitMarkerHttp(gateway, markerRequest);
    },
    [gateway, clockSync],
  );

  useEffect(
    () => () => {
      for (const pending of pendingMarkers.current.values()) {
        window.clearTimeout(pending.timer);
        pending.reject(new Error("Signal engine stopped"));
      }
      pendingMarkers.current.clear();
    },
    [],
  );

  return {
    ring,
    snapshots,
    packetRate,
    frameRate,
    byteRate,
    sourceName,
    nominalSampleRate,
    sourceMode,
    dropped,
    transport,
    sharedMemory: Boolean(ring),
    clockSync,
    emitMarker,
  };
}

async function emitMarkerHttp(
  gateway: string,
  markerRequest: Record<string, unknown>,
): Promise<MarkerEmitResult> {
  try {
    const response = await fetch(
      `${gateway.replace(/\/$/, "")}/markers`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(markerRequest),
      },
    );

    const payload = await response.json();

    return {
      accepted: response.ok && Boolean(payload.accepted),
      lsl_emitted: Boolean(payload.lsl_emitted),
      marker: payload.marker,
      transport: "http",
    };
  } catch {
    return {
      accepted: false,
      transport: "local-failed",
    };
  }
}

async function waitForIceGathering(
  peer: RTCPeerConnection,
  timeoutMs: number,
) {
  if (peer.iceGatheringState === "complete") return;

  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(done, timeoutMs);

    function done() {
      window.clearTimeout(timer);
      peer.removeEventListener(
        "icegatheringstatechange",
        onChange,
      );
      resolve();
    }

    function onChange() {
      if (peer.iceGatheringState === "complete") done();
    }

    peer.addEventListener(
      "icegatheringstatechange",
      onChange,
    );
  });
}

async function waitForDataChannel(
  channel: RTCDataChannel,
  timeoutMs: number,
) {
  if (channel.readyState === "open") return;

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("WebRTC data channel timeout"));
    }, timeoutMs);

    const open = () => {
      cleanup();
      resolve();
    };

    const fail = () => {
      cleanup();
      reject(new Error("WebRTC data channel failed"));
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      channel.removeEventListener("open", open);
      channel.removeEventListener("error", fail);
    };

    channel.addEventListener("open", open);
    channel.addEventListener("error", fail);
  });
}
