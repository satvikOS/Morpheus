const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");

function loadTs(relative) {
  const filename = path.resolve(__dirname, "..", relative);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(source, filename);
  return compiled.exports;
}

const capture = loadTs("lib/dataset-store.ts");
const recurrence = loadTs("lib/dream-analysis.ts");
const reinstatement = loadTs("lib/reinstatement-store.ts");
const atlas = loadTs("lib/atlas-store.ts");
const at = "2026-10-06T12:00:00.000Z";

function record(id, episode = id, subject = "subject-test") {
  const raw = "  A white bridge beside black water.\nA red boat.  ";
  return {
    dream_id: id, captured_at: at, raw_report: raw,
    raw_sha256: crypto.createHash("sha256").update(raw).digest("hex"),
    lucid: false, confidence: 4, tags: [], sensory_modalities: ["visual"],
    schema_version: "dataset-zero-v2",
    capture: { subject_id: subject, session_id: "session-" + episode, sleep_episode_id: episode,
      awakening_id: "awakening-" + id, awakened_at: "2026-10-06T11:59:00.000Z", report_latency_seconds: 60,
      awakening_method: "spontaneous", sleep_stage: null, protocol_version: "m0-capture-v2",
      recording_id: null, marker_ids: [], prior_related_recall: "unknown" },
    annotations: [],
  };
}

function annotation(id = "annotation-1") {
  return { id, created_at: at, annotator_id: "annotator-test", method: "self_report", blinding: "unblinded",
    note: "A later interpretation, not a replacement report.", tags: [], entities: [], locations: [], events: [],
    subjective_recurrence: null, subjective_continuation: null };
}

function trial() {
  const protocol = { version: "m2-protocol-v2", registeredAt: at, operatorId: "operator-test", delaySeconds: 30,
    intentionCondition: false, assignment: "manual", scoringRule: "0 no continuity; 5 detailed continuation",
    analysisPlan: "Descriptive counts by condition", preDreamId: "D-before" };
  return { id: "trial-test", sessionId: "session-test", createdAt: at, delaySeconds: 30, intentionCondition: false,
    preDreamId: "D-before", continuityScore: null, blinded: false, notes: "", schemaVersion: "reinstatement-trial-v2",
    protocol, protocolSha256: crypto.createHash("sha256").update(JSON.stringify(protocol)).digest("hex"),
    state: "CREATED", transitions: [{ state: "CREATED", at, reason: "Prospective protocol snapshot" }] };
}

function snapshot(id, sessionId, features, sourceMode = "live") {
  return { id, subjectId: "subject-test", sessionId, state: "awake", capturedAt: at, source: "test-source",
    sampleRate: 256, channelCount: 1, features, featureNames: ["rms", "flatlineRatio"],
    metadata: { sourceMode, featureSchema: "test-features-v1" } };
}

test("raw whitespace/digest and capture context stay immutable while annotations append", async () => {
  const original = record("D-1");
  assert.equal(await capture.verifyDreamRecordIntegrity(original), true);
  const amended = capture.appendDreamAnnotation(original, annotation());
  assert.equal(amended.raw_report, original.raw_report);
  assert.equal(amended.raw_sha256, original.raw_sha256);
  assert.equal(amended.annotations[0].revision, 1);
  assert.equal(original.annotations.length, 0);
  assert.throws(() => capture.assertDreamRecordUpdate(original, { ...original, raw_report: original.raw_report.trim() }), /Sealed capture/);
  assert.throws(() => capture.assertDreamRecordUpdate(original, { ...original, capture: { ...original.capture, subject_id: "other" } }), /Sealed capture/);
  assert.throws(() => capture.assertDreamRecordUpdate(amended, { ...amended, annotations: [] }), /annotations are immutable/);
  assert.throws(() => capture.assertDreamRecordUpdate(amended, { ...amended, annotations: [{ ...amended.annotations[0], note: "rewritten" }] }), /annotations are immutable/);
});

test("capture latency rejects future awakening and preserves unknown time", () => {
  assert.equal(capture.reportLatencySeconds(null, at), null);
  assert.equal(capture.reportLatencySeconds("2026-10-06T11:59:00Z", at), 60);
  assert.throws(() => capture.reportLatencySeconds("2026-10-06T12:01:00Z", at), /precede/);
  assert.throws(() => capture.validateDreamRecord({ ...record("D-1"), capture: { ...record("D-1").capture, report_latency_seconds: 2 } }), /latency/);
});

test("legacy exports retain unknown context, exact text and original digest", () => {
  const legacy = record("D-legacy");
  delete legacy.schema_version; delete legacy.capture; delete legacy.annotations;
  capture.validateDreamRecord(legacy);
  const exported = capture.dreamCorpusExport([record("D-z"), legacy], at);
  assert.equal(exported.records[0].dream_id, "D-legacy");
  assert.equal(exported.records[0].capture, undefined);
  assert.equal(exported.records[0].raw_sha256, legacy.raw_sha256);
  assert.equal(exported.storage_plane, "local");
});

