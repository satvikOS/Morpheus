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
    if (
      typeof window === "undefined" ||
      typeof SharedArrayBuffer === "undefined"
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
    if (typeof window === "undefined") return;

    let cancelled = false;
    let worker: Worker | null = null;
    let peer: RTCPeerConnection | null = null;
    let dataChannel: RTCDataChannel | null = null;
    let webrtcPackets = 0;
    let webrtcActive = false;

    const fallbackHistory = Array.from(
      { length: MAX_CHANNELS },
      () => [] as number[],
    );

    const clearRing = () => {
      if (!ring) return;
      ring.control.fill(0);
      ring.data.fill(0);
    };

    const incrementDropped = () => {
      if (ring) {
        setDropped(Atomics.add(ring.control, CONTROL.DROPPED, 1) + 1);
      } else {
        setDropped((value) => value + 1);
      }
    };

    const writeFrame = (
      values: number[],
      timestamp: number,
      simulated: boolean,
      name: string,
    ) => {
      const bounded = values.slice(0, MAX_CHANNELS);
      if (!bounded.length) return;

      if (ring) {
        const writeIndex = Atomics.load(ring.control, CONTROL.WRITE_INDEX);
        const base = writeIndex * MAX_CHANNELS;

        for (let channel = 0; channel < MAX_CHANNELS; channel += 1) {
          const value = channel < bounded.length ? Number(bounded[channel]) : 0;
          ring.data[base + channel] = Number.isFinite(value) ? value : 0;
        }

        Atomics.store(ring.control, CONTROL.CHANNELS, bounded.length);
        Atomics.store(ring.control, CONTROL.SIMULATED, simulated ? 1 : 0);
        Atomics.store(
          ring.control,
          CONTROL.LAST_TS_MS,
          Math.floor(timestamp * 1000) & 0x7fffffff,
        );
        Atomics.add(ring.control, CONTROL.TOTAL_FRAMES, 1);
        Atomics.store(
          ring.control,
          CONTROL.WRITE_INDEX,
          (writeIndex + 1) % CAPACITY,
        );
      } else {
        bounded.forEach((value, index) => {
          const history = fallbackHistory[index];
          history.push(Number(value) || 0);
          if (history.length > SNAPSHOT_SAMPLES) {
            history.splice(0, history.length - SNAPSHOT_SAMPLES);
          }
        });
      }

      setSourceName(name || "Unknown stream");
      setSourceMode(simulated ? "simulation" : "live");
    };

    const startWorkerTransport = () => {
      if (cancelled || worker) return;

      const sourceQuery = selectedSourceId
        ? `?source_id=${encodeURIComponent(selectedSourceId)}`
        : "";
      const url = buildWebSocketUrl(
        gateway,
        `/ws/samples${sourceQuery}`,
      );

      worker = new Worker("/workers/stream-worker.js");

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
          writeFrame(
            message.channels.map(Number),
            Number(message.timestamp || Date.now() / 1000),
            Boolean(message.simulated),
            String(message.sourceName || "Fallback stream"),
          );
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
    };

    const tryWebRTC = async () => {
      if (!("RTCPeerConnection" in window)) return false;

      try {
        peer = new RTCPeerConnection({ iceServers: [] });
        dataChannel = peer.createDataChannel("morpheus-samples", {
          ordered: false,
          maxRetransmits: 0,
        });

        dataChannel.binaryType = "arraybuffer";

        dataChannel.onmessage = (event) => {
          try {
            const packet =
              typeof event.data === "string"
                ? JSON.parse(event.data)
                : JSON.parse(new TextDecoder().decode(event.data));

            const channels = Array.isArray(packet.channels)
              ? packet.channels.map(Number)
              : [];
            writeFrame(
              channels,
              Number(packet.ts || Date.now() / 1000),
              Boolean(packet.simulated),
              String(packet.stream || "WebRTC stream"),
            );
            webrtcPackets += 1;
          } catch {
            incrementDropped();
          }
        };

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await waitForIceGathering(peer, 1300);

        const endpoint = `${gateway.replace(/\/$/, "")}/webrtc/offer`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sdp: peer.localDescription?.sdp,
            type: peer.localDescription?.type || "offer",
            source_id: selectedSourceId || null,
          }),
        });

        if (!response.ok) throw new Error(`WebRTC signaling failed: ${response.status}`);

        const answer = await response.json();
        if (!answer.available || !answer.sdp) {
          throw new Error(answer.reason || "WebRTC unavailable");
        }

        await peer.setRemoteDescription({
          sdp: answer.sdp,
          type: answer.type || "answer",
        });

        await waitForDataChannel(dataChannel, 2500);
        if (cancelled) return false;

        webrtcActive = true;
        setTransport("webrtc-datachannel");
        if (ring) Atomics.store(ring.control, CONTROL.STATE, 2);

        dataChannel.onclose = () => {
          if (cancelled) return;
          webrtcActive = false;
          setTransport("webrtc-closed");
          setSourceMode("idle");
          startWorkerTransport();
        };

        dataChannel.onerror = () => {
          if (cancelled) return;
          incrementDropped();
        };

        return true;
      } catch {
        try {
          dataChannel?.close();
          peer?.close();
        } catch {}
        dataChannel = null;
        peer = null;
        return false;
      }
    };

    clearRing();
    setTransport("negotiating");

    void (async () => {
      const connected = await tryWebRTC();
      if (!connected && !cancelled) {
        startWorkerTransport();
      }
    })();

    const rateTimer = window.setInterval(() => {
      if (webrtcActive) {
        setPacketRate(webrtcPackets);
        if (ring) Atomics.store(ring.control, CONTROL.PACKET_RATE, webrtcPackets);
        webrtcPackets = 0;
      }
    }, 1000);

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

        if (!webrtcActive) {
          setPacketRate(Atomics.load(ring.control, CONTROL.PACKET_RATE));
        }
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
      cancelled = true;
      worker?.postMessage({ type: "disconnect" });
      worker?.terminate();
      dataChannel?.close();
      peer?.close();
      window.clearInterval(rateTimer);
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

async function waitForIceGathering(
  peer: RTCPeerConnection,
  timeoutMs: number,
) {
  if (peer.iceGatheringState === "complete") return;

  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(done, timeoutMs);

    function done() {
      window.clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    }

    function onChange() {
      if (peer.iceGatheringState === "complete") done();
    }

    peer.addEventListener("icegatheringstatechange", onChange);
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
