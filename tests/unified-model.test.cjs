"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");

function loadTs(relative, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name) => imports[name] || require(name));
  return loaded.exports;
}
const graph = loadTs("lib/unified-model.ts");
const route = loadTs("app/api/research/model/route.ts", { "@/lib/unified-model": graph });
const panel = loadTs("components/workstation/unified-model-panel.tsx", { "@/lib/unified-model": graph, "@/lib/morpheus": {}, "./ui": {}, "./model-artifact-export": { downloadModelArtifact: async () => {} } });
const request = (query = "") => ({ nextUrl: new URL("https://morpheus.test/api/research/model?" + query) });
const clone = (value) => JSON.parse(JSON.stringify(value));
const input = () => ({ source: { kind: "synthetic", datasetId: "graph-fixture", datasetVersion: "1", license: "fixture", featureSchema: "pre-event-v1" },
  design: { inputTiming: "pre-task-event", assignment: "observational", independentUnitsConfirmed: true },
  rows: Array.from({ length: 48 }, (_, index) => ({ id: "row-" + index, subjectId: "animal-" + Math.floor(index / 8), sessionId: "session-" + Math.floor(index / 8),
    label: index % 2 ? "stimulated" : "control", outcome: index / 100, features: [index / 100], featureNames: ["pre_event_rate"] })) });

const partiallyRatedDreamInput = () => ({ ...input(),
  outcome: { name: "Reported perceptual complexity", unit: "ordinal points", scope: "Recalled-experience reports only" },
  rows: input().rows.map((row, index) => ({ ...row,
    label: index % 8 < 3 ? "Experience" : index % 8 < 6 ? "No experience" : "Without recall",
    outcome: index % 8 < 3 ? index % 8 + 1 : null })) });

test("DREAM import preserves unmeasured nulls and all three report classes without weakening independent-unit gates", async () => {
  const supplied = partiallyRatedDreamInput();
  const admitted = panel.validateUnifiedModelInput(supplied);
  assert.equal(admitted.rows.length, 48);
  assert.deepEqual([...new Set(admitted.rows.map((row) => row.label))].sort(), ["Experience", "No experience", "Without recall"]);
  assert.equal(admitted.rows.filter((row) => row.outcome !== null).length, 18);
  assert.equal(admitted.rows.filter((row) => row.outcome === null).length, 30);
  assert.deepEqual(admitted.outcome, supplied.outcome);
  assert.equal(admitted.rows[0].outcome, 1);
  assert.equal(supplied.rows[3].outcome, null);
  assert.equal(graph.unifiedModel.inputContract.rows.outcome.finiteMeasurementOrExplicitNull, true);
  assert.equal(graph.unifiedModel.inputContract.rows.outcome.minimumObservedPerUnit, 2);
  assert.match(graph.unifiedModel.architecture.heads[1].loss, /masked/);
  const built = await graph.createUnifiedModelRunRequest(admitted, { epochs: 10, hiddenWidth: 16 });
  assert.equal(built.rows.filter((row) => row.outcome === null).length, 30);
  assert.deepEqual(built.outcome, supplied.outcome);
  for (const mutate of [
    data => { data.rows[1].outcome = null; data.rows[2].outcome = null; },
    data => { data.rows[7].label = "No experience"; },
    data => { data.rows.forEach(row => { if (row.subjectId === "animal-5") row.subjectId = "animal-4"; }); },
    data => { delete data.rows[0].outcome; },
    data => { data.rows[0].outcome = "unmeasured"; },
    data => { data.rows[0].outcome = true; },
    data => { data.rows[0].outcome = Infinity; },
    data => { data.rows[0].outcome = NaN; },
    data => { data.rows[0].outcome = 1000001; },
  ]) {
    const invalid = clone(supplied); mutate(invalid);
    assert.throws(() => panel.validateUnifiedModelInput(invalid));
  }
});