test("quota/read failures and digest tampering are errors, never a false saved state", async () => {
  const beforeStorage = Object.getOwnPropertyDescriptor(global, "localStorage");
  const beforeDb = global.indexedDB;
  try {
    delete global.indexedDB;
    Object.defineProperty(global, "localStorage", { configurable: true, writable: true, value: { getItem: () => null, setItem: () => { throw new Error("quota exceeded"); } } });
    await assert.rejects(capture.putDreamRecord(record("D-1")), /quota exceeded/);
    await assert.rejects(capture.putDreamRecord({ ...record("D-1"), raw_sha256: "0".repeat(64) }), /does not match/);
    global.localStorage = { getItem: () => "not json" };
    await assert.rejects(capture.listDreamRecords(), SyntaxError);
    await assert.rejects(reinstatement.putReinstatementTrial(trial()), /IndexedDB is unavailable/);
    await assert.rejects(atlas.putAtlasSnapshot(snapshot("s-1", "session-1", [1, 0])), /not been saved/);
  } finally { if (beforeStorage) Object.defineProperty(global, "localStorage", beforeStorage); else delete global.localStorage; global.indexedDB = beforeDb; }
});

test("tiny or legacy recurrence corpora never become 192 independent null comparisons", () => {
  const rows = [record("D-1"), record("D-2"), record("D-3")];
  const result = recurrence.recurrenceCandidates(rows, 99);
  assert.equal(result.length, 3);
  assert.ok(result.every((pair) => pair.backgroundComparisons === 0 && pair.backgroundTailFraction === undefined));
  assert.ok(result.every((pair) => pair.permutationP === undefined && pair.evidence === "descriptive_only"));
  const legacy = rows.map(({ capture, ...row }) => ({ ...row, schema_version: undefined }));
  assert.ok(recurrence.recurrenceCandidates(legacy).every((pair) => pair.backgroundComparisons === 0));
});

test("recurrence uses unique disjoint episodes, excludes same-episode targets, and counts every scanned pair", () => {
  const rows = Array.from({ length: 8 }, (_, index) => record("D-" + index));
  const result = recurrence.recurrenceCandidates([...rows, rows[0]], 99);
  assert.equal(result.length, 28);
  assert.ok(result.every((pair) => pair.backgroundComparisons === 3 && pair.testedComparisons === 28));
  assert.ok(result.every((pair) => pair.backgroundTailFraction >= 0.25 && pair.familyScreeningBound === 1));
  const paired = recurrence.recurrenceCandidates([record("D-a", "same"), record("D-b", "same"), ...rows], 99);
  assert.equal(paired.some((pair) => pair.a === "D-a" && pair.b === "D-b"), false);
  const differentSubject = recurrence.recurrenceCandidates([record("D-a", "a", "s-a"), record("D-b", "b", "s-b"), ...rows], 99).find((pair) => pair.a === "D-a" && pair.b === "D-b");
  assert.equal(differentSubject.backgroundComparisons, 0);
});

test("BH correction preserves original order and prevents invalid p values", () => {
  const corrected = recurrence.benjaminiHochberg([0.04, 0.001, 0.03]);
  assert.ok(Math.abs(corrected[0] - 0.04) < 1e-12);
  assert.ok(Math.abs(corrected[1] - 0.003) < 1e-12);
  assert.ok(Math.abs(corrected[2] - 0.04) < 1e-12);
  assert.throws(() => recurrence.benjaminiHochberg([-0.1]), /\[0, 1\]/);
});

test("prospective protocol and transition history cannot be retrospectively rewritten", async () => {
  const initial = trial();
  assert.equal(await reinstatement.protocolDigest(initial.protocol), initial.protocolSha256);
  const awakened = reinstatement.transitionTrial(initial, "AWAKENED", "Marker observed", "2026-10-06T12:01:00Z", "marker-1");
  reinstatement.assertTrialUpdate(initial, awakened);
  assert.throws(() => reinstatement.assertTrialUpdate(initial, { ...initial, delaySeconds: 120 }), /does not match/);
  assert.throws(() => reinstatement.assertTrialUpdate(initial, { ...initial, protocol: { ...initial.protocol, analysisPlan: "Changed after looking" } }), /retrospectively/);
  assert.throws(() => reinstatement.transitionTrial(initial, "SCORED", "Skip follow-up"), /Invalid trial state/);
  assert.throws(() => reinstatement.transitionTrial(awakened, "FOLLOWUP", "Backdated", at), /non-decreasing/);
  assert.throws(() => reinstatement.assertTrialUpdate(awakened, { ...awakened, transitions: [{ ...awakened.transitions[0], reason: "rewritten" }, awakened.transitions[1]] }), /history cannot be rewritten/);
});

