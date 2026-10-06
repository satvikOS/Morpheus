export type VoxelPoint = [number, number, number];
export function spatialAffine(header: { sform_code: number; qform_code: number; affine: number[][]; getQformMat?: () => number[][] }): number[][] | undefined {
  if (header.sform_code > 0) return header.affine;
  if (header.qform_code > 0 && header.getQformMat) return header.getQformMat();
  return undefined;
}
export function voxelToWorld(point: VoxelPoint, affine?: number[][]): VoxelPoint | null {
  if (!affine || affine.length !== 4 || affine.some((row) => row.length !== 4 || row.some((value) => !Number.isFinite(value)))) return null;
  return affine.slice(0, 3).map((row) => row[0] * point[0] + row[1] * point[1] + row[2] * point[2] + row[3]) as VoxelPoint;
}

export function readNiftiScalars(image: ArrayBuffer, datatype: number, littleEndian: boolean, count: number, slope = 1, intercept = 0) {
  const types: Record<number, [number, (view: DataView, offset: number) => number]> = {
    2: [1, (view, offset) => view.getUint8(offset)],
    256: [1, (view, offset) => view.getInt8(offset)],
    4: [2, (view, offset) => view.getInt16(offset, littleEndian)],
    512: [2, (view, offset) => view.getUint16(offset, littleEndian)],
    8: [4, (view, offset) => view.getInt32(offset, littleEndian)],
    768: [4, (view, offset) => view.getUint32(offset, littleEndian)],
    16: [4, (view, offset) => view.getFloat32(offset, littleEndian)],
    64: [8, (view, offset) => view.getFloat64(offset, littleEndian)],
  };
  const type = types[datatype];
  if (!type) throw new Error(`Unsupported NIfTI scalar datatype ${datatype}; complex/RGB volumes require a dedicated viewer.`);
  if (!Number.isSafeInteger(count) || count < 1 || count > 16_777_216 || count * type[0] > image.byteLength) throw new Error("NIfTI payload is truncated or exceeds the 16 million scalar budget.");
  const scaled = Number.isFinite(slope) && slope !== 0;
  const multiplier = scaled ? slope : 1;
  const addition = scaled && Number.isFinite(intercept) ? intercept : 0;
  const data = new Float64Array(count);
  const view = new DataView(image);
  for (let index = 0; index < count; index++) data[index] = type[1](view, index * type[0]) * multiplier + addition;
  return data;
}