test("nullable-outcome import retains genuine zero observations, source hashes and bounded rating scope", () => {
  const supplied = partiallyRatedDreamInput();
  supplied.design.inputTiming = "pre-awakening";
  supplied.rows[0].outcome = 0;
  supplied.rows[1].outcome = 0;
  supplied.rows[2].outcome = null;
  supplied.extractionPlanSha256 = "a".repeat(64);
  supplied.importManifestSha256 = "b".repeat(64);
  supplied.source.assets = [{ id: "reviewed-asset", sha256: "c".repeat(64) }];
  const admitted = panel.validateUnifiedModelInput(supplied);
  assert.equal(admitted.design.inputTiming, "pre-awakening");
  assert.equal(admitted.rows[0].outcome, 0);
  assert.equal(admitted.rows[1].outcome, 0);
  assert.equal(admitted.rows[2].outcome, null);
  assert.equal(admitted.source.extractionPlanSha256, supplied.extractionPlanSha256);
  assert.equal(admitted.source.importManifestSha256, supplied.importManifestSha256);
  assert.deepEqual(admitted.source.assets, supplied.source.assets);
  assert.throws(() => panel.validateUnifiedModelInput({ ...supplied, outcome: { ...supplied.outcome, scope: "x".repeat(4097) } }), /four KiB/);
  assert.throws(() => panel.validateUnifiedModelInput({ ...supplied, outcome: { ...supplied.outcome, scope: { unknown: true } } }), /Rating scope/);
  assert.throws(() => panel.validateUnifiedModelInput({ ...supplied, source: { ...supplied.source, kind: "public-neural-recording", url: "https://example.org/dataset/version" }, outcome: undefined }), /explicit outcome/);
});

test("one shared representation connects reviewed technique adaptations to actual objective and control slots", () => {
  assert.equal(graph.unifiedModel.id, "morpheus-shared-encoder");
  assert.equal(graph.unifiedModel.status, "LOCAL_ADAPTER_IMPLEMENTED");
  assert.equal(graph.unifiedModel.architecture.heads.length, 2);
  const edges = graph.unifiedModel.architecture.edges.filter((edge) => edge.from === "shared-encoder");
  assert.deepEqual(edges.map((edge) => edge.to).sort(), ["classification-head", "outcome-head"]);
  assert.ok(graph.unifiedModel.architecture.edges.some((edge) => edge.from === "joint-loss" && edge.to === "shared-encoder"));
  assert.equal(graph.validateContributionCatalog(graph.unifiedContributions), true);
  const summary = graph.unifiedGraphSummary();
  assert.equal(summary.admittedContributions, 7);
  assert.equal(summary.admittedTechniqueAdaptations, 2);
  assert.equal(summary.uniqueActiveSourcePapers, 3);
  assert.equal(summary.pendingContributions, 3);
  assert.equal(summary.publiclyDistributedCheckpoints, 0);
  assert.equal(graph.unifiedModel.trainingStatus, "PUBLIC_RECORDING_PILOT_EXECUTED");
  assert.ok(graph.unifiedModel.validation.publicPilot.balancedAccuracy < graph.unifiedModel.validation.publicPilot.chance);
  for (const contribution of graph.unifiedContributions.filter((row) => row.status === "ADMITTED")) {
    assert.equal(contribution.integrationStatus, "IMPLEMENTED_AND_TESTED");
    assert.equal(contribution.review.paperMethodsReproduced, false);
    assert.ok(contribution.runtimeBindings.every((binding) => ["train_unified", "validate_unified_request"].includes(binding.symbol)));
    assert.ok(contribution.verification.length);
  }
  assert.throws(() => graph.unifiedContributions.push({ id: "injected" }), TypeError);
  assert.throws(() => graph.unifiedModel.architecture.heads[0].weight = 200, TypeError);
});

test("admission rejects metadata-only promotion, invented losses, dead or wrong-slot runtime bindings and duplicate IDs", () => {
  const admitted = clone(graph.unifiedContributions.find((row) => row.status === "ADMITTED"));
  const pending = clone(graph.unifiedContributions.find((row) => row.status === "PENDING_REVIEW"));
  assert.throws(() => graph.validateContributionCatalog([{ ...pending, status: "ADMITTED" }]), /Admission requires/);
  assert.throws(() => graph.validateContributionCatalog([{ ...pending, slotIds: ["state-classification"] }]), /Pending papers/);
  assert.throws(() => graph.validateContributionCatalog([{ ...admitted, slotIds: ["llm-generated-objective"] }]), /objective slot/);
  assert.throws(() => graph.validateContributionCatalog([{ ...admitted, runtimeBindings: [{ ...admitted.runtimeBindings[0], symbol: "download_and_execute_paper" }] }]), /allowlisted/);
  assert.throws(() => graph.validateContributionCatalog([{ ...admitted, runtimeBindings: [{ ...admitted.runtimeBindings[0], component: "SharedModel.regression" }] }]), /for its slot/);
  assert.throws(() => graph.validateContributionCatalog([admitted, admitted]), /unique stable IDs/);
  assert.throws(() => graph.validateContributionCatalog([{ ...admitted, review: { ...admitted.review, paperMethodsReproduced: true } }]), /paper-reproduction/);
  assert.throws(() => graph.validateContributionCatalog([{ ...admitted, sources: [...admitted.sources, ...admitted.sources] }]), /source mapping/);
});

