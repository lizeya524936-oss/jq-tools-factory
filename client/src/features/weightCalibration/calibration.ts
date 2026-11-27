/** Six-level calibration math; all positive load levels have equal weight. */
export const GRAVITY = 9.80665;
export const WEIGHT_STEPS = [0, 50, 200, 550, 850, 1050] as const;
export const ADC_LIMIT = 255;
export const CURVE_MAX_N = 80;
/** Shared physical-force boundary tolerance for decimal gram inputs. */
export const FORCE_TOLERANCE_N = 1e-9;
export const MAX_WEIGHT_G = CURVE_MAX_N / GRAVITY * 1000;
export const CHART_RANGE_MIN_N = 0.5;
export const CHART_RANGE_STEP_N = 0.5;
export const CHART_RANGE_PRESETS = [CURVE_MAX_N / 4, CURVE_MAX_N / 2, CURVE_MAX_N] as const;
export const REFERENCE_HILL = { a: 340.4415, b: 23.4839, n: 0.4774 } as const;
export type CalibrationMode = 'measured' | 'reference';
export const HILL_FIT_BOUNDS = {
  a: [0.01, 5000],
  b: [0.01, 1000],
  n: [0.1, 5],
} as const;

export interface HillReference {
  a: number;
  b: number;
  n: number;
}

export interface SampleSummary {
  median: number;
  mean: number;
  /** Sample SD; zero for a single observation. */
  sd: number;
  min: number;
  max: number;
  count: number;
}

export interface CalibrationPoint {
  massG: number;
  /** Median of selected-region ADC averages during the retained window. */
  adc: number;
  sd: number;
  count: number;
  capturedAt: string;
  durationMs: number;
  /** Frames where at least one selected sensor reached the ADC limit. */
  saturatedSamples: number;
}

export interface CalibrationResidual extends CalibrationPoint {
  forceN: number;
  predictedADC: number;
  /** Observed minus predicted ADC. */
  errorADC: number;
}

export interface CalibrationResult extends HillReference {
  offset: number;
  gain: number;
  /** Equal-weight RMSE across all positive mass levels in the selected plan. */
  rmse: number;
  /** R² across positive levels only; null for zero response variance. */
  r2: number | null;
  measuredMaxN: number;
  /** Unclipped model prediction at CURVE_MAX_N; may exceed ADC_LIMIT and then is unobservable. */
  predictedADCMax: number;
  residuals: CalibrationResidual[];
  warnings: string[];
  source: string;
  approach: string;
  mode: CalibrationMode;
  massLevelsG: number[];
  diagnostics: {
    converged: boolean;
    /** Condition number of the log-parameter Jacobian; null if singular/not applicable. */
    conditionNumber: number | null;
    atBounds: string[];
    iterations: number;
    starts: number;
    parameterBounds: typeof HILL_FIT_BOUNDS | null;
  };
}

