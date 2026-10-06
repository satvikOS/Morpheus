"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadTs(relative, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name) => imports[name] || require(name));
  return loaded.exports;
}
const recipes = loadTs("lib/method-recipes.ts");
const methodsRoute = loadTs("app/api/research/methods/route.ts", { "@/lib/method-recipes": recipes });
const discoveryRoute = loadTs("app/api/research/discovery/route.ts", { "@/lib/method-recipes": recipes });
const request = (query = "") => ({ nextUrl: new URL("https://morpheus.test/api/research/?" + query) });

function classicalRows() {
  return Array.from({ length: 12 }, (_, index) => ({ id: "row-" + index, subjectId: "subject-test", sessionId: "session-" + Math.floor(index / 4),
    label: index % 2 ? "imagery" : "awake", features: [index], featureNames: ["alpha"], sourceMode: "simulation", sourceKind: "simulation_fixture", featureSchema: "test-v1", sampleRate: 256, channelCount: 1 }));
}
const work = (doi = "10.1126/science.aaa5542") => ({ DOI: doi, title: ["Engram memory method"], published: { "date-parts": [[2015, 5, 28]] } });

test("implemented adapters carry immutable versioned contracts and source links, staged references cannot execute", () => {
  const implemented = recipes.methodRecipes.filter((recipe) => recipe.status === "EXECUTABLE");
  assert.equal(implemented.length, 3);
  assert.equal(new Set(recipes.methodRecipes.map((recipe) => recipe.id)).size, recipes.methodRecipes.length);
  for (const recipe of implemented) {
    assert.equal(recipe.execution.endpoint, "/models/runs");
    assert.equal(recipe.execution.plane, "local-science-adapter");
    assert.equal(recipe.reproduction, "ENGINEERING_ANALYSIS_ONLY");
    assert.ok(recipe.inputContract.required.length && recipe.controls.length && recipe.gates.length);
    for (const source of recipe.sources) {
      assert.equal(source.relationship, "application_context");
      assert.ok(source.url.startsWith("https://"));
      assert.ok(recipe.sourcePaperIds.includes(source.paperId));
    }
  }
  assert.throws(() => recipes.methodRecipes.push({ status: "EXECUTABLE" }), TypeError);
  assert.throws(() => implemented[0].sourcePaperIds.push("invented-paper"), TypeError);
  assert.throws(() => recipes.createRecipeRunRequest("fmri-visual-reconstruction-reference-v1", { rows: classicalRows() }), /no reviewed executable adapter/);
  assert.throws(() => recipes.createRecipeRunRequest("llm-invented-new-method", { rows: classicalRows() }), /no reviewed executable adapter/);
});

test("thousands of reviewed registry entries paginate deterministically without executing or fabricating discoveries", () => {
  const fixture = Array.from({ length: 3000 }, (_, index) => ({ ...recipes.methodRecipes[0], id: "fixture-method-" + String(index).padStart(4, "0"), status: "REVIEW_REQUIRED" }));
  const first = recipes.queryMethodRecipes({ limit: 100, offset: 0, status: "REVIEW_REQUIRED" }, fixture);
  const next = recipes.queryMethodRecipes({ limit: 100, offset: first.nextOffset }, fixture);
  assert.equal(first.total, 3000);
  assert.equal(first.methods.length, 100);
  assert.equal(next.methods[0].id, "fixture-method-0100");
  assert.equal(new Set([...first.methods, ...next.methods].map((method) => method.id)).size, 200);
  const end = recipes.queryMethodRecipes({ limit: 100, offset: 2900 }, fixture);
  assert.equal(end.nextOffset, null);
  assert.equal(recipes.queryMethodRecipes({ q: "nothing-matches" }, fixture).total, 0);
  assert.equal(recipes.queryMethodRecipes({ paperId: "ryan-2015" }).methods[0].adapterId, "causal-perturbation");
  for (const options of [{ limit: 101 }, { offset: -1 }, { limit: NaN }, { status: "READY" }, { domain: "invented" }]) assert.throws(() => recipes.queryMethodRecipes(options));
});

test("run construction forces the reviewed adapter and preserves paper-to-method-to-run provenance", () => {
  const input = { rows: classicalRows(), model: "invented", method: "invented", executionUrl: "https://evil.example", recipe: { id: "overridden" } };
  const run = recipes.createRecipeRunRequest("m3-diagonal-lda-v1", input, { seed: 19, permutations: 20 });
  assert.equal(run.model, "diagonal-lda");
  assert.equal(run.method, undefined);
  assert.equal(run.executionUrl, undefined);
  assert.deepEqual(run.recipe, { id: "m3-diagonal-lda-v1", version: "1.0.0", adapterId: "diagonal-lda", sourcePaperIds: ["horikawa-2013", "wong-2025"] });
  assert.equal(input.model, "invented");
  assert.throws(() => recipes.createRecipeRunRequest("m3-nearest-centroid-v1", { rows: [] }), /8–2048/);
  assert.throws(() => recipes.createRecipeRunRequest("m3-nearest-centroid-v1", input, { permutations: 10000 }), /20–200/);
});

