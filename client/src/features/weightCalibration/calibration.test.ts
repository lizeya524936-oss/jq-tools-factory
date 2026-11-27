import { describe, expect, it } from 'vitest';
import {
  ADC_LIMIT,
  CHART_RANGE_PRESETS,
  CURVE_MAX_N,
  FORCE_TOLERANCE_N,
  GRAVITY,
  MAX_WEIGHT_G,
  REFERENCE_HILL,
  WEIGHT_STEPS,
  buildCurve,
  fitCalibration,
  hillShape,
  inverseADC,
  massToForce,
  median,
  predictADC,
  rangeDescription,
  summarizeSamples,
  validateWeightPlan,
  weightLabel,
  type CalibrationPoint,
} from './calibration';

function measurements(a = 300, offset = 7, b = REFERENCE_HILL.b as number, n = REFERENCE_HILL.n as number, plan: readonly number[] = WEIGHT_STEPS): CalibrationPoint[] {
  return plan.map(massG => ({
    massG,
    adc: offset + a * hillShape(massToForce(massG), b, n),
    sd: 0.2,
    count: 100,
    capturedAt: '2026-11-17T01:00:00.000Z',
    durationMs: 2000,
    saturatedSamples: 0,
  }));
}

describe('physical units and sample statistics', () => {
  it('converts grams to force without treating grams as newtons', () => {
    expect(massToForce(50)).toBeCloseTo(0.4903325, 10);
    expect(massToForce(200)).toBeCloseTo(1.96133, 10);
    expect(massToForce(550)).toBeCloseTo(5.3936575, 10);
    expect(massToForce(850)).toBeCloseTo(8.3356525, 10);
    expect(massToForce(1050)).toBeCloseTo(10.2969825, 10);
    expect(WEIGHT_STEPS).toEqual([0, 50, 200, 550, 850, 1050]);
    expect(weightLabel(WEIGHT_STEPS[5])).toBe('1050 g');
    expect(weightLabel(1050)).toBe('1050 g');
    expect(CURVE_MAX_N).toBe(80);
    expect(MAX_WEIGHT_G).toBeCloseTo(8157.729704, 5);
    expect(CHART_RANGE_PRESETS).toEqual([20, 40, 80]);
    expect(rangeDescription(CURVE_MAX_N)).toBe('0–80.000 N 为标定范围，范围内精度仍需独立载荷验证。');
    expect(rangeDescription(10)).toContain('10.000–80 N 为外推');
    expect(() => massToForce(-1)).toThrow();
    expect(() => massToForce(NaN)).toThrow();
  });

  it('uses a median representative value and sample SD without mutating input', () => {
    const values = [4, 1, 3, 2];
    expect(summarizeSamples(values)).toEqual({ median: 2.5, mean: 2.5, sd: Math.sqrt(5 / 3), min: 1, max: 4, count: 4 });
    expect(values).toEqual([4, 1, 3, 2]);
    expect(median([1, 100, 2])).toBe(2);
    expect(summarizeSamples([4]).sd).toBe(0);
    expect(() => summarizeSamples([])).toThrow();
    expect(() => median([1, NaN])).toThrow();
  });

  it('has zero response at zero force and a half response at b', () => {
    expect(hillShape(0, 23.4839, 0.4774)).toBe(0);
    expect(hillShape(23.4839, 23.4839, 0.4774)).toBeCloseTo(0.5, 14);
    expect(hillShape(1e100, 0.01, 100)).toBe(1);
    expect(() => hillShape(1, 0, 1)).toThrow();
  });
});

