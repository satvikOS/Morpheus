const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/neuro-volume.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exportsObject = {};
vm.runInNewContext(source, { exports: exportsObject, Float64Array, DataView, Number, Error });
test('NIfTI handles byte order, signed intensities and scaling', () => {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setInt16(0, -123, false); view.setInt16(2, 321, false);
  assert.deepEqual(Array.from(exportsObject.readNiftiScalars(buffer, 4, false, 2, 2, 10)), [-236, 652]);
  assert.deepEqual(Array.from(exportsObject.readNiftiScalars(buffer, 4, false, 2, 0, 10)), [-123, 321]);
  assert.throws(() => exportsObject.readNiftiScalars(buffer, 16, false, 4), /truncated/);
  assert.throws(() => exportsObject.readNiftiScalars(buffer, 32, false, 1), /Unsupported/);
});
test('voxel crosshair uses the header affine including oblique axes and translation', () => {
  assert.deepEqual(Array.from(exportsObject.voxelToWorld([2, 3, 4], [[0,-2,0,10],[1,0,0,20],[0,0,3,-5],[0,0,0,1]])), [4,22,7]);
  assert.equal(exportsObject.voxelToWorld([2,3,4]), null);
});
test('qform-only NIfTI-2 resolves qform rather than the empty sform matrix', () => {
  const qform = [[2,0,0,10],[0,3,0,20],[0,0,4,30],[0,0,0,1]];
  const header = { sform_code: 0, qform_code: 1, affine: [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,1]], getQformMat: () => qform };
  assert.deepEqual(Array.from(exportsObject.voxelToWorld([1,1,1], exportsObject.spatialAffine(header))), [12,23,34]);
});
