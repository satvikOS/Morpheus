"use client";

import { useEffect, useMemo, useState } from "react";
import { buildWebSocketUrl } from "@/lib/morpheus";

export type SharedSignalRing = {
  data: Float32Array;
  control: Int32Array;
  capacity: number;
  maxChannels: number;
};

export type SignalEngineState = {
  ring: SharedSignalRing | null;
  snapshots: number[][];
  packetRate: number;
  sourceName: string;
  sourceMode: "live" | "simulation" | "idle";
  dropped: number;
  transport: string;
  sharedMemory: boolean;
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

export function useSignalEngine(
  gateway: string,
  selectedSourceId: string,
  connectionEpoch: number,
): SignalEngineState {
  const [packetRate, setPacketRate] = useState(0);
  const [sourceName, setSourceName] = useState("");
  const [sourceMode, setSourceMode] =
    useState<"live" | "simulation" | "idle">("idle");
  const [dropped, setDropped] = useState(0);
  const [transport, setTransport] = useState("initializing");
  const [snapshots, setSnapshots] = useState<number[][]>([]);

  const ring = useMemo<SharedSignalRing | null>(() => {
    if (typeof window === "undefined" || typeof SharedArrayBuffer === "undefined") {
      return null;
    }

    try {
      const dataBuffer = new SharedArrayBuffer(
        Float32Array.BYTES_PER_ELEMENT * MAX_CHANNELS * CAPACITY,
      );
      const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 16);

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
    if (typeof window === "undefined") return;

    const worker = new Worker("/workers/stream-worker.js");
    const sourceQuery = selectedSourceId
      ? `?source_id=${encodeURIComponent(selectedSourceId)}`
      : "";
    const url = buildWebSocketUrl(gateway, `/ws/samples${sourceQuery}`);

    const fallbackHistory = Array.from(
      { length: MAX_CHANNELS },
      () => [] as number[],
    );

    worker.onmessage = (event) => {
      const message = event.data || {};

      if (message.type === "metrics") {
        setPacketRate(Number(message.packetRate || 0));
        setDropped(Number(message.dropped || 0));
        if (message.sourceName) setSourceName(String(message.sourceName));
        if (message.simulated) {
          setSourceMode("simulation");
        } else if (message.state === 2) {
          setSourceMode("live");
        }
        return;
      }

      if (message.type === "transport") {
        setTransport(String(message.transport || "unknown"));
        if (message.state === "simulation") setSourceMode("simulation");
        if (message.state === "offline") setSourceMode("idle");
        return;
      }

      if (message.type === "frame" && Array.isArray(message.channels)) {
        const values = message.channels.slice(0, MAX_CHANNELS);
        values.forEach((value: number, index: number) => {
          const history = fallbackHistory[index];
          history.push(Number(value) || 0);
          if (history.length > SNAPSHOT_SAMPLES) {
            history.splice(0, history.length - SNAPSHOT_SAMPLES);
          }
        });

        setSourceName(String(message.sourceName || "Fallback stream"));
        setSourceMode(message.simulated ? "simulation" : "live");
      }
    };

    worker.postMessage({
      type: "connect",
      url,
      maxChannels: MAX_CHANNELS,
      capacity: CAPACITY,
      dataBuffer: ring?.data.buffer,
      controlBuffer: ring?.control.buffer,
    });

    const snapshotTimer = window.setInterval(() => {
      if (ring) {
        const channels = Math.max(
          0,
          Math.min(MAX_CHANNELS, Atomics.load(ring.control, CONTROL.CHANNELS)),
        );
        const writeIndex = Atomics.load(ring.control, CONTROL.WRITE_INDEX);
        const totalFrames = Atomics.load(ring.control, CONTROL.TOTAL_FRAMES);
        const count = Math.min(SNAPSHOT_SAMPLES, totalFrames, CAPACITY);

        if (channels > 0 && count > 0) {
          const start = (writeIndex - count + CAPACITY) % CAPACITY;
          const next = Array.from({ length: channels }, (_, channel) => {
            const values = new Array<number>(count);
            for (let index = 0; index < count; index += 1) {
              const frame = (start + index) % CAPACITY;
              values[index] = ring.data[frame * MAX_CHANNELS + channel];
            }
            return values;
          });
          setSnapshots(next);
        }

        setPacketRate(Atomics.load(ring.control, CONTROL.PACKET_RATE));
        setDropped(Atomics.load(ring.control, CONTROL.DROPPED));
        const simulated = Atomics.load(ring.control, CONTROL.SIMULATED) === 1;
        const state = Atomics.load(ring.control, CONTROL.STATE);
        setSourceMode(simulated ? "simulation" : state === 2 ? "live" : "idle");
      } else {
        const next = fallbackHistory
          .filter((history) => history.length)
          .map((history) => history.slice());
        if (next.length) setSnapshots(next);
      }
    }, 250);

    return () => {
      worker.postMessage({ type: "disconnect" });
      worker.terminate();
      window.clearInterval(snapshotTimer);
    };
  }, [gateway, selectedSourceId, connectionEpoch, ring]);

  return {
    ring,
    snapshots,
    packetRate,
    sourceName,
    sourceMode,
    dropped,
    transport,
    sharedMemory: Boolean(ring && globalThis.crossOriginIsolated),
  };
}