describe('editable six-level weight plans', () => {
  const plan = [0, 37.5, 175.25, 487.5, 910.75, 1450.5];

  it('accepts decimal grams and returns a separate validated array', () => {
    const validated = validateWeightPlan(Object.freeze([...plan]));
    expect(validated).toEqual(plan);
    expect(validated).not.toBe(plan);
    expect(validateWeightPlan(WEIGHT_STEPS)).toEqual(WEIGHT_STEPS);
    expect(MAX_WEIGHT_G).toBe(CURVE_MAX_N / GRAVITY * 1000);
  });

  it.each([
    [], [0, 50, 200, 550, 850], [0, 50, 200, 550, 850, 1050, 1200],
    [1, 50, 200, 550, 850, 1050], [0, 0, 200, 550, 850, 1050],
    [0, -1, 200, 550, 850, 1050], [0, 50, 50, 550, 850, 1050],
    [0, 200, 50, 550, 850, 1050], [0, 50, NaN, 550, 850, 1050],
    [0, 50, 200, 550, 850, Infinity], [NaN, 50, 200, 550, 850, 1050],
  ])('rejects an invalid plan %j', (...invalid) => {
    expect(() => validateWeightPlan(invalid)).toThrow();
  });

  it('permits exactly 80 N and only the documented floating-point tolerance above it', () => {
    const boundary = [0, 50, 200, 550, 850, MAX_WEIGHT_G];
    expect(validateWeightPlan(boundary)).toEqual(boundary);
    expect(() => validateWeightPlan([...boundary.slice(0, 5), MAX_WEIGHT_G + 0.5 * FORCE_TOLERANCE_N / GRAVITY * 1000])).not.toThrow();
    expect(() => validateWeightPlan([...boundary.slice(0, 5), MAX_WEIGHT_G + 2 * FORCE_TOLERANCE_N / GRAVITY * 1000])).toThrow(/80 N/);
    const decimalBoundary = [...boundary.slice(0, 5), 8157.7297039];
    expect(massToForce(decimalBoundary[5])).toBeGreaterThan(CURVE_MAX_N);
    expect(massToForce(decimalBoundary[5]) - CURVE_MAX_N).toBeLessThan(FORCE_TOLERANCE_N);
    expect(validateWeightPlan(decimalBoundary)).toEqual(decimalBoundary);
  });

  it('fits custom decimal loads and records the applied plan without changing input or the solver', () => {
    const points = measurements(300, 7, REFERENCE_HILL.b, REFERENCE_HILL.n, plan).reverse();
    const before = JSON.stringify(points);
    const result = fitCalibration(points, REFERENCE_HILL, 'measured', plan);
    expect(result.massLevelsG).toEqual(plan);
    expect(result.massLevelsG).not.toBe(plan);
    expect(result.measuredMaxN).toBe(massToForce(plan[5]));
    expect(result.a).toBeCloseTo(300, 5);
    expect(result.b).toBeCloseTo(REFERENCE_HILL.b, 5);
    expect(result.n).toBeCloseTo(REFERENCE_HILL.n, 7);
    expect(result.rmse).toBeLessThan(1e-7);
    expect(JSON.stringify(points)).toBe(before);
    expect(fitCalibration(points, REFERENCE_HILL, 'reference', plan).massLevelsG).toEqual(plan);
  });

  it('fits, predicts and inverts a six-level plan that reaches the full 80 N limit', () => {
    const fullPlan = [0, 500, 1500, 3500, 6000, MAX_WEIGHT_G];
    const points = measurements(220, 5, 12, 1.1, fullPlan);
    const result = fitCalibration(points, REFERENCE_HILL, 'measured', fullPlan);
    expect(result.measuredMaxN).toBeCloseTo(CURVE_MAX_N, 8);
    expect(result.warnings.some(warning => warning.includes('外推'))).toBe(false);
    expect(result.r2).toBeCloseTo(1, 8);
    expect(result.rmse).toBeLessThan(1e-6);
    expect(predictADC(result, CURVE_MAX_N)).toBeCloseTo(points[5].adc, 6);
    expect(inverseADC(result, points[5].adc)).toBeCloseTo(CURVE_MAX_N, 6);
    expect(inverseADC(result, predictADC(result, 40))).toBeCloseTo(40, 6);
    const curve = buildCurve(result);
    expect(curve.at(-1)?.forceN).toBe(CURVE_MAX_N);
    expect(curve.filter(point => point.forceN <= CURVE_MAX_N).every(point => point.range === 'measured-range')).toBe(true);
    expect(() => fitCalibration(points.map(point => ({ ...point })), REFERENCE_HILL, 'measured', [...fullPlan.slice(0, 5), MAX_WEIGHT_G + 2 * FORCE_TOLERANCE_N / GRAVITY * 1000])).toThrow(/80 N/);
  });

  it('requires captured points to match the applied custom plan exactly', () => {
    const points = measurements(300, 7, REFERENCE_HILL.b, REFERENCE_HILL.n, plan);
    expect(() => fitCalibration(points.slice(0, 5), REFERENCE_HILL, 'measured', plan)).toThrow(/37.5 g/);
    expect(() => fitCalibration([...points.slice(0, 5), points[4]], REFERENCE_HILL, 'measured', plan)).toThrow(/缺失或重复/);
    expect(() => fitCalibration(measurements(), REFERENCE_HILL, 'measured', plan)).toThrow(/缺失或重复/);
    expect(() => fitCalibration(points)).toThrow(/缺失或重复/);
    expect(() => fitCalibration(points, REFERENCE_HILL, 'measured', [0, 50])).toThrow(/6 档/);
    const saturated = points.map(point => ({ ...point }));
    saturated[5].saturatedSamples = 1;
    expect(() => fitCalibration(saturated, REFERENCE_HILL, 'measured', plan)).toThrow(/1450.5 g/);
  });
});

