const CONTROL = {
  WRITE_INDEX: 0,
  CHANNELS: 1,
  TOTAL_FRAMES: 2,
  PACKET_RATE: 3,
  STATE: 4,
  SIMULATED: 5,
  DROPPED: 6,
  LAST_TS_MS: 7,
  FRAME_RATE: 8,
  BYTE_RATE: 9,
  LAST_SEQUENCE: 10,
};

const MAGIC = [0x4d, 0x52, 0x50, 0x48];
const HEADER_BYTES = 24;
const FLAG_SIMULATED = 1;

let socket = null;
let reconnectTimer = null;
let closed = false;
let data = null;
let control = null;
let maxChannels = 32;
let capacity = 32768;
let packetsThisSecond = 0;
let framesThisSecond = 0;
let bytesThisSecond = 0;
let packetRateTimer = null;
let syntheticTimer = null;
let sourceName = "";
let currentUrl = "";
let websocketFallbackEnabled = false;
let lastTransportKey = "";
let expectedSequence = null;
let fallbackSequence = 0;

self.onmessage = (event) => {
  const message = event.data || {};

  if (message.type === "init") {
    shutdown(false);
    closed = false;
    maxChannels = Number(message.maxChannels || 32);
    capacity = Number(message.capacity || 32768);

    if (message.dataBuffer && message.controlBuffer) {
      data = new Float32Array(message.dataBuffer);
      control = new Int32Array(message.controlBuffer);
      control.fill(0);
    } else {
      data = null;
      control = null;
    }

    startRateCounter();
    return;
  }

  if (message.type === "connect-websocket") {
    websocketFallbackEnabled = true;
    currentUrl = String(message.url || "");
    stopSynthetic();
    connectWebSocket();
    return;
  }

  if (message.type === "webrtc-packet") {
    ingestPayload(message.payload, "webrtc-datachannel");
    return;
  }

  if (message.type === "disconnect") {
    shutdown(true);
  }
};

function connectWebSocket() {
  if (closed || !currentUrl || socket) return;

  try {
    socket = new WebSocket(currentUrl);
    socket.binaryType = "arraybuffer";
    setState(1);
    reportTransport("connecting", "worker-websocket");

    socket.onopen = () => {
      setState(2);
      stopSynthetic();
      reportTransport("online", "worker-websocket");
    };

    socket.onmessage = (event) => {
      ingestPayload(event.data, "worker-websocket");
    };

    socket.onerror = () => {
      try {
        socket.close();
      } catch {}
    };

    socket.onclose = () => {
      socket = null;
      setState(0);
      reportTransport("offline", "worker-websocket");

      if (!closed && websocketFallbackEnabled) {
        reconnectTimer = setTimeout(connectWebSocket, 1200);
        startSyntheticFallback();
      }
    };
  } catch {
    socket = null;
    setState(0);
    startSyntheticFallback();
    reconnectTimer = setTimeout(connectWebSocket, 1600);
  }
}

function ingestPayload(payload, transport) {
  try {
    if (payload instanceof ArrayBuffer && isMorpheusBatch(payload)) {
      ingestBinaryBatch(payload, transport);
      return;
    }

    let packet;
    if (typeof payload === "string") {
      bytesThisSecond += payload.length;
      packet = JSON.parse(payload);
    } else if (payload instanceof ArrayBuffer) {
      bytesThisSecond += payload.byteLength;
      packet = JSON.parse(new TextDecoder().decode(payload));
    } else {
      packet = payload;
    }

    const channels = Array.isArray(packet?.channels) ? packet.channels : [];
    if (!channels.length) return;

    packetsThisSecond += 1;
    framesThisSecond += 1;
    sourceName = String(packet.stream || "Unknown stream");
    writeFrame(
      channels,
      Number(packet.ts || Date.now() / 1000),
      Boolean(packet.simulated),
    );

    reportTransport(packet.simulated ? "simulation" : "online", transport);
  } catch {
    incrementDropped();
  }
}

function isMorpheusBatch(buffer) {
  if (buffer.byteLength < HEADER_BYTES) return false;
  const bytes = new Uint8Array(buffer, 0, 4);
  return (
    bytes[0] === MAGIC[0] &&
    bytes[1] === MAGIC[1] &&
    bytes[2] === MAGIC[2] &&
    bytes[3] === MAGIC[3]
  );
}

function ingestBinaryBatch(buffer, transport) {
  const view = new DataView(buffer);
  const version = view.getUint16(4, true);
  const flags = view.getUint16(6, true);
  const sequence = view.getUint32(8, true);
  const streamId = view.getUint32(12, true);
  const sampleRate = view.getFloat32(16, true);
  const channelCount = view.getUint16(20, true);
  const frameCount = view.getUint16(22, true);

  if (version !== 1 || channelCount < 1 || frameCount < 1) {
    throw new Error("Unsupported Morpheus packet");
  }

  const stride = 8 + channelCount * 4;
  const expectedBytes = HEADER_BYTES + stride * frameCount;
  if (expectedBytes > buffer.byteLength) {
    throw new Error("Truncated Morpheus packet");
  }

  if (expectedSequence !== null && sequence !== expectedSequence) {
    const gap = (sequence - expectedSequence) >>> 0;
    if (gap > 0 && gap < 0x7fffffff) {
      addDropped(gap);
    }
  }
  expectedSequence = (sequence + 1) >>> 0;

  packetsThisSecond += 1;
  framesThisSecond += frameCount;
  bytesThisSecond += buffer.byteLength;
  sourceName = `Morpheus Native ${streamId.toString(16).padStart(8, "0")}`;

  const simulated = (flags & FLAG_SIMULATED) !== 0;
  const channels = new Array(Math.min(channelCount, maxChannels));
  let offset = HEADER_BYTES;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const timestamp = view.getFloat64(offset, true);
    offset += 8;

    for (let channel = 0; channel < channelCount; channel += 1) {
      const value = view.getFloat32(offset, true);
      offset += 4;
      if (channel < channels.length) channels[channel] = value;
    }

    writeFrame(channels, timestamp, simulated);
  }

  if (control) {
    Atomics.store(control, CONTROL.LAST_SEQUENCE, sequence | 0);
  }

  self.postMessage({
    type: "stream-metadata",
    sourceName,
    sampleRate,
    channelCount,
    protocol: "mrph-v1",
  });

  reportTransport(simulated ? "simulation" : "online", transport);
}