test("operator scoring cannot claim blinding and reviewer packets omit condition metadata", () => {
  const scored = reinstatement.scoreTrial(trial(), 4, "D-after", "Same location", "operator-test", "2026-10-06T12:10:00Z");
  reinstatement.assertTrialUpdate(trial(), scored);
  assert.equal(scored.blinded, false);
  assert.equal(scored.state, "SCORED");
  assert.equal(scored.transitions.length, 3);
  assert.throws(() => reinstatement.assertTrialUpdate(scored, { ...scored, blinded: true }), /Blinding requires/);
  const packet = reinstatement.blindedScoringPacket(scored, "review-packet-1");
  for (const key of ["intentionCondition", "delaySeconds", "sessionId", "createdAt", "operatorId", "continuityScore"]) assert.equal(Object.hasOwn(packet, key), false);
  assert.equal(packet.postDreamId, "D-after");
  assert.throws(() => reinstatement.assertTrialUpdate(undefined, { ...scored, postDreamId: undefined }), /both report references/);
  assert.throws(() => reinstatement.assertTrialUpdate(undefined, { ...trial(), continuityScore: 3 }), /scoring transition/);
  assert.throws(() => reinstatement.assertTrialUpdate(undefined, { ...trial(), protocol: { ...trial().protocol, assignment: "randomized" } }), /manual assignment only/);
});

test("descriptive summaries preserve control/intention strata and omit retained exclusions", () => {
  const control = reinstatement.scoreTrial(trial(), 1, "D-after", "", "operator-test", "2026-10-06T12:10:00Z");
  const intention = { ...control, id: "intention", intentionCondition: true };
  const excluded = { ...control, id: "excluded", state: "EXCLUDED", continuityScore: 5 };
  const summary = reinstatement.summarizeReinstatement([control, intention, excluded]);
  assert.equal(summary.length, 2);
  assert.ok(summary.every((row) => row.n === 1 && row.meanScore === 1 && row.evidence === "descriptive_only"));
});

test("atlas trajectories separate source/schema families and retain per-session uncertainty and QC", () => {
  const rows = [snapshot("live-1", "session-1", [1, 0]), snapshot("live-2", "session-1", [3, 0.1]),
    snapshot("live-3", "session-2", [2, 0]), snapshot("fixture", "session-1", [100, 0], "simulation")];
  const result = atlas.longitudinalAtlasSummary(rows, "subject-test");
  assert.equal(result.length, 2);
  const live = result.find((family) => family.sourceKind === "local_acquisition_unverified");
  assert.equal(live.sessions[0].mean[0], 2);
  assert.equal(live.sessions[0].standardError[0], 1);
  assert.equal(live.sessions[0].flaggedMeasurements, 1);
  assert.equal(live.sessions[1].standardError[0], null);
  assert.equal(live.adjacentComparisons.length, 1);
  assert.equal(live.evidence, "descriptive_only");
  assert.throws(() => atlas.normalizeAtlasSnapshot(snapshot("bad", "session-1", [NaN, 0])), /finite/);
  const flagged = atlas.normalizeAtlasSnapshot(snapshot("flagged", "session-1", [1, 0.1]));
  const suppressed = atlas.normalizeAtlasSnapshot({ ...flagged, provenance: { ...flagged.provenance, qualityFlags: [] } });
  assert.equal(suppressed.provenance.qualityFlags.length, 1);
  assert.throws(() => atlas.normalizeAtlasSnapshot({ ...flagged, provenance: { ...flagged.provenance, evidence: "validated_memory" } }), /engineering provenance/);
  assert.throws(() => atlas.normalizeAtlasSnapshot({ ...flagged, provenance: { ...flagged.provenance, featureSchema: "other" } }), /conflicts with its metadata/);
  assert.throws(() => atlas.normalizeAtlasSnapshot({ ...flagged, featureNames: ["rms", ""] }), /finite, named/);
});


test("explicit deletion removes the inactive legacy recovery copy and does not resurrect reports", async () => {
  const beforeStorage = Object.getOwnPropertyDescriptor(global, "localStorage");
  const beforeDb = global.indexedDB;
  const storage = new Map([
    ["morpheus.dataset-zero.v1", JSON.stringify([record("D-delete"), record("D-keep")])],
    ["morpheus.dataset-zero.legacy-backup.v1", JSON.stringify([record("D-delete"), record("D-keep")])],
  ]);
  try {
    delete global.indexedDB;
    Object.defineProperty(global, "localStorage", { configurable: true, writable: true,
      value: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
    await capture.deleteDreamRecord("D-delete");
    assert.deepEqual((await capture.listDreamRecords()).map((row) => row.dream_id), ["D-keep"]);
    assert.deepEqual(JSON.parse(storage.get("morpheus.dataset-zero.legacy-backup.v1")).map((row) => row.dream_id), ["D-keep"]);
  } finally { if (beforeStorage) Object.defineProperty(global, "localStorage", beforeStorage); else delete global.localStorage; global.indexedDB = beforeDb; }
});
