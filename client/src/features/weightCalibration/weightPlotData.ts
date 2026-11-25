import { MAX_DISPLAY_POINTS_PER_SERIES } from '@/components/forceChartStyle';
import { CURVE_MAX_N, FORCE_TOLERANCE_N, buildCurve, massToForce, type CalibrationPoint, type CalibrationResult } from './calibration';
import { predictCsvReference, selectCsvLoadingSamples, type CsvDataset, type CsvReference, type CsvScope, type CsvSample } from './csvReference';

export function sortedLoadingSeries(datasets: CsvDataset[], scope: CsvScope, excludeSaturated: boolean) {
  return datasets.map(dataset => selectCsvLoadingSamples(dataset, scope, excludeSaturated).used
    .slice().sort((a, b) => a.forceN - b.forceN));
}

export function visibleLoadingPoints(samples: CsvSample[], maxN: number) {
  const inView = samples.filter(p => p.forceN <= maxN + FORCE_TOLERANCE_N);
  const count = inView.length;
  const limit = MAX_DISPLAY_POINTS_PER_SERIES;
  const display = count <= limit ? inView : Array.from({ length: limit }, (_, i) =>
    inView[Math.round(i * (count - 1) / (limit - 1))]);
  return { display, count };
}

export function referenceCurve(reference: CsvReference, maxN: number) {
  const lo = Math.max(0, reference.minN);
  const hi = Math.min(maxN, reference.maxN);
  if (lo >= hi) return [];
  return Array.from({ length: 201 }, (_, i) => lo + (hi - lo) * (i / 200) ** 2)
    .flatMap(forceN => {
      const adc = predictCsvReference(reference, forceN);
      return adc === null ? [] : [{ forceN, adc }];
    });
}

export function calibrationSeries(points: CalibrationPoint[], result: CalibrationResult | null, maxN: number) {
  const measured = points.map(p => ({ forceN: massToForce(p.massG), adc: p.adc, massG: p.massG }))
    .filter(p => p.forceN <= maxN + FORCE_TOLERANCE_N);
  const curve = result ? buildCurve(result, Math.min(CURVE_MAX_N, maxN)) : [];
  const observable = curve.flatMap(p => p.adc === null ? [] : [{ forceN: p.forceN, adc: p.adc }]);
  const boundary = result?.measuredMaxN ?? 0;
  return {
    measured,
    fitted: observable.filter(p => p.forceN <= boundary + FORCE_TOLERANCE_N),
    extrapolated: result && maxN > boundary + FORCE_TOLERANCE_N
      ? observable.filter(p => p.forceN >= boundary - FORCE_TOLERANCE_N) : [],
  };
}
