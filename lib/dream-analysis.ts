import type { DreamRecord } from "./morpheus";

const stopWords = new Set([
  "the","a","an","and","or","but","to","of","in","on","at","for","with","from",
  "was","were","is","are","i","me","my","we","our","it","this","that","then",
  "had","have","has","there","here","as","so","very","just","some","into",
]);

function tokens(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function vector(text: string) {
  const map = new Map<string, number>();
  for (const token of tokens(text)) {
    map.set(token, (map.get(token) || 0) + 1);
  }
  return map;
}

function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0;
  let a2 = 0;
  let b2 = 0;

  for (const value of a.values()) a2 += value * value;
  for (const value of b.values()) b2 += value * value;

  for (const [token, value] of a.entries()) {
    dot += value * (b.get(token) || 0);
  }

  if (!a2 || !b2) return 0;
  return dot / (Math.sqrt(a2) * Math.sqrt(b2));
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union ? intersection / union : 0;
}

export type DreamSimilarity = {
  a: string;
  b: string;
  score: number;
  lexical: number;
  tags: number;
  modalities: number;
  sharedTokens: string[];
  nullMean?: number;
  permutationP?: number;
  nullComparisons?: number;
};

export function compareDreams(a: DreamRecord, b: DreamRecord): DreamSimilarity {
  const aTokens = new Set(tokens(a.raw_report));
  const bTokens = new Set(tokens(b.raw_report));
  const lexical = cosine(vector(a.raw_report), vector(b.raw_report));
  const tagScore = jaccard(new Set(a.tags), new Set(b.tags));
  const modalityScore = jaccard(
    new Set(a.sensory_modalities),
    new Set(b.sensory_modalities),
  );

  const sharedTokens = [...aTokens]
    .filter((token) => bTokens.has(token))
    .slice(0, 12);

  const score = lexical * 0.72 + tagScore * 0.18 + modalityScore * 0.1;

  return {
    a: a.dream_id,
    b: b.dream_id,
    score,
    lexical,
    tags: tagScore,
    modalities: modalityScore,
    sharedTokens,
  };
}

function seededRandom(seedText: string) {
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }

  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function nullDistribution(
  anchor: DreamRecord,
  excludedId: string,
  records: DreamRecord[],
  iterations = 96,
) {
  const pool = records.filter(
    (record) =>
      record.dream_id !== anchor.dream_id &&
      record.dream_id !== excludedId,
  );

  if (!pool.length) return [] as number[];

  const random = seededRandom(
    anchor.dream_id + ":" + excludedId,
  );
  const scores: number[] = [];

  for (let index = 0; index < iterations; index += 1) {
    const candidate =
      pool[Math.floor(random() * pool.length) % pool.length];
    scores.push(compareDreams(anchor, candidate).score);
  }

  return scores;
}

export function recurrenceCandidates(
  records: DreamRecord[],
  limit = 12,
) {
  const pairs: DreamSimilarity[] = [];

  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      const observed = compareDreams(records[i], records[j]);
      const nullScores = [
        ...nullDistribution(
          records[i],
          records[j].dream_id,
          records,
        ),
        ...nullDistribution(
          records[j],
          records[i].dream_id,
          records,
        ),
      ];

      if (nullScores.length) {
        observed.nullMean =
          nullScores.reduce(
            (sum, value) => sum + value,
            0,
          ) / nullScores.length;
        observed.permutationP =
          (1 +
            nullScores.filter(
              (value) => value >= observed.score,
            ).length) /
          (nullScores.length + 1);
        observed.nullComparisons = nullScores.length;
      }

      pairs.push(observed);
    }
  }

  return pairs
    .sort((left, right) => {
      const leftP = left.permutationP ?? 1;
      const rightP = right.permutationP ?? 1;
      if (leftP !== rightP) return leftP - rightP;
      return right.score - left.score;
    })
    .slice(0, limit);
}
