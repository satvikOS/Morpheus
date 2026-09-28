let canvas = null;
let gl = null;
let program = null;
let buffer = null;
let positionLocation = -1;
let alphaLocation = null;
let data = null;
let control = null;
let capacity = 0;
let maxChannels = 0;
let fallbackChannels = [];
let width = 1;
let height = 1;
let dpr = 1;
let active = true;
let timer = null;

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

const settings = {
  timeWindow: 10,
  gain: 1,
  polarity: "negative-up",
  montage: "raw",
  sampleRate: 256,
  pxPerMm: 0,
  uvPerMm: 10,
  calibratedUv: false,
};

let vertices = new Float32Array(16384);

self.onmessage = (event) => {
  const message = event.data || {};

  if (message.type === "init") {
    canvas = message.canvas;
    capacity = Number(message.capacity || 0);
    maxChannels = Number(message.maxChannels || 0);
    data = message.dataBuffer ? new Float32Array(message.dataBuffer) : null;
    control = message.controlBuffer ? new Int32Array(message.controlBuffer) : null;
    width = Math.max(1, Number(message.width || 1));
    height = Math.max(1, Number(message.height || 1));
    dpr = Math.max(1, Number(message.dpr || 1));
    initializeGl();
    schedule();
    return;
  }

  if (message.type === "settings") {
    Object.assign(settings, message.settings || {});
    return;
  }

  if (message.type === "resize") {
    width = Math.max(1, Number(message.width || 1));
    height = Math.max(1, Number(message.height || 1));
    dpr = Math.max(1, Number(message.dpr || 1));
    resizeCanvas();
    return;
  }

  if (message.type === "snapshot") {
    fallbackChannels = Array.isArray(message.channels) ? message.channels : [];
    return;
  }

  if (message.type === "active") {
    active = Boolean(message.active);
    if (active) schedule();
    return;
  }

  if (message.type === "stop") {
    active = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }
};

function initializeGl() {
  if (!canvas) return;

  gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    desynchronized: true,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });

  if (!gl) {
    self.postMessage({ type: "renderer-error", error: "WebGL2 unavailable in OffscreenCanvas worker" });
    return;
  }

  const vertex = compileShader(
    gl.VERTEX_SHADER,
    `#version 300 es
    in vec2 aPosition;
    void main() {
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }`,
  );

  const fragment = compileShader(
    gl.FRAGMENT_SHADER,
    `#version 300 es
    precision highp float;
    uniform float uAlpha;
    out vec4 outColor;
    void main() {
      outColor = vec4(0.46, 0.76, 0.94, uAlpha);
    }`,
  );

  if (!vertex || !fragment) return;

  program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    self.postMessage({
      type: "renderer-error",
      error: gl.getProgramInfoLog(program) || "WebGL program link failed",
    });
    return;
  }

  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  gl.useProgram(program);

  positionLocation = gl.getAttribLocation(program, "aPosition");
  alphaLocation = gl.getUniformLocation(program, "uAlpha");
  buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  resizeCanvas();

  self.postMessage({
    type: "renderer-ready",
    backend: "offscreen-webgl2",
    antialias: false,
  });
}

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    self.postMessage({
      type: "renderer-error",
      error: gl.getShaderInfoLog(shader) || "Shader compilation failed",
    });
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

function resizeCanvas() {
  if (!canvas || !gl) return;
  const pixelWidth = Math.max(1, Math.floor(width * dpr));
  const pixelHeight = Math.max(1, Math.floor(height * dpr));

  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  gl.viewport(0, 0, pixelWidth, pixelHeight);
}

function schedule() {
  if (!active || timer) return;

  const tick = () => {
    timer = null;
    if (!active) return;
    render();
    timer = setTimeout(tick, 1000 / 60);
  };

  timer = setTimeout(tick, 0);
}

