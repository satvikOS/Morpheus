self.onmessage = (event) => {
  const message = event.data || {};
  const started = performance.now();

  try {
    if (message.type === "baseline") {
      const rows = normalizeRows(message.rows);
      const result = runBaseline(rows, Number(message.permutations || 100));
      self.postMessage({
        id: message.id,
        ok: true,
        type: "baseline",
        result,
        latencyMs: performance.now() - started,
      });
      return;
    }

    if (message.type === "atlas") {
      const rows = normalizeRows(message.rows);
      const result = buildAtlas(rows);
      self.postMessage({
        id: message.id,
        ok: true,
        type: "atlas",
        result,
        latencyMs: performance.now() - started,
      });
      return;
    }

    self.postMessage({
      id: message.id,
      ok: false,
      error: "Unsupported research worker message",
    });
  } catch (error) {
    self.postMessage({
      id: message.id,
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Research worker failed",
    });
  }
};

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => ({
      id: String(row?.id || ""),
      sessionId: String(row?.sessionId || ""),
      label: String(row?.label || row?.state || ""),
      features: Array.isArray(row?.features)
        ? row.features.map(Number)
        : [],
    }))
    .filter(
      (row) =>
        row.id &&
        row.label &&
        row.features.length &&
        row.features.every(Number.isFinite),
    );
}

function runBaseline(rows, permutations) {
  if (rows.length < 4) {
    throw new Error("At least four labeled snapshots are required.");
  }

  const labels = unique(rows.map((row) => row.label));
  if (labels.length < 2) {
    throw new Error("At least two state labels are required.");
  }

  const featureLength = rows[0].features.length;
  if (!rows.every((row) => row.features.length === featureLength)) {
    throw new Error("All snapshots must have identical feature width.");
  }

  const predictions = leaveOneSessionOut(rows);
  const accuracy =
    predictions.filter((item) => item.predicted === item.actual).length /
    predictions.length;

  const perClass = labels.map((label) => {
    const classRows = predictions.filter((item) => item.actual === label);
    const correct = classRows.filter(
      (item) => item.predicted === item.actual,
    ).length;

    return {
      label,
      count: classRows.length,
      recall: classRows.length ? correct / classRows.length : 0,
    };
  });

  const balancedAccuracy =
    perClass.reduce((sum, item) => sum + item.recall, 0) /
    Math.max(1, perClass.length);

  const confusion = {};
  for (const actual of labels) {
    confusion[actual] = {};
    for (const predicted of labels) {
      confusion[actual][predicted] = 0;
    }
  }
  for (const item of predictions) {
    confusion[item.actual][item.predicted] =
      (confusion[item.actual][item.predicted] || 0) + 1;
  }

  const rng = mulberry32(0x4d4f5250);
  const nullScores = [];
  const count = Math.max(20, Math.min(500, permutations));

  for (let iteration = 0; iteration < count; iteration += 1) {
    const shuffled = shuffle(
      rows.map((row) => row.label),
      rng,
    );
    const permuted = rows.map((row, index) => ({
      ...row,
      label: shuffled[index],
    }));
    const permPredictions = leaveOneSessionOut(permuted);
    const score =
      permPredictions.filter(
        (item) => item.predicted === item.actual,
      ).length / Math.max(1, permPredictions.length);
    nullScores.push(score);
  }

  const nullMean =
    nullScores.reduce((sum, value) => sum + value, 0) /
    Math.max(1, nullScores.length);
  const pValue =
    (1 +
      nullScores.filter((value) => value >= accuracy).length) /
    (nullScores.length + 1);

  return {
    rows: rows.length,
    classes: labels,
    featureLength,
    validation: "leave-one-session-out",
    classifier: "nearest-centroid",
    accuracy,
    balancedAccuracy,
    nullMean,
    permutationP: pValue,
    confusion,
    predictions,
  };
}

function leaveOneSessionOut(rows) {
  return rows.map((testRow, testIndex) => {
    const training = rows.filter((row, index) => {
      if (index === testIndex) return false;
      if (
        testRow.sessionId &&
        row.sessionId &&
        testRow.sessionId === row.sessionId
      ) {
        return false;
      }
      return true;
    });

    const usable = training.length
      ? training
      : rows.filter((_, index) => index !== testIndex);

    const centroids = classCentroids(usable);
    let bestLabel = "";
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const [label, centroid] of Object.entries(centroids)) {
      const distance = squaredDistance(
        testRow.features,
        centroid,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestLabel = label;
      }
    }

    return {
      id: testRow.id,
      sessionId: testRow.sessionId,
      actual: testRow.label,
      predicted: bestLabel,
      distance: Math.sqrt(bestDistance),
    };
  });
}

function classCentroids(rows) {
  const groups = new Map();

  for (const row of rows) {
    const current = groups.get(row.label) || {
      sum: new Array(row.features.length).fill(0),
      count: 0,
    };

    row.features.forEach((value, index) => {
      current.sum[index] += value;
    });
    current.count += 1;
    groups.set(row.label, current);
  }

  const result = {};
  for (const [label, group] of groups.entries()) {
    result[label] = group.sum.map(
      (value) => value / Math.max(1, group.count),
    );
  }
  return result;
}

function buildAtlas(rows) {
  if (!rows.length) {
    return {
      states: [],
      centroids: {},
      similarities: [],
      snapshots: 0,
    };
  }

  const centroids = classCentroids(rows);
  const states = Object.keys(centroids).sort();
  const similarities = [];

  for (let i = 0; i < states.length; i += 1) {
    for (let j = i; j < states.length; j += 1) {
      const a = states[i];
      const b = states[j];
      similarities.push({
        a,
        b,
        cosine: cosine(centroids[a], centroids[b]),
      });
    }
  }

  const stability = states.map((state) => {
    const stateRows = rows.filter((row) => row.label === state);
    const centroid = centroids[state];
    const scores = stateRows.map((row) =>
      cosine(row.features, centroid),
    );

    return {
      state,
      snapshots: stateRows.length,
      meanWithinStateCosine:
        scores.reduce((sum, value) => sum + value, 0) /
        Math.max(1, scores.length),
    };
  });

  return {
    states,
    centroids,
    similarities,
    stability,
    snapshots: rows.length,
  };
}

function squaredDistance(a, b) {
  let total = 0;
  const n = Math.min(a.length, b.length);
  for (let index = 0; index < n; index += 1) {
    const delta = a[index] - b[index];
    total += delta * delta;
  }
  return total;
}

function cosine(a, b) {
  let dot = 0;
  let a2 = 0;
  let b2 = 0;
  const n = Math.min(a.length, b.length);

  for (let index = 0; index < n; index += 1) {
    dot += a[index] * b[index];
    a2 += a[index] * a[index];
    b2 += b[index] * b[index];
  }

  if (!a2 || !b2) return 0;
  return dot / (Math.sqrt(a2) * Math.sqrt(b2));
}

function unique(values) {
  return Array.from(new Set(values));
}

function shuffle(values, rng) {
  const copy = values.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function mulberry32(seed) {
  let current = seed >>> 0;
  return () => {
    current += 0x6d2b79f5;
    let value = current;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