function writeFrame(values, timestampSeconds, simulated) {
  const n = Math.min(maxChannels, values.length);

  if (control && data) {
    const writeIndex = Atomics.load(control, CONTROL.WRITE_INDEX);
    const base = writeIndex * maxChannels;

    for (let channel = 0; channel < maxChannels; channel += 1) {
      const value = channel < n ? Number(values[channel]) : 0;
      data[base + channel] = Number.isFinite(value) ? value : 0;
    }

    Atomics.store(control, CONTROL.CHANNELS, n);
    Atomics.store(control, CONTROL.SIMULATED, simulated ? 1 : 0);
    Atomics.store(
      control,
      CONTROL.LAST_TS_MS,
      Math.floor(timestampSeconds * 1000) & 0x7fffffff,
    );
    Atomics.add(control, CONTROL.TOTAL_FRAMES, 1);
    Atomics.store(control, CONTROL.WRITE_INDEX, (writeIndex + 1) % capacity);
  } else {
    self.postMessage({
      type: "frame",
      channels: values.slice(0, maxChannels),
      timestamp: timestampSeconds,
      simulated,
      sourceName,
    });
  }
}

function startRateCounter() {
  clearInterval(packetRateTimer);
  packetRateTimer = setInterval(() => {
    const packetRate = packetsThisSecond;
    const frameRate = framesThisSecond;
    const byteRate = bytesThisSecond;

    packetsThisSecond = 0;
    framesThisSecond = 0;
    bytesThisSecond = 0;

    if (control) {
      Atomics.store(control, CONTROL.PACKET_RATE, packetRate);
      Atomics.store(control, CONTROL.FRAME_RATE, frameRate);
      Atomics.store(control, CONTROL.BYTE_RATE, Math.min(0x7fffffff, byteRate));
    }

    self.postMessage({
      type: "metrics",
      packetRate,
      frameRate,
      byteRate,
      sourceName,
      state: control ? Atomics.load(control, CONTROL.STATE) : 0,
      simulated: control
        ? Atomics.load(control, CONTROL.SIMULATED) === 1
        : false,
      dropped: control ? Atomics.load(control, CONTROL.DROPPED) : 0,
    });
  }, 1000);
}

function startSyntheticFallback() {
  if (syntheticTimer || closed) return;

  sourceName = "Browser synthetic fallback";
  let phase = 0;
  let noise = 0x9e3779b9;
  const sampleRate = 256;
  const batchSize = 4;

  syntheticTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      stopSynthetic();
      return;
    }

    const baseTs = Date.now() / 1000;
    packetsThisSecond += 1;
    fallbackSequence = (fallbackSequence + 1) >>> 0;

    for (let frame = 0; frame < batchSize; frame += 1) {
      phase += 1 / sampleRate;
      const sample = Array.from({ length: 8 }, (_, channel) => {
        noise ^= noise << 13;
        noise ^= noise >>> 17;
        noise ^= noise << 5;
        const white = ((noise >>> 0) / 4294967295 - 0.5) * 0.08;
        const p = channel * 0.37;
        return (
          Math.sin(2 * Math.PI * (5.5 + channel * 0.21) * phase + p) * 0.13 +
          Math.sin(2 * Math.PI * (11.8 + channel * 0.33) * phase + p * 1.7) * 0.05 +
          Math.sin(2 * Math.PI * (31.0 + channel * 0.61) * phase + p * 0.5) * 0.018 +
          white
        );
      });

      framesThisSecond += 1;
      writeFrame(
        sample,
        baseTs + frame / sampleRate,
        true,
      );
    }
  }, (batchSize / sampleRate) * 1000);

  reportTransport("simulation", "worker-synthetic-fallback");
}

function stopSynthetic() {
  if (syntheticTimer) clearInterval(syntheticTimer);
  syntheticTimer = null;
}

function incrementDropped() {
  addDropped(1);
}

function addDropped(count) {
  if (control) Atomics.add(control, CONTROL.DROPPED, count);
}

function setState(value) {
  if (control) Atomics.store(control, CONTROL.STATE, value);
}

function reportTransport(state, transport) {
  const key = `${state}:${transport}`;
  if (key === lastTransportKey) return;
  lastTransportKey = key;
  self.postMessage({ type: "transport", state, transport });
}

function shutdown(permanent) {
  closed = permanent;
  websocketFallbackEnabled = false;
  expectedSequence = null;

  clearTimeout(reconnectTimer);
  reconnectTimer = null;

  clearInterval(packetRateTimer);
  packetRateTimer = null;

  stopSynthetic();

  if (socket) {
    try {
      socket.close();
    } catch {}
  }

  socket = null;
  setState(0);
}
