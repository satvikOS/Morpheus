self.onmessage = (event) => {
  const message = event.data || {};
  const started = performance.now();

  if (message.type !== "analyze") {
    self.postMessage({ id: message.id, ok: false, error: "Unsupported worker message" });
    return;
  }

  const sampleRate = Math.max(1, Number(message.sampleRate || 256));
  const channels = Array.isArray(message.channels)
    ? message.channels
        .filter(Array.isArray)
        .slice(0, 32)
        .map((channel) => channel.map(Number).slice(-1024))
    : [Array.isArray(message.samples) ? message.samples.map(Number).slice(-1024) : []];

  const channelMetrics = channels.map((samples) => analyzeChannel(samples, sampleRate));
  const aggregate = aggregateMetrics(channelMetrics);

  self.postMessage({
    id: message.id,
    ok: true,
    metrics: aggregate,
    channels: channelMetrics,
    latencyMs: performance.now() - started,
  });
};

function analyzeChannel(samples, sampleRate) {
  if (!samples.length) {
    return {
      mean: 0,
      rms: 0,
      peak: 0,
      zeroCrossings: 0,
      flatlineRatio: 1,
      clippingRatio: 0,
      bands: { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 },
    };
  }

  let sum = 0;
  let energy = 0;
  let peak = 0;
  let zeroCrossings = 0;
  let flatSteps = 0;
  let clipped = 0;

  const finite = samples.map((value) => Number.isFinite(value) ? value : 0);

  for (let i = 0; i < finite.length; i += 1) {
    const value = finite[i];
    sum += value;
    energy += value * value;
    peak = Math.max(peak, Math.abs(value));
    if (i > 0) {
      const previous = finite[i - 1];
      if ((previous < 0 && value >= 0) || (previous >= 0 && value < 0)) zeroCrossings += 1;
      if (Math.abs(value - previous) < 1e-8) flatSteps += 1;
    }
  }

  const mean = sum / finite.length;
  const rms = Math.sqrt(energy / finite.length);
  const clipThreshold = Math.max(1e-9, peak * 0.985);
  for (const value of finite) if (Math.abs(value) >= clipThreshold && peak > 0) clipped += 1;

  const centered = finite.map((value) => value - mean);
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

  return {
    mean,
    rms,
    peak,
    zeroCrossings,
    flatlineRatio: flatSteps / Math.max(1, finite.length - 1),
    clippingRatio: clipped / finite.length,
    bands,
  };
}

function aggregateMetrics(channels) {
  if (!channels.length) return analyzeChannel([], 256);

  const bands = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };
  let mean = 0;
  let rms = 0;
  let peak = 0;
  let zeroCrossings = 0;
  let flatlineRatio = 0;
  let clippingRatio = 0;

  for (const channel of channels) {
    mean += channel.mean;
    rms += channel.rms;
    peak = Math.max(peak, channel.peak);
    zeroCrossings += channel.zeroCrossings;
    flatlineRatio += channel.flatlineRatio;
    clippingRatio += channel.clippingRatio;
    for (const key of Object.keys(bands)) bands[key] += channel.bands[key] || 0;
  }

  const count = channels.length;
  for (const key of Object.keys(bands)) bands[key] /= count;

  return {
    mean: mean / count,
    rms: rms / count,
    peak,
    zeroCrossings: zeroCrossings / count,
    flatlineRatio: flatlineRatio / count,
    clippingRatio: clippingRatio / count,
    bands,
  };
}

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
