const CONTROL = {
  WRITE_INDEX: 0,
  CHANNELS: 1,
  TOTAL_FRAMES: 2,
  PACKET_RATE: 3,
  STATE: 4,
  SIMULATED: 5,
  DROPPED: 6,
  LAST_TS_MS: 7,
};

let socket = null;
let reconnectTimer = null;
let closed = false;
let data = null;
let control = null;
let maxChannels = 32;
let capacity = 32768;
let packetsThisSecond = 0;
let packetRateTimer = null;
let syntheticTimer = null;
let sourceName = "";
let currentUrl = "";
let websocketFallbackEnabled = false;
let lastTransportKey = "";

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
    let packet;
    if (typeof payload === "string") {
      packet = JSON.parse(payload);
    } else if (payload instanceof ArrayBuffer) {
      packet = JSON.parse(new TextDecoder().decode(payload));
    } else {
      packet = payload;
    }

    const channels = Array.isArray(packet?.channels) ? packet.channels : [];
    if (!channels.length) return;

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

function writeFrame(values, timestampSeconds, simulated) {
  const n = Math.min(maxChannels, values.length);
  packetsThisSecond += 1;

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
    const rate = packetsThisSecond;
    packetsThisSecond = 0;

    if (control) {
      Atomics.store(control, CONTROL.PACKET_RATE, rate);
    }

    self.postMessage({
      type: "metrics",
      packetRate: rate,
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

  syntheticTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      stopSynthetic();
      return;
    }

    phase += 0.02;
    const sample = Array.from({ length: 8 }, (_, channel) => {
      noise ^= noise << 13;
      noise ^= noise >>> 17;
      noise ^= noise << 5;
      const white = ((noise >>> 0) / 4294967295 - 0.5) * 0.08;
      const p = channel * 0.37;
      return (
        Math.sin(phase * (5.5 + channel * 0.21) + p) * 0.13 +
        Math.sin(phase * (11.8 + channel * 0.33) + p * 1.7) * 0.05 +
        Math.sin(phase * (31.0 + channel * 0.61) + p * 0.5) * 0.018 +
        white
      );
    });

    writeFrame(sample, Date.now() / 1000, true);
  }, 4);

  reportTransport("simulation", "worker-synthetic-fallback");
}

function stopSynthetic() {
  if (syntheticTimer) clearInterval(syntheticTimer);
  syntheticTimer = null;
}

function reportTransport(state, transport) {
  const key = `${state}:${transport}`;
  if (key === lastTransportKey) return;
  lastTransportKey = key;
  self.postMessage({ type: "transport", state, transport });
}

function incrementDropped() {
  if (control) Atomics.add(control, CONTROL.DROPPED, 1);
}

function setState(value) {
  if (control) Atomics.store(control, CONTROL.STATE, value);
}

function shutdown(permanent) {
  closed = permanent;
  websocketFallbackEnabled = false;

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
