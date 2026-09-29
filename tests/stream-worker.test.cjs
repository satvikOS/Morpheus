const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadWorker() {
  const messages = [];
  const intervals = [];
  const self = { postMessage: (message) => messages.push(message) };
  const context = vm.createContext({
    self,
    ArrayBuffer,
    DataView,
    Float32Array,
    Int32Array,
    Uint8Array,
    TextDecoder,
    Number,
    Math,
    JSON,
    setInterval: (callback) => {
      intervals.push(callback);
      return intervals.length;
    },
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    WebSocket: { OPEN: 1 },
  });

  const source = fs.readFileSync(
    path.join(__dirname, "../public/workers/stream-worker.js"),
    "utf8",
  );
  vm.runInContext(source, context);
  self.onmessage({ data: { type: "init", maxChannels: 32, capacity: 64 } });

  return {
    messages,
    tickMetrics: () => intervals[0](),
    tickSnapshot: () => intervals[1](),
    send: (payload) => self.onmessage({ data: { type: "webrtc-packet", payload } }),
  };
}

function packet(sequence, streamId) {
  const buffer = new ArrayBuffer(36);
  const view = new DataView(buffer);
  new Uint8Array(buffer, 0, 4).set([0x4d, 0x52, 0x50, 0x48]);
  view.setUint16(4, 1, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, sequence, true);
  view.setUint32(12, streamId, true);
  view.setFloat32(16, 256, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setFloat64(24, 1, true);
  view.setFloat32(32, 0.25, true);
  return buffer;
}

test("counts missing sequences, resets the baseline for a new stream, and counts malformed packets without SAB", () => {
  const worker = loadWorker();
  worker.send(packet(10, 101));
  worker.send(packet(12, 101)); // One missing packet.
  worker.send(packet(0, 202)); // A new source has its own sequence space.
  worker.send(new ArrayBuffer(36)); // Invalid magic / payload.
  worker.tickMetrics();
  worker.tickSnapshot();

  const metrics = worker.messages.find((message) => message.type === "metrics");
  const snapshot = worker.messages.find((message) => message.type === "snapshot");
  assert.equal(metrics.dropped, 2);
  assert.equal(metrics.frameRate, 3);
  assert.deepEqual(
    JSON.parse(JSON.stringify(snapshot.channels)),
    [[0.25, 0.25, 0.25]],
  );
  assert.equal(worker.messages.some((message) => message.type === "frame"), false);
});
