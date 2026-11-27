import { describe, expect, it } from 'vitest';
import { CURVE_MAX_N, FORCE_TOLERANCE_N, LOW_FORCE_REFIT_MAX_N, MAX_WEIGHT_G, WEIGHT_STEPS, fitCalibration, hillShape, massToForce, type CalibrationPoint } from './calibration';
import {
  buildCsvReference, calculateAgreement, compareCsvReference, parseReferenceCSV, predictCsvReference,
  type CsvDataset, type CsvReference,
} from './csvReference';
import { fitHill } from '@/lib/hillFit';

const shape = { a: 240, b: 5, n: 0.8 };
describe('Tools Factory 导出兼容', () => {
  const header = 'Time,Pressure(N),ADC Value,ADC Sum,ADC Sum(Hex),Test Mode,Sample Index,Product Index';
  const hostRow = (n: number, values: string) => `12:00,${n},"${values}",256,0x100,consistency,1,0`;

  it('uses individual ADCs for the average and saturation, without inventing channel IDs', () => {
    const csv = [header, hostRow(0, '2;4'), hostRow(1, '1;255'), hostRow(2, '23;')].join('\n');
    const dataset = parseReferenceCSV(csv, 'consistency-test');
    expect(dataset.samples.map(({adc, saturated}) => [adc, saturated])).toEqual([[3, false], [128, true]]);
    expect(dataset.channels1Based).toBeNull();
    expect(dataset.counts.invalid).toBe(1);
  });

  it('rejects pooled samples with inconsistent vector sizes', () => {
    expect(() => parseReferenceCSV([header, hostRow(0, '0;0'), hostRow(1, '1;2;3')].join('\n'), 'host.csv')).toThrow(/不同通道数量/);
  });

  it('reads monitor exports up to channel 1024 and rejects larger channel IDs', () => {
    const monitor = '时间,压力(N),传感器#257,传感器#1024\n12:00,1,10,20';
    const dataset = parseReferenceCSV(monitor, 'monitor.csv');
    expect(dataset.channels1Based).toEqual([257, 1024]);
    expect(dataset.samples[0].adc).toBe(15);
    expect(() => parseReferenceCSV(monitor.replace('1024', '1025'), 'invalid.csv')).toThrow(/越界/);
  });
});
const adc = (force: number) => shape.a * hillShape(force, shape.b, shape.n);
function measurements(offset = 0, plan: readonly number[] = WEIGHT_STEPS): CalibrationPoint[] {
  return plan.map(massG => ({ massG, adc: offset + adc(massToForce(massG)), sd: 0.2, count: 100,
    capturedAt: '2026-11-17T00:00:00Z', durationMs: 2000, saturatedSamples: 0 }));
}
function dataset(maxN = 20, minN = 0): CsvDataset {
  const rows = Array.from({ length: 101 }, (_, i) => {
    const force = minN + (maxN - minN) * i / 100;
    return `${force},${adc(force)},${adc(force)}`;
  });
  return parseReferenceCSV(`压力(N),传感器#87,传感器#88\n${rows.join('\n')}`, 'synthetic.csv');
}
function reference(maxN = 20, minN = 0): CsvReference { return buildCsvReference([dataset(maxN, minN)]); }