test("paired perturbation recipe requires source/design/outcome inputs and bounded sampling", () => {
  const inputs = { rows: Array.from({ length: 24 }, (_, index) => ({ trialId: "fixture-" + index })), source: { kind: "synthetic" }, design: { assignment: "observational" }, outcome: { name: "response", unit: "score" }, executionUrl: "https://evil.example" };
  const run = recipes.createRecipeRunRequest("causal-paired-contrast-v1", inputs);
  assert.equal(run.method, "causal-perturbation");
  assert.equal(run.permutations, 2000);
  assert.equal(run.bootstrapSamples, 1000);
  assert.equal(run.executionUrl, undefined);
  assert.equal(run.recipe.adapterId, "causal-perturbation");
  assert.throws(() => recipes.createRecipeRunRequest("causal-paired-contrast-v1", { rows: inputs.rows }), /explicit source/);
  assert.throws(() => recipes.createRecipeRunRequest("causal-paired-contrast-v1", inputs, { bootstrapSamples: 6000 }), /200–5000/);
});

test("exact DOI matching maps literature context to reviewed adapters without autoexecuting new papers", () => {
  const known = recipes.mapDiscoveredPaper(work("https://doi.org/10.1126/SCIENCE.AAA5542"));
  assert.equal(known.applicationStatus, "RUN_ADAPTER_AVAILABLE");
  assert.equal(known.methods[0].adapterId, "causal-perturbation");
  assert.equal(known.methods[0].mappingRelation, "application_context_only");
  const staged = recipes.mapDiscoveredPaper(work("10.1371/journal.pcbi.1006633"));
  assert.equal(staged.applicationStatus, "ADAPTER_STAGING");
  const unknown = recipes.mapDiscoveredPaper({ ...work("10.9999/new-study"), implementation: "EXECUTABLE", endpoint: "https://evil.example" });
  assert.equal(unknown.applicationStatus, "UNMAPPED_REVIEW_REQUIRED");
  assert.equal(unknown.methods.length, 0);
  assert.equal(unknown.reviewStatus, "REVIEW_REQUIRED");
  assert.equal(unknown.metadataOnly, true);
  assert.throws(() => recipes.mapDiscoveredPaper(work("javascript:alert(1)")), /valid DOI/);
  assert.equal(recipes.methodRecipeExport().schema, "morpheus-method-recipes-v1");
});

test("method route validates filters and returns versioned bounded exports", async () => {
  let response = await methodsRoute.GET(request("domain=decoding&status=EXECUTABLE&limit=1&format=export"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.total, 2);
  assert.equal(payload.methods.length, 1);
  assert.equal(payload.nextOffset, 1);
  assert.equal(payload.export.schema, recipes.METHOD_REGISTRY_VERSION);
  response = await methodsRoute.GET(request("limit=1000"));
  assert.equal(response.status, 400);
  response = await methodsRoute.GET(request("status=imaginary"));
  assert.equal(response.status, 400);
});

test("live discovery paginates fixed-host metadata, preserves exact adapter mapping and bounds requests", async () => {
  const originalFetch = global.fetch;
  let fetched;
  try {
    global.fetch = async (url) => {
      fetched = new URL(url);
      return Response.json({ message: { items: [work(), work("10.9999/new-study")], "total-results": 3000, "next-cursor": "opaque-next-cursor" } });
    };
    const response = await discoveryRoute.GET(request("q=memory&limit=2&cursor=opaque-current-cursor"));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(fetched.hostname, "api.crossref.org");
    assert.equal(fetched.searchParams.get("rows"), "2");
    assert.equal(fetched.searchParams.get("cursor"), "opaque-current-cursor");
    assert.equal(payload.nextCursor, "opaque-next-cursor");
    assert.equal(payload.total, 3000);
    assert.equal(payload.items[0].applicationStatus, "RUN_ADAPTER_AVAILABLE");
    assert.equal(payload.items[1].applicationStatus, "UNMAPPED_REVIEW_REQUIRED");
    assert.equal((await discoveryRoute.GET(request("limit=101"))).status, 400);
    assert.equal((await discoveryRoute.GET(request("doi=not-a-doi"))).status, 400);
  } finally { global.fetch = originalFetch; }
});

test("DOI lookup uses public metadata and upstream failures never fabricate executable papers", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async (url) => {
      assert.equal(new URL(url).hostname, "api.crossref.org");
      assert.match(new URL(url).pathname, /science\.aaa5542/);
      return Response.json({ message: work() });
    };
    const payload = await (await discoveryRoute.GET(request("doi=10.1126%2Fscience.aaa5542"))).json();
    assert.equal(payload.total, 1);
    assert.equal(payload.nextCursor, null);
    global.fetch = async () => new Response("Rate limited", { status: 429 });
    assert.equal((await discoveryRoute.GET(request())).status, 429);
    global.fetch = async () => { throw new Error("upstream timeout"); };
    const failure = await discoveryRoute.GET(request());
    assert.equal(failure.status, 502);
    assert.equal((await failure.json()).items, undefined);
  } finally { global.fetch = originalFetch; }
});
