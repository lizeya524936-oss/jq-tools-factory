/**
 * hillFit.ts — Hill 方程拟合引擎（TypeScript 前端纯计算）
 * 
 * 移植自 Python hill_core 库，核心算法：
 * 1. Hill 方程正向：ADC = a * P^n / (b^n + P^n)
 * 2. Hill 方程反向：P = b * (ADC / (a - ADC))^(1/n)
 * 3. 双曲线方程：ADC = a * P / (b + P)  （Hill n=1 特例）
 * 4. Levenberg-Marquardt 非线性最小二乘拟合
 * 
 * 无外部依赖，纯 TypeScript 实现。
 */

// ─── 数据结构 ────────────────────────────────────────────────────────────────

export interface HillFitResult {
  a: number;       // 饱和值（ADC 最大值）
  b: number;       // 半饱和压力 (N)，当 P=b 时 ADC=a/2
  n: number;       // Hill 系数，控制曲线陡峭程度
  rmse: number;    // 均方根误差
  r2: number;      // 决定系数 R²
  method: 'hill' | 'hyperbolic' | 'fallback';  // 使用的拟合方法
}

export interface InverseHillResult {
  adcValue: number;
  pressure: number | null;
  status: 'valid' | 'zero' | 'saturated' | 'out_of_range';
}

export interface FitCurvePoint {
  pressure: number;
  adcSum: number;
}

// ─── Hill 方程（正向）────────────────────────────────────────────────────────

/**
 * Hill 方程: ADC = a * P^n / (b^n + P^n)
 */
export function hillFunc(x: number, a: number, b: number, n: number): number {
  const xn = Math.pow(Math.abs(x), n);
  const bn = Math.pow(Math.abs(b), n);
  return a * xn / (bn + xn + 1e-12);
}

/**
 * 批量计算 Hill 方程
 */
export function hillFuncArray(xs: number[], a: number, b: number, n: number): number[] {
  return xs.map(x => hillFunc(x, a, b, n));
}

// ─── 双曲线方程 ──────────────────────────────────────────────────────────────

/**
 * 双曲线方程: ADC = a * P / (b + P)  等价于 Hill n=1
 */
export function hyperbolicFunc(x: number, a: number, b: number): number {
  return a * x / (b + x + 1e-12);
}

// ─── Hill 方程反向公式 ────────────────────────────────────────────────────────

/**
 * Hill 反向: P = b * (ADC / (a - ADC))^(1/n)
 * 已知 ADC 值反推压力 (N)
 */
export function inverseHill(
  y: number,
  a: number,
  b: number,
  n: number,
  pMax: number = 100.0,
): InverseHillResult {
  if (y <= 0) {
    return { adcValue: y, pressure: null, status: 'zero' };
  }
  if (y >= a) {
    return { adcValue: y, pressure: null, status: 'saturated' };
  }
  const x = b * Math.pow(y / (a - y), 1.0 / n);
  if (x > pMax + 0.01) {
    return { adcValue: y, pressure: x, status: 'out_of_range' };
  }
  return { adcValue: y, pressure: x, status: 'valid' };
}

/**
 * 批量反向推算
 */
export function inverseHillBatch(
  yValues: number[],
  a: number,
  b: number,
  n: number,
  pMax: number = 100.0,
): InverseHillResult[] {
  return yValues.map(y => inverseHill(y, a, b, n, pMax));
}

// ─── 评估指标 ────────────────────────────────────────────────────────────────

/**
 * 计算 RMSE 和 R²
 */
export function computeMetrics(yTrue: number[], yPred: number[]): { rmse: number; r2: number } {
  const n = yTrue.length;
  if (n === 0) return { rmse: 0, r2: 0 };

  let ssRes = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    mean += yTrue[i];
  }
  mean /= n;

  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const residual = yTrue[i] - yPred[i];
    ssRes += residual * residual;
    const diff = yTrue[i] - mean;
    ssTot += diff * diff;
  }

  const rmse = Math.sqrt(ssRes / n);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { rmse, r2 };
}

// ─── Levenberg-Marquardt 非线性最小二乘拟合 ──────────────────────────────────

/**
 * 简化版 Levenberg-Marquardt 算法
 * 用于拟合 Hill 方程的 3 个参数 (a, b, n)
 */