describe('legacy and exported reference CSV parsing', () => {
  it('reads BOM, CRLF, quoted headers, escaped quotes and a multiline text cell', () => {
    const parsed = parseReferenceCSV('\uFEFF"时间","压力(N)","传感器#87","传感器#88"\r\n"a,""b""\nnext",0,0,2\r\n00,1.5,10,20\r\n', 'old.csv');
    expect(parsed.channels1Based).toEqual([87, 88]);
    expect(parsed.sourceKind).toBe('raw-channels');
    expect(parsed.samples.map(s => [s.forceN, s.adc])).toEqual([[0, 1], [1.5, 15]]);
    expect(parsed.counts).toEqual({ total: 2, invalid: 0, saturated: 0, ignoredModel: 0 });
  });

  it('skips missing, nonfinite, negative and out-of-range numbers without turning empties into zero', () => {
    const parsed = parseReferenceCSV('力(N),ADC_Avg\n0,0\n1,\n2,NaN\n-1,20\n3,Infinity\n4,256\n5,-1\n6,1e2\n0x10,5\n7,20,extra', 'bad-rows.csv');
    expect(parsed.samples.map(s => [s.forceN, s.adc])).toEqual([[0, 0], [6, 100]]);
    expect(parsed.counts.invalid).toBe(8);
    expect(parsed.channels1Based).toBeNull();
    expect(parsed.warnings.join(' ')).toContain('无法完全确认');
  });

  it('marks individual channel saturation even when the averaged ADC is below 255', () => {
    const parsed = parseReferenceCSV('压力(N),传感器#2,传感器#1\n0,0,0\n1,255,100', 'clip.csv');
    expect(parsed.samples[1]).toMatchObject({ adc: 177.5, saturated: true });
    expect(parsed.counts.saturated).toBe(1);
    expect(parsed.channels1Based).toEqual([1, 2]);
  });

  it('accepts Avg with known channel metadata, but never silently infers Sum channel count', () => {
    expect(parseReferenceCSV('Force(N),ADC Avg,选区通道\n0,2,88;87\n2,90,87;88', 'avg.csv').channels1Based).toEqual([87, 88]);
    expect(parseReferenceCSV('Force(N),ADC Sum,通道数\n0,2,2\n2,180,2', 'sum.csv').samples[1].adc).toBe(90);
    expect(parseReferenceCSV('Force(N),ADC_Sum,选区通道\n0,2,87;88\n2,180,87;88', 'sum.csv').samples[1].adc).toBe(90);
    expect(() => parseReferenceCSV('Force(N),ADC Sum\n0,0\n2,180', 'sum.csv')).toThrow(/通道数/);
    expect(() => parseReferenceCSV('Force(N),ADC Sum,通道数,选区通道\n2,180,3,87;88', 'sum.csv')).toThrow(/不一致/);
  });

  it('rejects mismatched regions in one file rather than using overlapping channels', () => {
    expect(() => parseReferenceCSV('力(N),ADC_Avg,选区通道\n0,0,1;2\n2,30,2;3', 'regions.csv')).toThrow(/不同选区/);
    expect(() => parseReferenceCSV('力(N),传感器#1,传感器#1\n0,0,0', 'duplicate.csv')).toThrow(/重复/);
  });

  it('rejects unitless force, duplicate synonyms and malformed quotes', () => {
    expect(() => parseReferenceCSV('压力,ADC_Avg\n1,2', 'unitless.csv')).toThrow(/单位 N/);
    expect(() => parseReferenceCSV('压力(N),力(N),ADC_Avg\n1,1,2', 'duplicate.csv')).toThrow(/多个同义列/);
    expect(() => parseReferenceCSV('压力(N),ADC_Avg\n1,"2', 'quote.csv')).toThrow(/未闭合/);
    expect(() => parseReferenceCSV('压力(N),ADC_Avg\n1,"2"x', 'quote.csv')).toThrow(/引号格式/);
  });

  it('prioritizes actual six-level rows over generated model points', () => {
    const parsed = parseReferenceCSV('类型,力(N),ADC_Avg,选区通道\n六档测点,0,0,87;88\n模型曲线,0.1,5,87;88\n六档测点,1,30,87;88', 'export.csv');
    expect(parsed.samples).toHaveLength(2);
    expect(parsed.counts.ignoredModel).toBe(1);
    expect(parsed.warnings.join(' ')).toContain('模型曲线');
    expect(() => parseReferenceCSV('类型,力(N),ADC_Avg\n模型曲线,1,30\n模型曲线,2,40', 'model.csv')).toThrow(/没有实测数据/);
  });

  it('preserves a simulation warning and does not assert missing channel metadata is verified', () => {
    const parsed = parseReferenceCSV('类型,力(N),ADC_Avg,选区通道\n六档模拟点,0,0,87;88\n六档模拟点,1,30,', 'simulation.csv');
    expect(parsed.simulated).toBe(true);
    expect(parsed.channels1Based).toBeNull();
    expect(parsed.warnings.join(' ')).toContain('模拟');
  });
});