test("complete contribution manifest is canonical, immutable, reproducible and excludes pending methods", async () => {
  const manifest = await graph.unifiedContributionManifest();
  assert.deepEqual(manifest, await graph.unifiedContributionManifest());
  const { contentSha256, ...payload } = manifest;
  assert.equal(crypto.createHash("sha256").update(graph.canonicalUnifiedJson(payload)).digest("hex"), contentSha256);
  assert.equal(contentSha256, "b13406bc292118c2a98c3312107eb3f2a6128a2bcb93667903ca5141ea3fa924");
  assert.deepEqual(manifest, JSON.parse(fs.readFileSync(path.join(__dirname, "../services/signal-gateway/app/unified-contributions.json"), "utf8")));
  assert.equal(manifest.contributions.length, 7);
  assert.deepEqual([...new Set(manifest.contributions.flatMap((row) => row.sourcePaperIds))].sort(), ["caruana-1997", "guo-inagaki-2017", "vaswani-2017"]);
  assert.equal(new Set(manifest.contributions.flatMap((row) => row.slotIds)).size, graph.unifiedSlots.length);
  const modifiedWeight = clone(payload);
  modifiedWeight.architecture.heads[1].weight = 0.25;
  assert.notEqual(crypto.createHash("sha256").update(graph.canonicalUnifiedJson(modifiedWeight)).digest("hex"), contentSha256);
  const modifiedBinding = clone(payload);
  modifiedBinding.contributions[0].runtimeBindings[0].component = "other_head";
  assert.notEqual(crypto.createHash("sha256").update(graph.canonicalUnifiedJson(modifiedBinding)).digest("hex"), contentSha256);
  assert.ok(manifest.contributions.every((row) => row.id.startsWith("morpheus-c-")));
  assert.throws(() => manifest.contributions[0].sourcePaperIds.push("unreviewed"), TypeError);
  assert.throws(() => graph.canonicalUnifiedJson({ malformed: Infinity }), /finite, plain JSON/);
  assert.throws(() => graph.canonicalUnifiedJson({ omitted: undefined }), /finite, plain JSON/);
});

test("run builder uses the complete reviewed model manifest and blocks caller execution, recipe and weight overrides", async () => {
  const supplied = { ...input(), model: "invented", recipe: { id: "metadata-only" }, contributionManifest: { contributions: [] }, code: "execute paper", weights: "remote", executionUrl: "https://example.invalid" };
  const built = await graph.createUnifiedModelRunRequest(supplied, { seed: 17, epochs: 10, hiddenWidth: 16 });
  assert.equal(built.model, "morpheus-shared-encoder");
  assert.equal(built.method, "unified-model");
  assert.deepEqual(built.recipe, { id: "morpheus-shared-representation-v1", version: "1.1.0", adapterId: "morpheus-shared-encoder", sourcePaperIds: ["caruana-1997", "guo-inagaki-2017", "vaswani-2017"] });
  assert.equal(built.contributionManifest.contributions.length, 7);
  for (const field of ["code", "weights", "executionUrl"]) assert.equal(Object.hasOwn(built, field), false);
  assert.equal(supplied.model, "invented");
  for (const options of [{ seed: -1 }, { seed: true }, { epochs: 101 }, { hiddenWidth: 24 }, { hiddenWidth: true }]) await assert.rejects(graph.createUnifiedModelRunRequest(input(), options), /reviewed bounds/);
  await assert.rejects(graph.createUnifiedModelRunRequest({ ...input(), rows: [] }), /48–4096/);
  await assert.rejects(graph.createUnifiedModelRunRequest({ ...input(), design: null }), /design contract/);
});