function levenbergMarquardt(
  xs: number[],
  ys: number[],
  model: (x: number, params: number[]) => number,
  initialParams: number[],
  bounds: { lower: number[]; upper: number[] },
  maxIter: number = 5000,
  tol: number = 1e-10,
): number[] {
  const N = xs.length;
  const P = initialParams.length;
  let params = [...initialParams];
  let lambda = 0.001;
  const lambdaUp = 10;
  const lambdaDown = 0.1;

  // 计算残差
  const residuals = (p: number[]): number[] => {
    return ys.map((y, i) => y - model(xs[i], p));
  };

  // 计算总误差
  const totalError = (p: number[]): number => {
    const r = residuals(p);
    return r.reduce((s, v) => s + v * v, 0);
  };

  // 数值雅可比矩阵
  const jacobian = (p: number[]): number[][] => {
    const J: number[][] = [];
    const eps = 1e-8;
    for (let i = 0; i < N; i++) {
      const row: number[] = [];
      for (let j = 0; j < P; j++) {
        const pPlus = [...p];
        pPlus[j] += eps;
        const pMinus = [...p];
        pMinus[j] -= eps;
        row.push((model(xs[i], pPlus) - model(xs[i], pMinus)) / (2 * eps));
      }
      J.push(row);
    }
    return J;
  };

  // 约束参数在边界内
  const clamp = (p: number[]): number[] => {
    return p.map((v, i) => Math.max(bounds.lower[i], Math.min(bounds.upper[i], v)));
  };

  let currentError = totalError(params);

  for (let iter = 0; iter < maxIter; iter++) {
    const r = residuals(params);
    const J = jacobian(params);

    // J^T * J
    const JtJ: number[][] = Array.from({ length: P }, () => Array(P).fill(0));
    for (let i = 0; i < P; i++) {
      for (let j = 0; j < P; j++) {
        let sum = 0;
        for (let k = 0; k < N; k++) {
          sum += J[k][i] * J[k][j];
        }
        JtJ[i][j] = sum;
      }
    }

    // J^T * r
    const JtR: number[] = Array(P).fill(0);
    for (let i = 0; i < P; i++) {
      let sum = 0;
      for (let k = 0; k < N; k++) {
        sum += J[k][i] * r[k];
      }
      JtR[i] = sum;
    }

    // (J^T*J + lambda*diag(J^T*J)) * delta = J^T * r
    const A: number[][] = JtJ.map((row, i) =>
      row.map((v, j) => v + (i === j ? lambda * (v + 1e-10) : 0))
    );

    // 求解线性方程组（高斯消元）
    const delta = solveLinear(A, JtR);
    if (!delta) {
      lambda *= lambdaUp;
      continue;
    }

    const newParams = clamp(params.map((v, i) => v + delta[i]));
    const newError = totalError(newParams);

    if (newError < currentError) {
      params = newParams;
      currentError = newError;
      lambda *= lambdaDown;

      // 收敛检查
      const maxDelta = Math.max(...delta.map(Math.abs));
      if (maxDelta < tol) break;
    } else {
      lambda *= lambdaUp;
    }

    if (lambda > 1e16) break;
  }

  return params;
}

/**
 * 高斯消元法求解线性方程组 Ax = b
 */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  // 增广矩阵
  const aug: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // 部分主元选择
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    if (maxVal < 1e-20) return null;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    // 消元
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // 回代
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= aug[i][j] * x[j];
    }
    x[i] /= aug[i][i];
  }
  return x;
}

// ─── 拟合入口 ────────────────────────────────────────────────────────────────

/**
 * 对压力-ADC 数据进行 Hill 方程拟合
 * 
 * 拟合策略（与 Python 版一致）：
 * 1. 完整 3 参数拟合 (a, b, n)
 * 2. 若 R² < 0.9 → 降级为双曲线拟合 (n=1)
 * 3. 取 R² 更高的结果
 * 
 * @param pressures 压力值数组 (N)
 * @param adcValues ADC Sum 数组
 * @returns HillFitResult
 */
/**
 * 对大数据集进行降采样，保留曲线特征同时减少计算量
 * 策略：按压力值均匀分桶，每个桶取中位数
 */
function downsampleForFit(
  ps: number[],
  vs: number[],
  maxPoints: number = 500,
): { ps: number[]; vs: number[] } {
  if (ps.length <= maxPoints) return { ps, vs };

  // 按压力值排序
  const indices = ps.map((_, i) => i).sort((a, b) => ps[a] - ps[b]);
  const sortedPs = indices.map(i => ps[i]);
  const sortedVs = indices.map(i => vs[i]);

  const bucketSize = Math.ceil(sortedPs.length / maxPoints);
  const sampledPs: number[] = [];
  const sampledVs: number[] = [];

  for (let i = 0; i < sortedPs.length; i += bucketSize) {
    const end = Math.min(i + bucketSize, sortedPs.length);
    const mid = Math.floor((i + end) / 2);
    sampledPs.push(sortedPs[mid]);
    sampledVs.push(sortedVs[mid]);
  }

  return { ps: sampledPs, vs: sampledVs };
}

