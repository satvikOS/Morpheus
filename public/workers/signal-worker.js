self.onmessage = (event) => {
  const message = event.data || {};
  const started = performance.now();

  if (message.type !== "analyze") {
    self.postMessage({ id: message.id, ok: false, error: "Unsupported worker message" });
    return;
  }

  const sampleRate = Number(message.sampleRate || 256);
  const input = Array.isArray(message.samples) ? message.samples.map(Number) : [];
  const samples = input.slice(-1024);

  if (!samples.length) {
    self.postMessage({
      id: message.id,
      ok: true,
      metrics: { mean: 0, rms: 0, peak: 0, zeroCrossings: 0, bands: {} },
      latencyMs: performance.now() - started,
    });
    return;
  }

  let sum = 0;
  let energy = 0;
  let peak = 0;
  let zeroCrossings = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const value = Number.isFinite(samples[i]) ? samples[i] : 0;
    sum += value;
    energy += value * value;
    peak = Math.max(peak, Math.abs(value));
    if (i > 0 && ((samples[i - 1] < 0 && value >= 0) || (samples[i - 1] >= 0 && value < 0))) {
      zeroCrossings += 1;
    }
  }

  const mean = sum / samples.length;
  const rms = Math.sqrt(energy / samples.length);

  const centered = samples.map((value) => value - mean);
  const n = Math.min(512, centered.length);
  const segment = centered.slice(-n);
  const bands = {
    delta: bandPower(segment, sampleRate, 0.5, 4),
    theta: bandPower(segment, sampleRate, 4, 8),
    alpha: bandPower(segment, sampleRate, 8, 13),
    beta: bandPower(segment, sampleRate, 13, 30),
    gamma: bandPower(segment, sampleRate, 30, Math.min(80, sampleRate / 2 - 1)),
  };

  const total = Object.values(bands).reduce((a, b) => a + b, 0) || 1;
  for (const key of Object.keys(bands)) bands[key] /= total;

  self.postMessage({
    id: message.id,
    ok: true,
    metrics: { mean, rms, peak, zeroCrossings, bands },
    latencyMs: performance.now() - started,
  });
};

function bandPower(samples, sampleRate, low, high) {
  if (!samples.length || high <= low) return 0;
  const n = samples.length;
  const nyquist = sampleRate / 2;
  const cappedHigh = Math.min(high, nyquist);
  let total = 0;

  for (let k = 1; k < Math.floor(n / 2); k += 1) {
    const frequency = (k * sampleRate) / n;
    if (frequency < low || frequency >= cappedHigh) continue;

    let real = 0;
    let imag = 0;
    for (let t = 0; t < n; t += 1) {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / Math.max(1, n - 1));
      const angle = (-2 * Math.PI * k * t) / n;
      const value = samples[t] * window;
      real += value * Math.cos(angle);
      imag += value * Math.sin(angle);
    }
    total += (real * real + imag * imag) / (n * n);
  }

  return total;
}
