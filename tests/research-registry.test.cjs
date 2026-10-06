const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const source = fs.readFileSync(require("node:path").join(__dirname, "../lib/research-registry.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const registryModule = { exports: {} };
new Function("module", "exports", compiled)(registryModule, registryModule.exports);
const registry = registryModule.exports;

test("public CSV preserves quoted multiline fields, escaped quotes and CRLF", () => {
  assert.deepEqual(registry.parsePublicCsv('\uFEFFid,description\r\n1,"A, B\nSay ""hello"""\r\n'), [{ id: "1", description: 'A, B\nSay "hello"' }]);
  assert.throws(() => registry.parsePublicCsv('id,value\n1,"unfinished'), /Unterminated/);
  assert.throws(() => registry.parsePublicCsv('id,value\n1,2,3'), /column count/);
});

test("DREAM registry maps only the current non-revoked amendment and retains private access", () => {
  const base = { "Set ID": "13", Amendment: "2", "Common name": "Tononi", "Number of samples": "287", "Number of subjects": "39", "Data URL": "https://doi.org/10.26180/23306054.v3", Accessibility: "Open", Revoked: "FALSE", "Latest amendment": "TRUE", "Date approved": "1704067200", "Subject email": "must-never-be-exposed" };
  const result = registry.mapDreamPublicDatasets([
    { ...base, Amendment: "0", Revoked: "TRUE", "Latest amendment": "FALSE" },
    { ...base, Amendment: "1", "Latest amendment": "FALSE" },
    base,
    { ...base, "Set ID": "8", Accessibility: "Private", "Data URL": "#N/A", "Number of samples": "unknown" },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].samples, 287);
  assert.equal(result[0].modified, "2024-01-01T00:00:00.000Z");
  assert.equal(result[1].access, "Private");
  assert.equal(result[1].samples, null);
  assert.match(result[1].url, /bridges.monash.edu/);
  assert.equal(JSON.stringify(result).includes("must-never-be-exposed"), false);
  assert.throws(() => registry.mapDreamPublicDatasets([base, base]), /duplicate/);
  assert.throws(() => registry.mapDreamPublicDatasets([{ "Set ID": "1" }]), /schema changed/);
});

test("unsafe source URLs cannot become executable or credential-bearing links", () => {
  for (const url of ["javascript:alert(1)", "https://user:secret@example.org/", "https://127.0.0.1/x", "http://example.org/", "https://localhost/"]) assert.equal(registry.safeResearchUrl(url), null);
  assert.equal(registry.safeResearchUrl("https://doi.org/10.1234/example"), "https://doi.org/10.1234/example");
});

test("every research relationship resolves and source review never implies reproduction", () => {
  const data = registry.getResearchLibrary();
  for (const paper of data.papers) {
    for (const id of paper.datasetIds) assert.ok(data.datasets.some((item) => item.id === id));
    for (const id of paper.modelIds) assert.ok(data.models.some((item) => item.id === id));
    for (const id of paper.hypothesisIds) assert.ok(data.hypotheses.some((item) => item.id === id));
    assert.equal(paper.reproductionStatus, "NOT_REPRODUCED");
  }
  assert.equal(data.hypotheses.length, 7);
  assert.ok(registry.getResearchLibrary("Deisseroth", "optogenetics").papers.length >= 2);
  assert.equal(registry.getResearchLibrary("no-such-study").papers.length, 0);
});
