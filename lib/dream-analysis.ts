import type { ResearchDreamRecord as DreamRecord } from "./dataset-store";

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
  tfidf?: number;
  backgroundMean?: number;
  backgroundTailFraction?: number;
  backgroundComparisons?: number;
  testedComparisons?: number;
  familyScreeningBound?: number;
  evidence: "descriptive_only";
  exclusion?: string;
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
    evidence: "descriptive_only",
  };
}

/** BH correction is available for planned statistical tests, never applied to these descriptive ranks. */
export function benjaminiHochberg(pValues: number[]): number[] {
  if (pValues.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error("p values must lie in [0, 1].");
  const sorted = pValues.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const adjusted = new Array<number>(pValues.length);
  let minimum = 1;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    minimum = Math.min(minimum, sorted[i].value * sorted.length / (i + 1));
    adjusted[sorted[i].index] = minimum;
  }
  return adjusted;
}

function episodeKey(record: DreamRecord) {
  // Missing legacy episode metadata cannot establish independence.
  return record.capture ? record.capture.subject_id + ":" + record.capture.session_id + ":" + record.capture.sleep_episode_id : null;
}

function sameEpisode(a: DreamRecord, b: DreamRecord) {
  return episodeKey(a) !== null && episodeKey(a) === episodeKey(b);
}

function tfidfVector(record: DreamRecord, records: DreamRecord[]) {
  const result = vector(record.raw_report);
  for (const [token, count] of result) {
    const documents = records.filter((row) => tokens(row.raw_report).includes(token)).length;
    result.set(token, count * (1 + Math.log((records.length + 1) / (documents + 1))));
  }
  return result;
}

export function recurrenceCandidates(records: DreamRecord[], limit = 12) {
  // A comparator episode is used once, not sampled repeatedly to inflate a null n.
  const unique = [...new Map(records.map((record) => [record.dream_id, record])).values()];
  const pairs: DreamSimilarity[] = [];
  const tfidf = new Map(unique.map((record) => [record.dream_id, tfidfVector(record, unique)]));
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      const a = unique[i];
      const b = unique[j];
      if (sameEpisode(a, b)) continue;
      const observed = compareDreams(a, b);
      observed.tfidf = cosine(tfidf.get(a.dream_id)!, tfidf.get(b.dream_id)!);
      // Disjoint, unique episode pairs. Only known, same-subject episodes qualify.
      // These are background comparisons, not known negatives or a permutation test.
      const available = unique.filter((record) => {
        const key = episodeKey(record);
        return key && record.dream_id !== a.dream_id && record.dream_id !== b.dream_id &&
          key !== episodeKey(a) && key !== episodeKey(b) &&
          a.capture?.subject_id === b.capture?.subject_id &&
          record.capture?.subject_id === a.capture?.subject_id;
      }).sort((left, right) => left.dream_id.localeCompare(right.dream_id));
      const used = new Set<string>();
      const independent: DreamRecord[] = [];
      for (const record of available) {
        const key = episodeKey(record)!;
        if (!used.has(key)) { used.add(key); independent.push(record); }
      }
      const background: number[] = [];
      for (let k = 0; k + 1 < independent.length; k += 2) background.push(compareDreams(independent[k], independent[k + 1]).score);
      observed.backgroundComparisons = background.length;
      if (background.length) {
        observed.backgroundMean = background.reduce((sum, value) => sum + value, 0) / background.length;
        observed.backgroundTailFraction = (1 + background.filter((value) => value >= observed.score).length) / (background.length + 1);
      } else {
        observed.exclusion = "No disjoint, same-subject background episodes with known episode IDs.";
      }
      pairs.push(observed);
    }
  }
  for (const pair of pairs) {
    pair.testedComparisons = pairs.length;
    // A conservative family-size screen, not a corrected p value or significance.
    if (pair.backgroundTailFraction !== undefined) pair.familyScreeningBound = Math.min(1, pair.backgroundTailFraction * pairs.length);
  }
  return pairs.sort((left, right) => right.score - left.score).slice(0, Math.max(0, limit));
}