describe('CSV reference fitting and scope', () => {
  it('recovers a synthetic zero-offset Hill curve with the retained legacy fitter', () => {
    const fit = reference();
    expect(fit.a).toBeCloseTo(shape.a, 5);
    expect(fit.b).toBeCloseTo(shape.b, 5);
    expect(fit.n).toBeCloseTo(shape.n, 5);
    expect(fit.offset).toBe(0);
    expect(fit.fitR2).toBeCloseTo(1, 12);
    expect(fit.fitRmse).toBeLessThan(1e-7);
    expect(fit.sampleCount).toBe(100);
    expect(fit.minN).toBe(0);
    expect(fit.fitMinN).toBe(0.2);
  });

  it('takes each file through its last maximum including repeated peak samples before merging', () => {
    const raw = parseReferenceCSV('力(N),ADC_Avg\n0,0\n1,20\n2,40\n3,60\n3,62\n2,35\n0,0', 'hysteresis.csv');
    const fit = buildCsvReference([raw, { ...raw, fileName: 'second.csv' }]);
    expect(fit.files.map(f => f.loadingRows)).toEqual([5, 5]);
    expect(fit.files.map(f => f.usedRows)).toEqual([4, 4]);
    expect(fit.sampleCount).toBe(8);
    expect(fit.samples.filter(s => s.adc === 35)).toHaveLength(0);
  });

  it('fits zero-offset positive loads, preserving the historical formula rather than removing CSV baseline', () => {
    const raw = dataset();
    raw.samples[0].adc = 20;
    const fit = buildCsvReference([raw]);
    expect(fit.a).toBeCloseTo(shape.a, 5);
    expect(predictCsvReference(fit, 0)).toBe(0);
  });

  it('retains saturated rows by default but never extends coverage to those observations', () => {
    const raw = dataset();
    raw.samples[100].saturated = true;
    raw.samples[100].adc = 220;
    const kept = buildCsvReference([raw]);
    expect(kept.sampleCount).toBe(100);
    expect(kept.fitMaxN).toBe(20);
    expect(kept.maxN).toBe(19.8);
    expect(kept.warnings.join(' ')).toContain('包含 1 帧');
    const excluded = buildCsvReference([raw], 'legacy-loading', true);
    expect(excluded.sampleCount).toBe(99);
    expect(excluded.fitMaxN).toBe(19.8);
    expect(excluded.maxN).toBe(19.8);
    expect(predictCsvReference(kept, 20)).toBeNull();
  });

  it('offers a separate force-range refit and rejects incompatible channel sets', () => {
    const raw = dataset(100);
    expect(LOW_FORCE_REFIT_MAX_N).toBe(20);
    expect(buildCsvReference([raw]).fitMaxN).toBe(100);
    expect(buildCsvReference([raw], 'loading-low').fitMaxN).toBe(LOW_FORCE_REFIT_MAX_N);
    expect(() => buildCsvReference([raw, { ...raw, channels1Based: [1, 2] }])).toThrow(/通道集合不同/);
    expect(() => buildCsvReference(Array(11).fill(raw))).toThrow(/1–10/);
  });

  it('requires three distinct positive loads and valid unsaturated coverage', () => {
    expect(() => buildCsvReference([parseReferenceCSV('力(N),ADC_Avg\n0,0\n1,20\n1,21\n2,40', 'few.csv')])).toThrow(/3 个不同/);
    expect(() => buildCsvReference([parseReferenceCSV('力(N),ADC_Avg\n0,0\n1,0\n2,0\n3,0', 'zero.csv')])).toThrow(/全为 0/);
    expect(() => buildCsvReference([{ ...dataset(), samples: dataset().samples.map(s => ({ ...s, saturated: true })) }])).toThrow(/未饱和测点不足/);
  });

  it('uses the old fitter unchanged, including its >500-point downsampling', () => {
    const raw = dataset(40);
    raw.samples = Array.from({ length: 1101 }, (_, i) => ({ forceN: i / 25, adc: adc(i / 25) + (i % 7) * 0.05, rowIndex: i + 2, saturated: false }));
    const fit = buildCsvReference([raw]);
    const direct = fitHill(raw.samples.slice(1).map(s => s.forceN), raw.samples.slice(1).map(s => s.adc))!;
    expect([fit.a, fit.b, fit.n]).toEqual([direct.a, direct.b, direct.n]);
  });
});