test("thousands of candidates page within a versioned snapshot without changing the training manifest", async () => {
  const template = graph.unifiedContributions.find((row) => row.status === "PENDING_REVIEW");
  const fixture = Array.from({ length: 3000 }, (_, index) => ({ ...template, id: "fixture-contribution-" + String(index).padStart(4, "0"), title: "Fixture pending research " + index }));
  graph.validateContributionCatalog(fixture);
  const first = graph.queryUnifiedContributions({ offset: 0, limit: 100, graphVersion: "1.1.0", status: "PENDING_REVIEW" }, fixture);
  const next = graph.queryUnifiedContributions({ offset: first.nextOffset, limit: 100, graphVersion: first.graphVersion }, fixture);
  assert.equal(first.total, 3000);
  assert.equal(next.contributions[0].id, "fixture-contribution-0100");
  assert.equal(graph.queryUnifiedContributions({ offset: 2900, limit: 100 }, fixture).nextOffset, null);
  assert.equal(graph.queryUnifiedContributions({ slot: "state-classification" }).total, 1);
  assert.equal(graph.queryUnifiedContributions({ paperId: "caruana-1997" }).contributions[0].id, "morpheus-c-joint-multitask-v1");
  assert.equal((await graph.unifiedContributionManifest()).contributions.length, 7);
  for (const query of [{ graphVersion: "old-snapshot" }, { limit: 101 }, { offset: -1 }, { offset: NaN }, { status: "TRAINED" }, { slot: "invented" }, { q: "q".repeat(257) }]) assert.throws(() => graph.queryUnifiedContributions(query));
});

test("new DOI metadata produces only stable deduplicable pending review records", async () => {
  const paper = { doi: "https://doi.org/10.9999/Novel-Method", title: "<b>A novel method</b>", status: "ADMITTED", slotIds: ["state-classification"], weights: "remote" };
  const candidate = await graph.pendingUnifiedContributionFromPaper(paper);
  const repeat = await graph.pendingUnifiedContributionFromPaper({ doi: "10.9999/novel-method", title: "A novel method" });
  assert.equal(candidate.id, repeat.id);
  assert.equal(candidate.title, "A novel method");
  assert.equal(candidate.status, "PENDING_REVIEW");
  assert.deepEqual(candidate.runtimeBindings, []);
  assert.deepEqual(candidate.slotIds, []);
  assert.equal(graph.validateContributionCatalog([candidate]), true);
  assert.equal(Object.hasOwn(candidate, "weights"), false);
  await assert.rejects(graph.pendingUnifiedContributionFromPaper({ doi: "javascript:alert(1)", title: "Injected" }), /DOI metadata/);
});

test("model API separates exploration pagination from the full pinned training manifest", async () => {
  const response = await route.GET(request("status=PENDING_REVIEW&limit=1&format=export&graphVersion=1.1.0"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.contributions.length, 1);
  assert.equal(payload.total, 3);
  assert.equal(payload.nextOffset, 1);
  assert.equal(payload.contributionManifest.contributions.length, 7);
  assert.equal(payload.export.contributionManifest.contentSha256, payload.contributionManifest.contentSha256);
  assert.equal(payload.export.page.total, 3);
  assert.equal(payload.model.checkpoint.unsafePickleAccepted, false);
  assert.equal(route.POST, undefined);
  for (const query of ["format=execute", "status=TRAINED", "limit=1000", "offset=-2", "graphVersion=0.9.0", "graphVersion=1.0.0", "graphVersion=1.0.1"]) assert.equal((await route.GET(request(query))).status, 400);
});

test("committed gateway allowlist and JavaScript manifest use the same canonical hash", () => {
  const root = path.resolve(__dirname, "..");
  const check = spawnSync(process.execPath, ["scripts/export-unified-manifest.cjs", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
  const python = spawnSync("python3", ["-c", "import hashlib,json; from pathlib import Path; p=json.loads(Path('services/signal-gateway/app/unified-contributions.json').read_text()); h=p.pop('contentSha256'); assert hashlib.sha256(json.dumps(p,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()==h; print(h)"], { cwd: root, encoding: "utf8" });
  assert.equal(python.status, 0, python.stderr);
  assert.equal(python.stdout.trim(), "b13406bc292118c2a98c3312107eb3f2a6128a2bcb93667903ca5141ea3fa924");
});