function render() {
  if (!gl || !program || !buffer) return;

  resizeCanvas();
  gl.clearColor(0.012, 0.025, 0.035, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const channelCount = control
    ? Math.max(0, Math.min(maxChannels, Atomics.load(control, CONTROL.CHANNELS)))
    : fallbackChannels.length;

  const availableFrames = control
    ? Math.max(0, Math.min(capacity, Atomics.load(control, CONTROL.TOTAL_FRAMES)))
    : Math.max(0, fallbackChannels[0]?.length || 0);

  if (!channelCount || availableFrames < 2) return;

  const sampleRate = Math.max(1, Number(settings.sampleRate || 256));
  const desiredFrames = Math.max(2, Math.round(sampleRate * Number(settings.timeWindow || 10)));
  const sampleCount = Math.min(availableFrames, desiredFrames);
  const writeIndex = control
    ? Atomics.load(control, CONTROL.WRITE_INDEX)
    : availableFrames;

  const laneHeight = 2 / channelCount;
  const physicalScale =
    Boolean(settings.calibratedUv) &&
    Number(settings.pxPerMm) > 0 &&
    Number(settings.uvPerMm) > 0;
  const polarity = settings.polarity === "negative-up" ? -1 : 1;
  const targetColumns = Math.max(64, Math.min(4096, Math.floor(width)));
  const decimate = sampleCount > targetColumns * 1.25;

  for (let channel = 0; channel < channelCount; channel += 1) {
    const laneCenter = 1 - laneHeight * (channel + 0.5);

    if (decimate) {
      drawEnvelope(
        channel,
        channelCount,
        sampleCount,
        writeIndex,
        targetColumns,
        laneCenter,
        laneHeight,
        polarity,
        physicalScale,
      );
    } else {
      drawLine(
        channel,
        channelCount,
        sampleCount,
        writeIndex,
        laneCenter,
        laneHeight,
        polarity,
        physicalScale,
      );
    }
  }
}

function readValue(channel, logicalIndex, channelCount, sampleCount, writeIndex) {
  let value = 0;

  if (control && data) {
    const start = (writeIndex - sampleCount + capacity) % capacity;
    const frame = (start + logicalIndex) % capacity;
    value = data[frame * maxChannels + channel] || 0;

    if (settings.montage === "average") {
      let sum = 0;
      for (let c = 0; c < channelCount; c += 1) {
        sum += data[frame * maxChannels + c] || 0;
      }
      value -= sum / channelCount;
    }
  } else {
    const source = fallbackChannels[channel] || [];
    const sourceStart = Math.max(0, source.length - sampleCount);
    value = source[sourceStart + logicalIndex] || 0;

    if (settings.montage === "average") {
      let sum = 0;
      let contributors = 0;
      for (const series of fallbackChannels) {
        const idx = Math.max(0, series.length - sampleCount) + logicalIndex;
        if (idx < series.length) {
          sum += series[idx] || 0;
          contributors += 1;
        }
      }
      if (contributors) value -= sum / contributors;
    }
  }

  return Number.isFinite(value) ? value : 0;
}

function normalizedY(value, scale, laneCenter, laneHeight, polarity, physicalScale) {
  if (physicalScale) {
    const cssPixels = (value / Number(settings.uvPerMm)) * Number(settings.pxPerMm);
    const ndcPixels = (cssPixels * 2) / Math.max(1, height);
    const laneLimit = laneHeight * 0.46;
    return laneCenter + clamp(ndcPixels * polarity, -laneLimit, laneLimit);
  }

  const normalized = scale > 1e-12 ? value / scale : 0;
  return laneCenter + clamp(normalized, -1, 1) * laneHeight * 0.36 * Number(settings.gain || 1) * polarity;
}

function drawLine(channel, channelCount, sampleCount, writeIndex, laneCenter, laneHeight, polarity, physicalScale) {
  ensureVertices(sampleCount * 2);

  let scale = 1e-9;
  if (!physicalScale) {
    for (let i = 0; i < sampleCount; i += 1) {
      scale = Math.max(scale, Math.abs(readValue(channel, i, channelCount, sampleCount, writeIndex)));
    }
  }

  for (let i = 0; i < sampleCount; i += 1) {
    const x = -1 + (i / Math.max(1, sampleCount - 1)) * 2;
    const value = readValue(channel, i, channelCount, sampleCount, writeIndex);
    vertices[i * 2] = x;
    vertices[i * 2 + 1] = normalizedY(value, scale, laneCenter, laneHeight, polarity, physicalScale);
  }

  uploadAndDraw(gl.LINE_STRIP, sampleCount, channel);
}

function drawEnvelope(channel, channelCount, sampleCount, writeIndex, columns, laneCenter, laneHeight, polarity, physicalScale) {
  const points = columns * 2;
  ensureVertices(points * 2);
  const bucket = sampleCount / columns;

  let scale = 1e-9;
  if (!physicalScale) {
    for (let i = 0; i < sampleCount; i += 1) {
      scale = Math.max(scale, Math.abs(readValue(channel, i, channelCount, sampleCount, writeIndex)));
    }
  }

  let vertex = 0;
  for (let column = 0; column < columns; column += 1) {
    const start = Math.floor(column * bucket);
    const end = Math.min(sampleCount, Math.max(start + 1, Math.floor((column + 1) * bucket)));
    let min = Infinity;
    let max = -Infinity;

    for (let i = start; i < end; i += 1) {
      const value = readValue(channel, i, channelCount, sampleCount, writeIndex);
      if (value < min) min = value;
      if (value > max) max = value;
    }

    const x = -1 + (column / Math.max(1, columns - 1)) * 2;
    vertices[vertex++] = x;
    vertices[vertex++] = normalizedY(min, scale, laneCenter, laneHeight, polarity, physicalScale);
    vertices[vertex++] = x;
    vertices[vertex++] = normalizedY(max, scale, laneCenter, laneHeight, polarity, physicalScale);
  }

  uploadAndDraw(gl.LINES, points, channel);
}

function ensureVertices(required) {
  if (vertices.length >= required) return;
  let size = vertices.length;
  while (size < required) size *= 2;
  vertices = new Float32Array(size);
}

function uploadAndDraw(mode, count, channel) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices.subarray(0, count * 2), gl.DYNAMIC_DRAW);
  gl.uniform1f(alphaLocation, channel % 2 === 0 ? 0.9 : 0.76);
  gl.drawArrays(mode, 0, count);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
