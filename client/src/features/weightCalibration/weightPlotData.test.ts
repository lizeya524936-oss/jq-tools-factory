import { describe, expect, it } from 'vitest';
import { parseReferenceCSV, buildCsvReference } from './csvReference';
import { CURVE_MAX_N, fitCalibration, hillShape, massToForce, REFERENCE_HILL, WEIGHT_STEPS } from './calibration';
import { calibrationSeries, referenceCurve, sortedLoadingSeries, visibleLoadingPoints } from './weightPlotData';

const source = (name: string, rows: string[]) => parseReferenceCSV(['压力(N),传感器#1,传感器#2', ...rows].join('\n'), name);

describe('砝码曲线的显示数据', () => {
  it('keeps valid per-file samples available when the CSV has too few loads for a fit', () => {
    const dataset = source('short.csv', ['0,0,0','2,10,14']);
    expect(() => buildCsvReference([dataset])).toThrow(/不同的正力值/);
    const [loading] = sortedLoadingSeries([dataset], 'legacy-loading', false);
    expect(visibleLoadingPoints(loading, 20).display.map(p => p.adc)).toEqual([0, 12]);
  });

  it('keeps identical file names separate and sorts only the chosen loading segment', () => {
    const a = source('same.csv', ['0,0,2','5,25,35','2,10,20','10,40,50','1,7,9']);
    const b = source('same.csv', ['0,1,1','2,255,9','4,15,16','5,20,22','22,30,32']);
    const sections = sortedLoadingSeries([a, b], 'loading-low', true);
    expect(sections[0].map(p => p.forceN)).toEqual([0, 2, 5, 10]);
    expect(sections[1].map(p => p.forceN)).toEqual([0, 4, 5, 22]);
    expect(a.samples.map(p => p.forceN)).toEqual([0, 5, 2, 10, 1]);
    expect(sortedLoadingSeries([b], 'legacy-loading', false)[0].find(p => p.forceN === 2)?.saturated).toBe(true);
  });

  it('limits each visible file to 200 dots after the force-range filter, keeping both endpoints', () => {
    const samples = Array.from({length: 601}, (_, i) => ({ forceN: i / 10, adc: i / 5, rowIndex: i + 2, saturated: false }));
    const {display, count} = visibleLoadingPoints(samples, 25.3);
    expect(count).toBe(254);
    expect(display).toHaveLength(200);
    expect([display[0], display.at(-1)]).toEqual([samples[0], samples[253]]);
    expect(visibleLoadingPoints(samples, 0.5).display).toEqual(samples.slice(0, 6));
  });

  it('limits the orange reference line to unsaturated observations while retaining zero and measured endpoints', () => {
    const ref = buildCsvReference([source('A.csv', ['0,0,2','2,30,40','4,63,66','6,70,72','9,255,90'])]);
    const line = referenceCurve(ref, 20);
    expect(line[0].forceN).toBe(0);
    expect(line.at(-1)?.forceN).toBe(6);
    expect(referenceCurve(ref, 5).at(-1)?.forceN).toBe(5);
  });

  it('shares the last measured force between the fitted and extrapolated overlays', () => {
    const points = WEIGHT_STEPS.map(massG => ({ massG, adc: 3 + 150 * hillShape(massToForce(massG), 3, 0.9), sd: 0.2, count: 30,
      capturedAt: new Date(0).toISOString(), durationMs: 1800, saturatedSamples: 0 }));
    const result = fitCalibration(points, REFERENCE_HILL, 'measured', [...WEIGHT_STEPS]);
    const full = calibrationSeries(points, result, 20);
    expect(full.fitted.at(-1)?.forceN).toBe(result.measuredMaxN);
    expect(full.extrapolated[0]).toEqual(full.fitted.at(-1));
    expect(full.extrapolated.at(-1)?.forceN).toBe(20);
    expect(calibrationSeries(points, result, 5).extrapolated).toEqual([]);
    expect(calibrationSeries(points, null, 20).measured).toHaveLength(6);
  });

  it('covers the full 80 N display domain while keeping CSV prediction inside its own coverage', () => {
    const csv = source('full.csv', ['0,0,2', '20,30,40', '40,63,66', '80,110,120']);
    const ref = buildCsvReference([csv]);
    const line = referenceCurve(ref, CURVE_MAX_N);
    expect(line[0].forceN).toBe(0);
    expect(line.at(-1)?.forceN).toBe(CURVE_MAX_N);
    expect(referenceCurve(ref, CURVE_MAX_N + 20).at(-1)?.forceN).toBe(CURVE_MAX_N);
    const points = WEIGHT_STEPS.map(massG => ({ massG, adc: 3 + 150 * hillShape(massToForce(massG), 3, 0.9), sd: 0.2, count: 30,
      capturedAt: new Date(0).toISOString(), durationMs: 1800, saturatedSamples: 0 }));
    const result = fitCalibration(points, REFERENCE_HILL, 'measured', [...WEIGHT_STEPS]);
    expect(calibrationSeries(points, result, CURVE_MAX_N).extrapolated.at(-1)?.forceN).toBe(CURVE_MAX_N);
  });
});