export function fitHill(pressures: number[], adcValues: number[]): HillFitResult | null {
  if (pressures.length < 3 || adcValues.length < 3) return null;
  if (pressures.length !== adcValues.length) return null;

  // 过滤无效数据
  const validPairs: { p: number; v: number }[] = [];
  for (let i = 0; i < pressures.length; i++) {
    const p = pressures[i];
    const v = adcValues[i];
    if (isFinite(p) && isFinite(v) && p >= 0) {
      validPairs.push({ p, v });
    }
  }
  if (validPairs.length < 3) return null;

  // 降采样：大数据集只用部分点拟合，大幅减少 LM 计算量
  const rawPs = validPairs.map(d => d.p);
  const rawVs = validPairs.map(d => d.v);
  const { ps: fitPs, vs: fitVs } = downsampleForFit(rawPs, rawVs, 500);

  // 拟合用降采样数据，评估用全量数据
  const ps = fitPs;
  const vs = fitVs;
  const evalPs = rawPs;
  const evalVs = rawVs;

  // 初始估计
  const maxV = Math.max(...vs);
  const medianP = [...ps].sort((a, b) => a - b)[Math.floor(ps.length / 2)];
  const a0 = maxV * 1.1;
  const b0 = Math.max(0.5, medianP);
  const n0 = 0.9;

  // 策略 1: 完整 3 参数 Hill 拟合
  let hillResult: HillFitResult | null = null;
  try {
    const hillModel = (x: number, params: number[]) => hillFunc(x, params[0], params[1], params[2]);
    const hillParams = levenbergMarquardt(
      ps, vs, hillModel,
      [a0, b0, n0],
      { lower: [0, 0.1, 0.1], upper: [maxV * 5, 500, 5.0] },
      5000,
    );
    const [a, b, n] = hillParams;
    // 用全量数据评估拟合质量
    const predicted = evalPs.map(p => hillFunc(p, a, b, n));
    const { rmse, r2 } = computeMetrics(evalVs, predicted);
    hillResult = { a, b, n, rmse, r2, method: 'hill' };
  } catch {
    // 拟合失败
  }

  // 策略 2: 双曲线拟合 (n=1)
  let hypResult: HillFitResult | null = null;
  try {
    const hypModel = (x: number, params: number[]) => hyperbolicFunc(x, params[0], params[1]);
    const hypParams = levenbergMarquardt(
      ps, vs, hypModel,
      [a0, b0],
      { lower: [0, 0.1], upper: [maxV * 5, 500] },
      3000,
    );
    const [a, b] = hypParams;
    // 用全量数据评估拟合质量
    const predicted = evalPs.map(p => hyperbolicFunc(p, a, b));
    const { rmse, r2 } = computeMetrics(evalVs, predicted);
    hypResult = { a, b, n: 1.0, rmse, r2, method: 'hyperbolic' };
  } catch {
    // 拟合失败
  }

  // 选择最优结果
  if (hillResult && hypResult) {
    return hillResult.r2 >= hypResult.r2 ? hillResult : hypResult;
  }
  if (hillResult) return hillResult;
  if (hypResult) return hypResult;

  // 兆底：使用初始估计
  const predicted = evalPs.map(p => hillFunc(p, a0, b0, 1.0));
  const { rmse, r2 } = computeMetrics(evalVs, predicted);
  return { a: a0, b: b0, n: 1.0, rmse, r2, method: 'fallback' };
}

/**
 * 生成拟合曲线数据点（用于图表绘制）
 * 
 * @param fit 拟合结果
 * @param pMin 压力最小值
 * @param pMax 压力最大值
 * @param numPoints 生成的点数
 * @returns 拟合曲线数据点数组
 */
export function generateFitCurve(
  fit: HillFitResult,
  pMin: number = 0,
  pMax: number = 100,
  numPoints: number = 200,
): FitCurvePoint[] {
  const points: FitCurvePoint[] = [];
  const step = (pMax - pMin) / (numPoints - 1);
  for (let i = 0; i < numPoints; i++) {
    const p = pMin + step * i;
    const adc = hillFunc(p, fit.a, fit.b, fit.n);
    points.push({ pressure: p, adcSum: adc });
  }
  return points;
}

/**
 * 格式化拟合方程为可读字符串
 */
export function formatHillEquation(fit: HillFitResult): string {
  return `ADC = ${fit.a.toFixed(2)} × P^${fit.n.toFixed(4)} / (${fit.b.toFixed(2)}^${fit.n.toFixed(4)} + P^${fit.n.toFixed(4)})`;
}

/**
 * 格式化反推公式为可读字符串
 */
export function formatInverseEquation(fit: HillFitResult): string {
  return `P = ${fit.b.toFixed(2)} × (ADC / (${fit.a.toFixed(2)} - ADC))^(1/${fit.n.toFixed(4)})`;
}