describe('six-level constrained Hill calibration', () => {
  it('recovers known shape and measured offset with the default measured-data mode', () => {
    const result = fitCalibration(measurements());
    expect(result.a).toBeCloseTo(300, 5);
    expect(result.offset).toBe(7);
    expect(result.b).toBeCloseTo(REFERENCE_HILL.b, 5);
    expect(result.n).toBeCloseTo(REFERENCE_HILL.n, 7);
    expect(result.gain).toBeCloseTo(300 / REFERENCE_HILL.a, 7);
    expect(result.rmse).toBeCloseTo(0, 7);
    expect(result.r2).toBeCloseTo(1, 10);
    expect(predictADC(result, 0)).toBe(7);
    expect(result.measuredMaxN).toBeCloseTo(10.2969825, 10);
    expect(result.mode).toBe('measured');
    expect(result.source).toBe('6-level-measured-data');
    expect(result.massLevelsG).toEqual([0, 50, 200, 550, 850, 1050]);
    expect(result.warnings.some(warning => warning.includes('10.2969825–80 N') && warning.includes('外推'))).toBe(true);
    expect(result.diagnostics.converged).toBe(true);
    expect(result.diagnostics.starts).toBeGreaterThan(10);
    expect(result.diagnostics.parameterBounds).not.toBeNull();
  });

  it.each([
    { a: 220, b: 5, n: 1.3 },
    { a: 250, b: 15, n: 2.2 },
    { a: 380, b: 75, n: 0.32 },
    { a: 120, b: 1.5, n: 0.8 },
  ])('recovers a different full Hill shape $a / $b / $n', ({ a, b, n }) => {
    const result = fitCalibration(measurements(a, 3, b, n));
    expect(result.a).toBeCloseTo(a, 4);
    expect(result.b).toBeCloseTo(b, 4);
    expect(result.n).toBeCloseTo(n, 6);
    for (const force of [0.1, 0.5, 3, 12, 20, 40, CURVE_MAX_N]) {
      expect(predictADC(result, force)).toBeCloseTo(3 + a * hillShape(force, b, n), 5);
    }
  });

  it('retains an explicit historical-shape mode without silently using it for measured fitting', () => {
    const reference = fitCalibration(measurements(), REFERENCE_HILL, 'reference');
    expect(reference.a).toBeCloseTo(300, 10);
    expect(reference.b).toBe(REFERENCE_HILL.b);
    expect(reference.n).toBe(REFERENCE_HILL.n);
    expect(reference.mode).toBe('reference');
    expect(reference.source).toBe('historical-hill-shape');
    expect(reference.diagnostics.parameterBounds).toBeNull();
    const changed = measurements(220, 3, 5, 1.3);
    const measured = fitCalibration(changed);
    const forcedReference = fitCalibration(changed, REFERENCE_HILL, 'reference');
    expect(measured.rmse).toBeLessThan(1e-6);
    expect(forcedReference.rmse).toBeGreaterThan(5);
    expect(forcedReference.warnings.some(warning => warning.includes('残差'))).toBe(true);
  });

  it('remains close to the known response curve with deterministic ADC noise', () => {
    const points = measurements(220, 4, 5, 1.3);
    [0, 0.3, -0.4, 0.6, -0.2, 0.25].forEach((noise, i) => { points[i].adc += noise; });
    const result = fitCalibration(points);
    expect(result.rmse).toBeGreaterThan(0);
    expect(result.rmse).toBeLessThan(0.6);
    for (const force of [0.5, 2, 5, 10, 15, 20, 40, CURVE_MAX_N]) {
      expect(Math.abs(predictADC(result, force) - (4 + 220 * hillShape(force, 5, 1.3)))).toBeLessThan(1);
    }
  });

  it('reports constraints or lack of identifiability for near-linear data', () => {
    const points = measurements().map(point => ({ ...point, adc: 3 + 5 * massToForce(point.massG) }));
    const result = fitCalibration(points);
    expect(result.mode).toBe('measured');
    expect(result.diagnostics.atBounds.length > 0 || result.diagnostics.conditionNumber === null || result.diagnostics.conditionNumber > 1e4).toBe(true);
    expect(result.warnings.some(warning => /边界|辨识/.test(warning))).toBe(true);
    expect(result.warnings.some(warning => warning.includes('渐近参数'))).toBe(true);
  });

  it('warns when all positive levels have the same response', () => {
    const points = measurements().map(point => ({ ...point, adc: point.massG === 0 ? 0 : 100 }));
    const result = fitCalibration(points);
    expect(result.r2).toBeNull();
    expect(result.warnings.some(warning => /边界|辨识/.test(warning))).toBe(true);
    expect(result.warnings.some(warning => warning.includes('未呈明确上升'))).toBe(true);
  });

  it('flags a fitted parameter at an explicit constraint boundary', () => {
    const result = fitCalibration(measurements(200, 2, 5, 5));
    expect(result.n).toBeCloseTo(5, 5);
    expect(result.diagnostics.atBounds).toContain('n');
    expect(result.warnings.some(warning => warning.includes('约束边界'))).toBe(true);
  });

  it('uses the actual highest load label in errors', () => {
    const points = measurements();
    points[points.length - 1].saturatedSamples = 1;
    expect(() => fitCalibration(points)).toThrow(/1050 g/);
  });

  it('accepts unordered complete points without mutating them', () => {
    const points = measurements().reverse();
    const before = JSON.stringify(points);
    expect(fitCalibration(points).a).toBeCloseTo(300, 5);
    expect(JSON.stringify(points)).toBe(before);
  });

  it('fits five positive level representatives with equal weights, independent of frame counts', () => {
    const points = measurements();
    points[1].adc += 1;
    const ordinary = fitCalibration(points);
    points[1].count = 10000;
    points[2].count = 20;
    expect(fitCalibration(points).a).toBe(ordinary.a);
    expect(fitCalibration(points).rmse).toBe(ordinary.rmse);
  });

  it('calculates fit statistics on positive levels only', () => {
    const points = measurements();
    points[1].adc += 2;
    const result = fitCalibration(points);
    const positive = result.residuals.slice(1);
    const expected = Math.sqrt(positive.reduce((sum, p) => sum + p.errorADC ** 2, 0) / 5);
    expect(result.rmse).toBeCloseTo(expected, 12);
    expect(result.residuals[0].errorADC).toBe(0);
  });

  it('rejects incomplete, duplicate, or unexpected levels', () => {
    expect(() => fitCalibration(measurements().slice(0, 5))).toThrow();
    const duplicate = measurements();
    duplicate[2].massG = 50;
    expect(() => fitCalibration(duplicate)).toThrow();
    const invalid = measurements();
    invalid[3].massG = 400;
    expect(() => fitCalibration(invalid)).toThrow();
  });

  it('rejects stale or invalid statistics and non-finite values', () => {
    for (const [key, value] of [
      ['adc', NaN], ['sd', -1], ['count', 0], ['count', 1.2], ['durationMs', 0], ['saturatedSamples', -1],
    ] as const) {
      const points = measurements();
      points[1][key] = value;
      expect(() => fitCalibration(points)).toThrow();
    }
    const points = measurements();
    points[1].capturedAt = 'not a timestamp';
    expect(() => fitCalibration(points)).toThrow();
    expect(() => fitCalibration(measurements(), { a: 1, b: NaN, n: 1 })).toThrow();
  });

  it('rejects no-signal, reversed response, and ADC saturation in any selected channel', () => {
    const noSignal = measurements().map(point => ({ ...point, adc: 0 }));
    expect(() => fitCalibration(noSignal)).toThrow();
    const reversed = measurements();
    reversed[2].adc = reversed[1].adc - 10;
    expect(() => fitCalibration(reversed)).toThrow();
    const saturated = measurements();
    saturated[3].saturatedSamples = 1;
    expect(() => fitCalibration(saturated)).toThrow(/255/);
    const impossible = measurements();
    impossible[2].adc = 256;
    expect(() => fitCalibration(impossible)).toThrow();
  });
});

