const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function evaluate(rows) {
  let output;
  const context = vm.createContext({ performance, self: { postMessage: (value) => { output = value; } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/workers/research-worker.js'), 'utf8'), context);
  context.self.onmessage({ data: { id: 'test', type: 'baseline', rows, permutations: 20 } });
  return JSON.parse(JSON.stringify(output));
}
function rows() {
  return ['s1', 's2', 's3'].flatMap((sessionId) => ['awake', 'imagery'].flatMap((label, index) => [0, 1].map((repeat) => ({
    id: `${sessionId}-${label}-${repeat}`, subjectId: 'p1', sessionId, label, features: [index * 10 + repeat * .1, index * 2],
  }))));
}
test('refuses single-session pseudo holdout and confounded session labels', () => {
  const data = rows();
  assert.equal(evaluate(data.map((row) => ({ ...row, sessionId: 'one' }))).ok, false);
  assert.equal(evaluate(data.filter((row) => row.sessionId !== 's1' || row.label === 'awake')).ok, false);
});
test('session-blocked zscore baseline is deterministic with a refitted balanced null', () => {
  const first = evaluate(rows());
  assert.equal(first.ok, true);
  assert.equal(first.result.independentSessions, 3);
  assert.equal(first.result.balancedAccuracy, 1);
  assert.ok(first.result.nullMean < 1);
  assert.deepEqual(first.result, evaluate(rows()).result);
});