export interface CurvePoint {
  forceN: number;
  /** Null where the model predicts an unobservable, saturated response. */
  adc: number | null;
  rawADC: number;
  range: 'measured-range' | 'extrapolated';
  clipped: boolean;
}

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name}必须是有限数值。`);
}

function validateShape(shape: HillReference): void {
  for (const key of ['a', 'b', 'n'] as const) {
    requireFinite(shape[key], `Hill ${key}`);
    if (shape[key] <= 0) throw new Error(`Hill ${key} 必须大于 0。`);
  }
}

export function massToForce(massG: number): number {
  requireFinite(massG, '重量');
  if (massG < 0) throw new Error('重量不能小于 0。');
  return massG / 1000 * GRAVITY;
}

/** Validate an ordered six-level plan without changing the caller's array. */
export function validateWeightPlan(levels: readonly number[]): number[] {
  if (levels.length !== WEIGHT_STEPS.length) throw new Error('重量计划必须恰好包含 6 档。');
  const plan = [...levels];
  for (let i = 0; i < plan.length; i++) requireFinite(plan[i], `第 ${i + 1} 档重量`);
  if (plan[0] !== 0) throw new Error('第一档必须为 0 g，用于采集零点。');
  for (let i = 1; i < plan.length; i++) {
    if (plan[i] <= 0 || plan[i] <= plan[i - 1]) throw new Error('后 5 档重量必须大于 0 且严格递增，不能重复。');
  }
  if (massToForce(plan[plan.length - 1]) > CURVE_MAX_N + FORCE_TOLERANCE_N) {
    throw new Error(`最高档力值不能超过 ${CURVE_MAX_N} N（约 ${MAX_WEIGHT_G.toFixed(3)} g）。`);
  }
  return plan;
}

export function rangeDescription(maxN: number): string {
  requireFinite(maxN, '标定范围');
  return `0–${maxN.toFixed(3)} N 为标定范围` +
    (maxN < CURVE_MAX_N - FORCE_TOLERANCE_N ? `，${maxN.toFixed(3)}–${CURVE_MAX_N} N 为外推，尚未实测验证。` : '，范围内精度仍需独立载荷验证。');
}

export function weightLabel(massG: number): string {
  return `${massG} g`;
}

export function hillShape(forceN: number, b: number, n: number): number {
  requireFinite(forceN, '力值');
  requireFinite(b, 'Hill b');
  requireFinite(n, 'Hill n');
  if (forceN < 0 || b <= 0 || n <= 0) throw new Error('力值不能为负，Hill b、n 必须大于 0。');
  if (forceN === 0) return 0;
  // Logistic form avoids overflow of force**n or b**n.
  const z = n * (Math.log(forceN) - Math.log(b));
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

export function median(samples: readonly number[]): number {
  if (!samples.length) throw new Error('没有可用的采集数据。');
  if (samples.some(value => !Number.isFinite(value))) throw new Error('采集数据包含无效数值。');
  const ordered = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
}

export function summarizeSamples(samples: readonly number[]): SampleSummary {
  const middle = median(samples);
  let mean = 0;
  let m2 = 0;
  let min = Infinity;
  let max = -Infinity;
  samples.forEach((value, index) => {
    const delta = value - mean;
    mean += delta / (index + 1);
    m2 += delta * (value - mean);
    min = Math.min(min, value);
    max = Math.max(max, value);
  });
  return {
    median: middle,
    mean,
    sd: samples.length > 1 ? Math.sqrt(Math.max(0, m2 / (samples.length - 1))) : 0,
    min,
    max,
    count: samples.length,
  };
}

type Vector3 = [number, number, number];
type Matrix3 = [Vector3, Vector3, Vector3];
const PARAMETER_KEYS = ['a', 'b', 'n'] as const;
const LOG_BOUNDS = PARAMETER_KEYS.map(key => HILL_FIT_BOUNDS[key].map(Math.log)) as [number[], number[], number[]];

function solve3(matrix: Matrix3, rhs: Vector3): Vector3 | null {
  const work = matrix.map((row, index) => [...row, rhs[index]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(work[row][col]) > Math.abs(work[pivot][col])) pivot = row;
    if (Math.abs(work[pivot][col]) < 1e-18) return null;
    [work[pivot], work[col]] = [work[col], work[pivot]];
    const scale = work[col][col];
    for (let j = col; j < 4; j++) work[col][j] /= scale;
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = work[row][col];
      for (let j = col; j < 4; j++) work[row][j] -= factor * work[col][j];
    }
  }
  const answer = work.map(row => row[3]) as Vector3;
  return answer.every(Number.isFinite) ? answer : null;
}

/** Dimensionless Jacobian uses log(a), log(b), log(n). */
function fitSystem(theta: Vector3, force: number[], response: number[], scale: number) {
  const [a, b, n] = theta.map(Math.exp);
  const normal: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const gradient: Vector3 = [0, 0, 0];
  let sse = 0;
  force.forEach((p, i) => {
    const h = hillShape(p, b, n);
    const residual = (a * h - response[i]) / scale;
    const slope = a * n * h * (1 - h) / scale;
    const jac: Vector3 = [a * h / scale, -slope, slope * (Math.log(p) - Math.log(b))];
    sse += residual * residual;
    for (let j = 0; j < 3; j++) {
      gradient[j] += jac[j] * residual;
      for (let k = 0; k < 3; k++) normal[j][k] += jac[j] * jac[k];
    }
  });
  return { sse, normal, gradient };
}

function jacobianCondition(matrix: Matrix3): number | null {
  // Jacobi eigenvalue iteration for the symmetric 3x3 JᵀJ matrix.
  const work = matrix.map(row => [...row]);
  for (let iteration = 0; iteration < 40; iteration++) {
    let p = 0, q = 1;
    for (const [i, j] of [[0, 2], [1, 2]]) if (Math.abs(work[i][j]) > Math.abs(work[p][q])) { p = i; q = j; }
    const diagonalScale = Math.max(1, Math.abs(work[0][0]), Math.abs(work[1][1]), Math.abs(work[2][2]));
    if (Math.abs(work[p][q]) < diagonalScale * 1e-15) break;
    const angle = 0.5 * Math.atan2(2 * work[p][q], work[q][q] - work[p][p]);
    const c = Math.cos(angle), s = Math.sin(angle);
    const pp = work[p][p], qq = work[q][q], pq = work[p][q];
    work[p][p] = c * c * pp - 2 * s * c * pq + s * s * qq;
    work[q][q] = s * s * pp + 2 * s * c * pq + c * c * qq;
    work[p][q] = work[q][p] = 0;
    for (let k = 0; k < 3; k++) {
      if (k === p || k === q) continue;
      const kp = work[k][p], kq = work[k][q];
      work[k][p] = work[p][k] = c * kp - s * kq;
      work[k][q] = work[q][k] = s * kp + c * kq;
    }
  }
  const eigenvalues = [work[0][0], work[1][1], work[2][2]].sort((a, b) => a - b);
  return eigenvalues[0] > eigenvalues[2] * 1e-14 ? Math.sqrt(eigenvalues[2] / eigenvalues[0]) : null;
}

function fitMeasuredHill(force: number[], response: number[], reference: HillReference) {
  const scale = Math.max(...response);
  const starts: Vector3[] = [];
  const bStarts = [0.1, 0.5, 2, 8, 25, 100, 400, reference.b];
  const nStarts = [0.25, 0.5, 1, 2, 4, reference.n];
  for (const b of bStarts) for (const n of nStarts) {
    const q = force.map(p => hillShape(p, b, n));
    const a = q.reduce((sum, value, i) => sum + value * response[i], 0) / q.reduce((sum, value) => sum + value * value, 0);
    starts.push([a, b, n].map((value, i) => Math.max(LOG_BOUNDS[i][0], Math.min(LOG_BOUNDS[i][1], Math.log(value)))) as Vector3);
  }
  let best: { theta: Vector3; sse: number; iterations: number; converged: boolean } | null = null;
  for (const start of starts) {
    let theta: Vector3 = [...start];
    let system = fitSystem(theta, force, response, scale);
    let lambda = 1e-3;
    let converged = false;
    let iterations = 0;
    for (; iterations < 350; iterations++) {
      const activeConstraints = system.gradient.map((value, i) => {
        const atLower = theta[i] - LOG_BOUNDS[i][0] < 1e-9;
        const atUpper = LOG_BOUNDS[i][1] - theta[i] < 1e-9;
        return (atLower && value > 0) || (atUpper && value < 0);
      });
      const projectedGradient = system.gradient.map((value, i) => activeConstraints[i] ? 0 : value);
      if (Math.max(...projectedGradient.map(Math.abs)) < 1e-10 || system.sse < 1e-22) { converged = true; break; }
      const matrix = system.normal.map((row, i) => row.map((value, j) => {
        if (activeConstraints[i] || activeConstraints[j]) return i === j ? 1 : 0;
        return i === j ? value + lambda * Math.max(1e-6, value) : value;
      })) as Matrix3;
      const delta = solve3(matrix, projectedGradient.map(value => -value) as Vector3);
      if (!delta) { lambda *= 10; if (lambda > 1e15) break; continue; }
      const candidate = theta.map((value, i) => Math.max(LOG_BOUNDS[i][0], Math.min(LOG_BOUNDS[i][1], value + Math.max(-2, Math.min(2, delta[i]))))) as Vector3;
      const next = fitSystem(candidate, force, response, scale);
      if (next.sse < system.sse) {
        const improvement = system.sse - next.sse;
        const step = Math.max(...candidate.map((value, i) => Math.abs(value - theta[i])));
        theta = candidate; system = next; lambda = Math.max(1e-12, lambda / 3);
        if (improvement < 1e-15 * (1 + system.sse) && step < 1e-7) { converged = true; break; }
      } else {
        lambda *= 10;
        if (lambda > 1e15) break;
      }
    }
    if (!best || system.sse < best.sse || (Math.abs(system.sse - best.sse) < 1e-18 && converged && !best.converged)) {
      best = { theta, sse: system.sse, iterations, converged };
    }
  }
  if (!best || !Number.isFinite(best.sse) || !best.converged) {
    throw new Error('本次三参数 Hill 拟合未可靠收敛，请检查采集点或选择历史形状校准。程序不会自动替换拟合方法。');
  }
  const [a, b, n] = best.theta.map(Math.exp);
  const atBounds = PARAMETER_KEYS.filter((_, i) => Math.min(best!.theta[i] - LOG_BOUNDS[i][0], LOG_BOUNDS[i][1] - best!.theta[i]) < 1e-4);
  return {
    a, b, n,
    diagnostics: {
      converged: best.converged,
      conditionNumber: jacobianCondition(fitSystem(best.theta, force, response, scale).normal),
      atBounds,
      iterations: best.iterations,
      starts: starts.length,
      parameterBounds: HILL_FIT_BOUNDS,
    },
  };
}

export function fitCalibration(
  points: readonly CalibrationPoint[],
  shape: HillReference = REFERENCE_HILL,
  mode: CalibrationMode = 'measured',
  massPlan: readonly number[] = WEIGHT_STEPS,
): CalibrationResult {
  const massLevelsG = validateWeightPlan(massPlan);
  validateShape(shape);
  if (mode !== 'measured' && mode !== 'reference') throw new Error('请选择有效的拟合模式。');
  const levelLabels = massLevelsG.map(weightLabel).join('、');
  if (points.length !== massLevelsG.length) throw new Error(`请先完成 ${levelLabels} 共 ${massLevelsG.length} 档采集。`);
  const sorted = [...points].sort((a, b) => a.massG - b.massG);
  if (sorted.some((point, index) => point.massG !== massLevelsG[index])) {
    throw new Error(`重量档位缺失或重复，必须各有一笔 ${levelLabels}。`);
  }

  for (const point of sorted) {
    for (const key of ['adc', 'sd', 'count', 'durationMs', 'saturatedSamples'] as const) {
      requireFinite(point[key], `${weightLabel(point.massG)} 的 ${key}`);
    }
    if (point.adc < 0 || point.adc > ADC_LIMIT) throw new Error(`${weightLabel(point.massG)} 的 ADC 不在 0–255 范围。`);
    if (point.sd < 0 || !Number.isInteger(point.count) || point.count < 1 || point.durationMs <= 0) {
      throw new Error(`${weightLabel(point.massG)} 的采集统计无效，请重新采集。`);
    }
    if (!Number.isInteger(point.saturatedSamples) || point.saturatedSamples < 0 || point.saturatedSamples > point.count) {
      throw new Error(`${weightLabel(point.massG)} 的饱和帧计数无效。`);
    }
    if (!point.capturedAt || !Number.isFinite(Date.parse(point.capturedAt))) {
      throw new Error(`${weightLabel(point.massG)} 的采集时间无效。`);
    }
    if (point.saturatedSamples > 0 || point.adc >= ADC_LIMIT) {
      throw new Error(`${weightLabel(point.massG)} 有选中通道达到 ADC 255，请调整测量后重新采集。`);
    }
  }

  const offset = sorted[0].adc;
  const positive = sorted.slice(1);
  const last = sorted[sorted.length - 1];
  const netMax = last.adc - offset;
  const noiseFloor = Math.max(1, 3 * Math.hypot(sorted[0].sd, last.sd));
  if (netMax <= noiseFloor) throw new Error(`${weightLabel(last.massG)} 的信号未明显高于零点与波动，请确认选区、放置位置及连接。`);
  if (positive.some(point => point.adc <= offset)) throw new Error('加载后 ADC 未高于零点，请确认砝码与选区后重测。');

  const warnings: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const point = sorted[i];
    const tolerance = Math.max(0.5, 3 * Math.hypot(prev.sd, point.sd));
    if (point.adc < prev.adc - tolerance) {
      throw new Error(`${weightLabel(point.massG)} 的 ADC 明显低于 ${weightLabel(prev.massG)}，请检查档位、位置及是否已稳定。`);
    }
    if (point.adc <= prev.adc) warnings.push(`${weightLabel(prev.massG)} 至 ${weightLabel(point.massG)} 未呈明确上升，建议重测这两档。`);
  }
  for (const point of sorted) {
    if (point.count < 20) warnings.push(`${weightLabel(point.massG)} 仅有 ${point.count} 帧，建议延长采集确认稳定性。`);
    if (point.sd > Math.max(1, netMax * 0.05)) warnings.push(`${weightLabel(point.massG)} 波动偏大（SD ${point.sd.toFixed(2)} ADC），建议稳定后重测。`);
  }

  // One representative value per load level: frame counts never weight the fit.
  const force = positive.map(point => massToForce(point.massG));
  const response = positive.map(point => point.adc - offset);
  let a = shape.a, b = shape.b, n = shape.n;
  let diagnostics: CalibrationResult['diagnostics'] = { converged: true, conditionNumber: null, atBounds: [], iterations: 0, starts: 1, parameterBounds: null };
  if (mode === 'measured') {
    const fitted = fitMeasuredHill(force, response, shape);
    ({ a, b, n, diagnostics } = fitted);
    if (diagnostics.atBounds.length) warnings.push(`参数 ${diagnostics.atBounds.join('、')} 达到拟合约束边界；当前数据不足以可靠确定这些参数，请检查采集点并补充验证。`);
    if (diagnostics.conditionNumber === null || diagnostics.conditionNumber > 1e4) {
      warnings.push('Hill 参数难以独立辨识：小幅测量变化可能显著改变 a、b、n。请优先核对范围内曲线，并补充独立验证点。');
    }
    if (hillShape(force[force.length - 1], b, n) < 0.8) warnings.push('最高载荷尚未接近拟合平台，a 是模型渐近参数，不是已经测到的饱和值。');
    warnings.push(`本次使用 ${positive.length} 个非零载荷点拟合 3 个参数，仅有 ${positive.length - 3} 个残差自由度；拟合残差不等于独立验证精度。`);
  } else {
    const q = force.map(p => hillShape(p, b, n));
    a = q.reduce((sum, value, index) => sum + value * response[index], 0) / q.reduce((sum, value) => sum + value * value, 0);
    warnings.push('当前采用历史形状校准：b、n 固定为参考值，只校准零点与幅值。');
  }
  if (!Number.isFinite(a) || a <= 0) throw new Error('无法建立有效的正向响应曲线，请重新采集。');
  const residuals = sorted.map(point => {
    const forceN = massToForce(point.massG);
    const predictedADC = offset + a * hillShape(forceN, b, n);
    return { ...point, forceN, predictedADC, errorADC: point.adc - predictedADC };
  });
  const sse = residuals.slice(1).reduce((sum, point) => sum + point.errorADC ** 2, 0);
  const mean = positive.reduce((sum, point) => sum + point.adc, 0) / positive.length;
  const sst = positive.reduce((sum, point) => sum + (point.adc - mean) ** 2, 0);
  const rmse = Math.sqrt(sse / positive.length);
  const predictedADCMax = offset + a * hillShape(CURVE_MAX_N, b, n);
  const measuredMaxN = massToForce(last.massG);
  if (rmse / netMax > 0.05) warnings.push('标定点残差超过信号幅度的 5%，请检查接触位置、零点漂移及模型适用性。');
  if (predictedADCMax >= ADC_LIMIT) warnings.push('模型在显示范围内预测达到 ADC 255；超出可观测范围的曲线不显示。');
  if (measuredMaxN < CURVE_MAX_N - FORCE_TOLERANCE_N) {
    warnings.push(`${measuredMaxN.toFixed(7)}–${CURVE_MAX_N} N 超出实测标定范围，使用${mode === 'measured' ? '本次 Hill 拟合' : '固定历史 Hill 形状'}外推，尚未经过独立载荷验证。`);
  }
  return {
    a,
    b,
    n,
    offset,
    gain: a / shape.a,
    rmse,
    r2: sst > Number.EPSILON ? 1 - sse / sst : null,
    measuredMaxN,
    predictedADCMax,
    residuals,
    warnings,
    source: mode === 'measured' ? `${massLevelsG.length}-level-measured-data` : 'historical-hill-shape',
    approach: mode === 'measured' ? 'fixed-baseline-multistart-constrained-hill-equal-weight' : 'fixed-baseline-and-shape-equal-weight-gain',
    mode,
    massLevelsG,
    diagnostics,
  };
}

/** Raw model value. Plotting uses buildCurve so out-of-range ADC is marked. */
export function predictADC(result: CalibrationResult, forceN: number): number {
  return result.offset + result.a * hillShape(forceN, result.b, result.n);
}

/** Returns a valid estimate only within the configured force range and the ADC observation range. */
export function inverseADC(result: CalibrationResult, adc: number): number | null {
  if (!Number.isFinite(adc) || adc < 0 || adc >= ADC_LIMIT) return null;
  if (adc <= result.offset) return 0;
  const corrected = adc - result.offset;
  if (corrected >= result.a) return null;
  const forceN = result.b * Math.pow(corrected / (result.a - corrected), 1 / result.n);
  if (!Number.isFinite(forceN) || forceN < 0 || forceN > CURVE_MAX_N + FORCE_TOLERANCE_N) return null;
  return Math.min(forceN, CURVE_MAX_N);
}

export function buildCurve(result: CalibrationResult, maxN = CURVE_MAX_N): CurvePoint[] {
  requireFinite(maxN, '曲线范围');
  if (maxN <= 0 || maxN > CURVE_MAX_N) throw new Error(`曲线上限必须大于 0 且不超过 ${CURVE_MAX_N} N。`);
  const values = new Set<number>();
  // Dense near zero, while retaining exact load points and the measured boundary.
  for (let i = 0; i <= 400; i++) values.add(maxN * (i / 400) ** 2);
  if (maxN >= CURVE_MAX_N) values.add(CURVE_MAX_N);
  if (maxN >= result.measuredMaxN) values.add(result.measuredMaxN);
  for (const point of result.residuals) {
    const force = point.forceN;
    if (force <= maxN) values.add(force);
  }
  return [...values].sort((a, b) => a - b).map(forceN => {
    const rawADC = predictADC(result, forceN);
    const clipped = rawADC >= ADC_LIMIT || rawADC < 0 || !Number.isFinite(rawADC);
    return {
      forceN,
      adc: clipped ? null : rawADC,
      rawADC,
      range: forceN <= result.measuredMaxN ? 'measured-range' : 'extrapolated',
      clipped,
    };
  });
}