describe('agreement definitions and comparison coverage', () => {
  const fullPlan80 = [0, 500, 1500, 3500, 6000, MAX_WEIGHT_G];

  it('compares a full 80 N plan against 80 N CSV coverage without extrapolating', () => {
    const points = measurements(0, fullPlan80);
    const result = fitCalibration(points, undefined, 'measured', fullPlan80);
    const ref = reference(CURVE_MAX_N);
    const comparison = compareCsvReference(ref, points, result, [87, 88], fullPlan80);
    expect(comparison.pointComplete).toBe(true);
    expect(comparison.pointMetrics).toMatchObject({ count: 6, total: 6 });
    expect(comparison.pointMetrics!.r2).toBeCloseTo(1, 10);
    expect(comparison.rows[5].forceN).toBeCloseTo(CURVE_MAX_N, 8);
    expect(comparison.rows[5].referenceADC).not.toBeNull();
    expect(comparison.curveMetrics).toMatchObject({ count: 201, total: 201 });
    expect(comparison.curveMetrics!.r2).toBeCloseTo(1, 10);
    expect(comparison.curveRange).toEqual([0, CURVE_MAX_N]);
  });

  it('does not extrapolate a low-coverage CSV just because the plan reaches 80 N', () => {
    const points = measurements(0, fullPlan80);
    const result = fitCalibration(points, undefined, 'measured', fullPlan80);
    const ref = reference(20);
    const comparison = compareCsvReference(ref, points, result, [87, 88], fullPlan80);
    expect(comparison.pointPartial).toBe(true);
    expect(comparison.pointMetrics).toMatchObject({ count: 3, total: 6 });
    expect(comparison.rows[5].referenceADC).toBeNull();
    expect(comparison.pointMetrics!.reason).toBeUndefined();
    expect(comparison.curveRange).toEqual([0, 20]);
    expect(predictCsvReference(ref, 20 + 2 * FORCE_TOLERANCE_N)).toBeNull();
  });

  it('trims the curve comparison before ADC 255 with an 80 N plan', () => {
    const points = measurements(0, fullPlan80);
    const result = fitCalibration(points, undefined, 'measured', fullPlan80);
    const ref = { ...reference(CURVE_MAX_N), a: 600 };
    const comparison = compareCsvReference(ref, points, result, [87, 88], fullPlan80);
    expect(comparison.curveRange![1]).toBeLessThan(CURVE_MAX_N);
    expect(comparison.curveRange![1]).toBeGreaterThan(0);
    expect(comparison.curveMetrics!.count).toBe(201);
    expect(comparison.warnings.join(' ')).toContain('ADC 255');
    expect(predictCsvReference(ref, CURVE_MAX_N)).toBeNull();
  });

  it('retains the sixth point at the six-decimal 20 N mass using the shared force tolerance', () => {
    const plan = [0, 50, 200, 550, 850, 2039.432426];
    const points = measurements(0, plan);
    const result = fitCalibration(points, undefined, 'measured', plan);
    const ref = reference(20);
    const lastForce = massToForce(plan[5]);
    expect(lastForce).toBeGreaterThan(20);
    expect(lastForce - 20).toBeLessThan(FORCE_TOLERANCE_N);
    expect(predictCsvReference(ref, lastForce)).not.toBeNull();
    expect(predictCsvReference(ref, 20 + 2 * FORCE_TOLERANCE_N)).toBeNull();
    const comparison = compareCsvReference(ref, points, result, [87, 88], plan);
    expect(comparison.pointComplete).toBe(true);
    expect(comparison.pointPartial).toBe(false);
    expect(comparison.pointMetrics).toMatchObject({ count: 6, total: 6 });
    expect(comparison.pointMetrics!.r2).toBeCloseTo(1, 12);
    expect(comparison.rows[5].referenceADC).not.toBeNull();
    expect(comparison.curveRange).toEqual([0, 20]);
  });

  it('uses custom decimal weight levels for both six-point and curve agreement', () => {
    const plan = [0, 37.5, 175.25, 487.5, 910.75, 1450.5];
    const points = measurements(0, plan);
    const result = fitCalibration(points, undefined, 'measured', plan);
    const comparison = compareCsvReference(reference(), points, result, [87, 88], plan);
    expect(comparison.pointComplete).toBe(true);
    expect(comparison.pointMetrics).toMatchObject({ count: 6, total: 6 });
    expect(comparison.pointMetrics!.r2).toBeCloseTo(1, 12);
    expect(comparison.curveMetrics!.r2).toBeCloseTo(1, 12);
    expect(comparison.curveRange).toEqual([0, massToForce(1450.5)]);
    const partial = compareCsvReference(reference(10), points, result, [87, 88], plan);
    expect(partial.pointPartial).toBe(true);
    expect(partial.pointMetrics).toMatchObject({ count: 5, total: 6 });
    expect(partial.rows[5].massG).toBe(1450.5);
    expect(partial.rows[5].referenceADC).toBeNull();
    expect(partial.curveRange).toEqual([0, 10]);
  });

  it('rejects an invalid comparison plan and identifies incomplete, duplicate or old-plan captures', () => {
    const plan = [0, 37.5, 175.25, 487.5, 910.75, 1450.5];
    const points = measurements(0, plan);
    const ref = reference();
    expect(() => compareCsvReference(ref, points, null, [87, 88], [0, 50])).toThrow(/6 档/);
    for (const captures of [points.slice(0, 5), [...points.slice(0, 5), points[4]], measurements()]) {
      const comparison = compareCsvReference(ref, captures, null, [87, 88], plan);
      expect(comparison.pointComplete).toBe(false);
      expect(comparison.pointMetrics).toBeNull();
      expect(comparison.curveMetrics).toBeNull();
      expect(comparison.warnings.join(' ')).toContain('0、37.5、175.25、487.5、910.75、1450.5');
    }
  });

  it('blocks a stale fitted curve from a different plan while retaining valid current point agreement', () => {
    const plan = [0, 37.5, 175.25, 487.5, 910.75, 1450.5];
    const points = measurements(0, plan);
    const oldResult = fitCalibration(measurements());
    const comparison = compareCsvReference(reference(), points, oldResult, [87, 88], plan);
    expect(comparison.pointComplete).toBe(true);
    expect(comparison.pointMetrics!.r2).toBeCloseTo(1, 12);
    expect(comparison.curveMetrics).toBeNull();
    expect(comparison.curveRange).toBeNull();
    expect(comparison.warnings.join(' ')).toContain('重量档位与当前计划不一致');
    const current = fitCalibration(points, undefined, 'measured', plan);
    const reorderedMetadata = { ...current, massLevelsG: [...plan].reverse() };
    expect(compareCsvReference(reference(), points, reorderedMetadata, [87, 88], plan).curveMetrics).toBeNull();
  });

  it('uses 1-SSE/SST in the stated observed direction and retains negative R²', () => {
    expect(calculateAgreement([1, 2, 3], [1, 2, 3])).toMatchObject({ r2: 1, rmse: 0, count: 3 });
    expect(calculateAgreement([1, 2, 3], [2, 3, 4]).r2).toBeCloseTo(-0.5);
    expect(calculateAgreement([1, 2, 3], [2, 4, 6]).r2).toBe(-6);
    expect(calculateAgreement([2, 4, 6], [1, 2, 3]).r2).toBe(-0.75);
    expect(calculateAgreement([2, 2, 2], [2, 2, 2]).r2).toBeNull();
    expect(calculateAgreement([1], [2]).r2).toBeNull();
    expect(calculateAgreement([], []).rmse).toBeNull();
    expect(calculateAgreement([NaN, 1], [2, 3]).r2).toBeNull();
    expect(() => calculateAgreement([1], [])).toThrow(/长度/);
  });

  it('computes all six measured ADC versus CSV predictions and a separate 201-point curve agreement', () => {
    const points = measurements();
    const result = fitCalibration(points);
    const comparison = compareCsvReference(reference(), points, result, [88, 87]);
    expect(comparison.pointComplete).toBe(true);
    expect(comparison.pointMetrics).toMatchObject({ count: 6, total: 6 });
    expect(comparison.pointMetrics!.r2).toBeCloseTo(1, 12);
    expect(comparison.curveMetrics).toMatchObject({ count: 201, total: 201 });
    expect(comparison.curveMetrics!.r2).toBeCloseTo(1, 12);
    expect(comparison.curveRange).toEqual([0, massToForce(1050)]);
  });

  it('does not automatically remove a measured offset or substitute training-fit R²', () => {
    const points = measurements(15);
    const result = fitCalibration(points);
    const comparison = compareCsvReference(reference(), points, result, [87, 88]);
    expect(result.r2).toBeCloseTo(1, 12);
    expect(comparison.pointMetrics!.r2).toBeLessThan(0.95);
    expect(comparison.pointMetrics!.rmse).toBeCloseTo(15, 6);
    expect(comparison.rows[0].errorADC).toBe(15);
  });

  it('does not calculate main metrics before all six distinct weight levels are captured', () => {
    const points = measurements();
    const five = compareCsvReference(reference(), points.slice(0, 5), fitCalibration(points), [87, 88]);
    expect(five.pointMetrics).toBeNull();
    expect(five.curveMetrics).toBeNull();
    expect(five.pointComplete).toBe(false);
    const duplicates = compareCsvReference(reference(), [...points.slice(0, 5), points[4]], null, [87, 88]);
    expect(duplicates.pointComplete).toBe(false);
  });

  it('reports partial six-point coverage without extrapolating the CSV reference', () => {
    const points = measurements();
    const comparison = compareCsvReference(reference(8), points, fitCalibration(points), [87, 88]);
    expect(comparison.pointMetrics).toMatchObject({ count: 4, total: 6 });
    expect(comparison.pointPartial).toBe(true);
    expect(comparison.rows[4].referenceADC).toBeNull();
    expect(comparison.curveRange).toEqual([0, 8]);
    expect(comparison.warnings.join(' ')).toContain('4/6');
    const noZero = compareCsvReference(reference(20, 0.1), points, fitCalibration(points), [87, 88]);
    expect(noZero.rows[0].referenceADC).toBeNull();
    expect(noZero.pointMetrics!.count).toBe(5);
  });

  it('blocks channel mismatch, warns unknown channels, and is invariant to point ordering', () => {
    const points = measurements();
    const result = fitCalibration(points);
    const ref = reference();
    const mismatch = compareCsvReference(ref, points, result, [88, 89]);
    expect(mismatch.blockedReason).toContain('选区不同');
    expect(mismatch.pointMetrics).toBeNull();
    expect(mismatch.curveMetrics).toBeNull();
    const unknown = compareCsvReference({ ...ref, channels1Based: null }, points, result, [88, 89]);
    expect(unknown.pointMetrics!.count).toBe(6);
    expect(unknown.warnings.join(' ')).toContain('无法自动核验');
    expect(compareCsvReference(ref, points, result, [87, 88])).toEqual(compareCsvReference(ref, [...points].reverse(), result, [88, 87]));
  });

  it('excludes saturated current points and clips the curve interval before prediction saturation', () => {
    const points = measurements();
    const result = fitCalibration(points);
    points[5].saturatedSamples = 1;
    const comparison = compareCsvReference(reference(), points, result, [87, 88]);
    expect(comparison.pointMetrics!.count).toBe(5);
    expect(comparison.rows[5].referenceADC).toBeNull();
    expect(comparison.curveRange![1]).toBe(massToForce(850));
    const ref = { ...reference(), a: 600 };
    const clipped = compareCsvReference(ref, measurements(), result, [87, 88]);
    expect(clipped.curveRange![1]).toBeLessThan(massToForce(1050));
    expect(clipped.curveMetrics!.count).toBe(201);
    expect(clipped.warnings.join(' ')).toContain('ADC 255');
    expect(predictCsvReference(ref, 20)).toBeNull();
  });
});
