export type SimulationPreset =
  | "eeg-awake"
  | "eeg-rem"
  | "eeg-n3"
  | "erp-p300"
  | "bold-hrf"
  | "connectome";

export type SimulationFrame = {
  preset: SimulationPreset;
  sampleRate: number;
  channels: number[][];
  labels: string[];
  metadata: Record<string, string | number | boolean>;
};

function seededNoise(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff - 0.5;
  };
}

export function generateSimulation(
  preset: SimulationPreset,
  seconds = 8,
  sampleRate = 256,
  channelCount = 8,
  seed = 42,
): SimulationFrame {
  const n = Math.max(128, Math.floor(seconds * sampleRate));
  const noise = seededNoise(seed);
  const channels = Array.from({ length: channelCount }, () => new Array<number>(n).fill(0));

  const oscillation = (frequency: number, t: number, phase = 0) =>
    Math.sin(2 * Math.PI * frequency * t + phase);

  for (let channel = 0; channel < channelCount; channel += 1) {
    const phase = (channel / channelCount) * Math.PI;
    for (let index = 0; index < n; index += 1) {
      const t = index / sampleRate;
      let value = 0;

      if (preset === "eeg-awake") {
        value =
          0.18 * oscillation(10, t, phase) +
          0.07 * oscillation(20, t, phase * 0.7) +
          0.035 * noise();
      } else if (preset === "eeg-rem") {
        value =
          0.12 * oscillation(6, t, phase) +
          0.08 * oscillation(18, t, phase * 1.2) +
          0.055 * noise();
      } else if (preset === "eeg-n3") {
        value =
          0.34 * oscillation(1.2, t, phase) +
          0.08 * oscillation(3, t, phase * 0.4) +
          0.025 * noise();
      } else if (preset === "erp-p300") {
        const eventTime = 2.0 + (channel % 3) * 0.15;
        const sigma = 0.11;
        const p300 = Math.exp(-Math.pow(t - (eventTime + 0.3), 2) / (2 * sigma * sigma));
        value =
          0.08 * oscillation(9, t, phase) +
          0.42 * p300 +
          0.025 * noise();
      } else if (preset === "bold-hrf") {
        const eventTime = 1.1;
        const x = Math.max(0, t - eventTime);
        const hrf = Math.pow(x, 5) * Math.exp(-x) / 120;
        value = 0.85 * hrf + 0.015 * oscillation(0.08, t, phase) + 0.01 * noise();
      } else {
        value =
          0.1 * oscillation(4 + channel * 0.6, t, phase) +
          0.03 * oscillation(12, t, phase * 0.5) +
          0.02 * noise();
      }

      channels[channel][index] = value;
    }
  }

  return {
    preset,
    sampleRate,
    channels,
    labels: channels.map((_, index) => `CH${String(index + 1).padStart(2, "0")}`),
    metadata: {
      seconds,
      seed,
      synthetic: true,
      purpose: "non-clinical workstation simulation",
    },
  };
}

export function generateConnectome(seed = 7, nodes = 48) {
  const noise = seededNoise(seed);
  const points = Array.from({ length: nodes }, (_, index) => {
    const phi = Math.acos(1 - 2 * ((index + 0.5) / nodes));
    const theta = Math.PI * (1 + Math.sqrt(5)) * index;
    return {
      id: index,
      x: Math.cos(theta) * Math.sin(phi),
      y: Math.cos(phi) * 0.78,
      z: Math.sin(theta) * Math.sin(phi) * 0.9,
      weight: 0.25 + Math.abs(noise()) * 0.75,
    };
  });

  const edges: Array<{ source: number; target: number; weight: number }> = [];
  for (let source = 0; source < nodes; source += 1) {
    for (let offset = 1; offset <= 3; offset += 1) {
      const target = (source * 7 + offset * 11) % nodes;
      edges.push({
        source,
        target,
        weight: 0.2 + Math.abs(noise()) * 0.8,
      });
    }
  }

  return { nodes: points, edges, seed, synthetic: true };
}

export function generateVolumePhantom(size = 64) {
  const voxels = new Uint8Array(size * size * size);
  const center = (size - 1) / 2;

  for (let z = 0; z < size; z += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const nx = (x - center) / (size * 0.37);
        const ny = (y - center) / (size * 0.30);
        const nz = (z - center) / (size * 0.34);
        const r = nx * nx + ny * ny + nz * nz;

        const ventricleA =
          Math.pow((x - center - size * 0.08) / (size * 0.07), 2) +
          Math.pow((y - center) / (size * 0.09), 2) +
          Math.pow((z - center) / (size * 0.16), 2);

        const ventricleB =
          Math.pow((x - center + size * 0.08) / (size * 0.07), 2) +
          Math.pow((y - center) / (size * 0.09), 2) +
          Math.pow((z - center) / (size * 0.16), 2);

        let intensity = 0;
        if (r < 1) {
          intensity = Math.max(0, 205 - r * 115);
          if (r < 0.69) intensity += 25;
          if (ventricleA < 1 || ventricleB < 1) intensity = 35;
        }

        voxels[x + y * size + z * size * size] = Math.max(0, Math.min(255, Math.round(intensity)));
      }
    }
  }

  return { size, voxels, synthetic: true };
}