describe('curve range and inversion', () => {
  it('retains the measured boundary exactly and labels extrapolation', () => {
    const result = fitCalibration(measurements());
    const targetCurve = buildCurve(result);
    expect(targetCurve.at(-1)?.forceN).toBe(CURVE_MAX_N);
    expect(targetCurve.some(point => point.range === 'extrapolated')).toBe(true);
    const curve = buildCurve(result, CURVE_MAX_N);
    expect(curve[0].forceN).toBe(0);
    expect(curve.at(-1)?.forceN).toBe(CURVE_MAX_N);
    expect(curve.some(point => point.forceN === CURVE_MAX_N)).toBe(true);
    const edge = curve.find(point => point.forceN === massToForce(1050));
    expect(edge?.range).toBe('measured-range');
    expect(curve.filter(point => point.forceN > result.measuredMaxN).every(point => point.range === 'extrapolated')).toBe(true);
    expect(() => buildCurve(result, CURVE_MAX_N + 1)).toThrow(/80 N/);
  });

  it('returns zero below baseline and rejects invalid or outside-80-N inversions', () => {
    const result = fitCalibration(measurements());
    expect(inverseADC(result, 5)).toBe(0);
    for (const force of [0, 0.4903325, 1.96133, 5.3936575, 10, 20, 40, CURVE_MAX_N]) {
      expect(inverseADC(result, predictADC(result, force))).toBeCloseTo(force, 9);
    }
    expect(inverseADC(result, predictADC(result, CURVE_MAX_N + 1))).toBeNull();
    expect(inverseADC(result, ADC_LIMIT)).toBeNull();
    expect(inverseADC(result, NaN)).toBeNull();
    expect(inverseADC(result, -1)).toBeNull();
  });

  it('does not draw model responses above the ADC ceiling as valid measurements', () => {
    // Clipping is tested on an explicitly synthetic model; measured saturated data are rejected above.
    const result = { ...fitCalibration(measurements()), a: 700, predictedADCMax: 340 };
    expect(result.predictedADCMax).toBeGreaterThan(255);
    const curve = buildCurve(result);
    const clipped = curve.filter(point => point.clipped);
    expect(clipped.length).toBeGreaterThan(0);
    expect(clipped.every(point => point.adc === null && point.rawADC >= 255)).toBe(true);
    expect(curve.filter(point => !point.clipped).every(point => point.adc! < 255)).toBe(true);
  });
});
