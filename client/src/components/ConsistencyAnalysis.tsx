/**
 * ConsistencyAnalysis — 关键压力点 CV 分析 + 残差分布可视化
 * 
 * 基于 Data_analysis/sensor_hill_fit 的一致性评估算法：
 * 1. 关键压力点 CV 分析：对每个文件独立拟合 Hill 参数，在动态关键压力点计算 ADC 预测值的变异系数
 * 2. 残差分布：用全局 Hill 参数回代到每个文件，收集残差并统计分布
 * 
 * v1.9.7: 压力范围由外部控制，与 DataChart 双向联动
 */
import { useMemo, useState, memo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  ScatterChart,
  Scatter,
  ZAxis,
} from 'recharts';
import type { DataSeries } from './DataChart';
import { fitHill, hillFunc, type HillFitResult } from '@/lib/hillFit';

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** CV 判据阈值 */
const CV_THRESHOLDS = {
  excellent: 3,   // ≤ 3%: 优秀
  pass: 5,        // 3%-5%: 合格
  warning: 8,     // 5%-8%: 警告
  // > 8%: 不合格
};

/** 根据最大压力值动态生成关键压力点 */
function generatePressurePoints(maxPressure: number): number[] {
  if (maxPressure <= 0) return [];
  
  let count: number;
  if (maxPressure <= 20) count = 4;
  else if (maxPressure <= 50) count = 5;
  else if (maxPressure <= 100) count = 7;
  else if (maxPressure <= 200) count = 8;
  else if (maxPressure <= 500) count = 10;
  else count = 12;

  const points: number[] = [];
  const step = maxPressure / count;
  
  for (let i = 1; i <= count; i++) {
    let val = step * i;
    if (val >= 100) val = Math.round(val / 10) * 10;
    else if (val >= 10) val = Math.round(val / 5) * 5;
    else if (val >= 1) val = Math.round(val);
    else val = Math.round(val * 10) / 10;
    
    if (val > 0 && val <= maxPressure && !points.includes(val)) {
      points.push(val);
    }
  }
  
  const lastVal = Math.round(maxPressure * 10) / 10;
  if (!points.includes(lastVal) && lastVal > 0) {
    points.push(lastVal);
  }
  
  return points.sort((a, b) => a - b);
}

/** CV 颜色 */
function getCVColor(cv: number): string {
  if (cv <= CV_THRESHOLDS.excellent) return 'oklch(0.72 0.20 145)';
  if (cv <= CV_THRESHOLDS.pass) return 'oklch(0.80 0.18 90)';
  if (cv <= CV_THRESHOLDS.warning) return 'oklch(0.70 0.20 55)';
  return 'oklch(0.65 0.22 25)';
}

function getCVLabel(cv: number): string {
  if (cv <= CV_THRESHOLDS.excellent) return '优秀';
  if (cv <= CV_THRESHOLDS.pass) return '合格';
  if (cv <= CV_THRESHOLDS.warning) return '警告';
  return '不合格';
}

// ─── 分析接口 ────────────────────────────────────────────────────────────────

interface CVAnalysisPoint {
  pressure: number;
  cv: number;
  mean: number;
  std: number;
  values: number[];
  fileNames: string[];
}

interface ResidualStats {
  fileName: string;
  mean: number;
  std: number;
  maxAbs: number;
  residuals: number[];
  pressures: number[];
}

interface AnalysisResult {
  cvPoints: CVAnalysisPoint[];
  avgCV: number;
  cvScore: number;
  residualStats: ResidualStats[];
  allResiduals: number[];
  residualMean: number;
  residualStd: number;
  residualScore: number;
  perFileFits: { fileName: string; fit: HillFitResult }[];
  globalFit: HillFitResult | null;
}

// ─── 计算引擎 ────────────────────────────────────────────────────────────────

function computeAnalysis(allSeries: DataSeries[], pressurePoints: number[]): AnalysisResult | null {
  const validSeries = allSeries.filter(s => s.records.length >= 5);
  if (validSeries.length < 2) return null;
  if (pressurePoints.length === 0) return null;

  const perFileFits: { fileName: string; fit: HillFitResult }[] = [];
  for (const series of validSeries) {
    const pressures = series.records.map(r => r.pressure);
    const adcSums = series.records.map(r => r.adcSum);
    const fit = fitHill(pressures, adcSums);
    if (fit) {
      perFileFits.push({ fileName: series.name, fit });
    }
  }

  if (perFileFits.length < 2) return null;

  const allPressures: number[] = [];
  const allAdcSums: number[] = [];
  for (const series of validSeries) {
    for (const r of series.records) {
      allPressures.push(r.pressure);
      allAdcSums.push(r.adcSum);
    }
  }
  const globalFit = fitHill(allPressures, allAdcSums);

  const cvPoints: CVAnalysisPoint[] = [];
  for (const p of pressurePoints) {
    const values: number[] = [];
    const fileNames: string[] = [];
    for (const { fileName, fit } of perFileFits) {
      const predicted = hillFunc(p, fit.a, fit.b, fit.n);
      values.push(predicted);
      fileNames.push(fileName);
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    const cv = mean > 0 ? (std / mean) * 100 : 0;
    cvPoints.push({ pressure: p, cv, mean, std, values, fileNames });
  }

  const avgCV = cvPoints.reduce((sum, p) => sum + p.cv, 0) / cvPoints.length;
  const cvScore = Math.max(0, Math.min(100, ((CV_THRESHOLDS.warning - avgCV) / (CV_THRESHOLDS.warning - CV_THRESHOLDS.excellent)) * 100));

  const residualStats: ResidualStats[] = [];
  const allResiduals: number[] = [];

  if (globalFit) {
    for (const series of validSeries) {
      const residuals: number[] = [];
      const pressures: number[] = [];
      for (const r of series.records) {
        const predicted = hillFunc(r.pressure, globalFit.a, globalFit.b, globalFit.n);
        const residual = r.adcSum - predicted;
        residuals.push(residual);
        pressures.push(r.pressure);
        allResiduals.push(residual);
      }
      const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
      const variance = residuals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / residuals.length;
      const std = Math.sqrt(variance);
      const maxAbs = Math.max(...residuals.map(Math.abs));
      residualStats.push({ fileName: series.name, mean, std, maxAbs, residuals, pressures });
    }
  }

  const residualMean = allResiduals.length > 0
    ? allResiduals.reduce((a, b) => a + b, 0) / allResiduals.length : 0;
  const residualVariance = allResiduals.length > 0
    ? allResiduals.reduce((sum, v) => sum + (v - residualMean) ** 2, 0) / allResiduals.length : 0;
  const residualStd = Math.sqrt(residualVariance);
  const residualScore = Math.max(0, Math.min(100, ((30 - residualStd) / 25) * 100));

  return {
    cvPoints, avgCV, cvScore,
    residualStats, allResiduals, residualMean, residualStd, residualScore,
    perFileFits, globalFit,
  };
}

// ─── 直方图数据生成 ──────────────────────────────────────────────────────────

function buildHistogram(values: number[], binCount: number = 25): { bin: string; count: number; center: number }[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return [{ bin: `${min.toFixed(1)}`, count: values.length, center: min }];
  
  const binWidth = range / binCount;
  const bins: { bin: string; count: number; center: number }[] = [];
  
  for (let i = 0; i < binCount; i++) {
    const lo = min + i * binWidth;
    const hi = lo + binWidth;
    const center = (lo + hi) / 2;
    const count = values.filter(v => v >= lo && (i === binCount - 1 ? v <= hi : v < hi)).length;
    bins.push({ bin: center.toFixed(1), count, center });
  }
  
  return bins;
}

// ─── 组件 Props ──────────────────────────────────────────────────────────────

interface ConsistencyAnalysisProps {
  allSeries: DataSeries[];
  /** 外部控制的压力范围最大值（与 DataChart 联动） */
  pressureMax: number;
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const SERIES_COLORS = [
  'oklch(0.70 0.18 200)',
  'oklch(0.72 0.20 145)',
  'oklch(0.70 0.20 55)',
  'oklch(0.70 0.18 330)',
  'oklch(0.65 0.18 280)',
  'oklch(0.75 0.15 80)',
  'oklch(0.68 0.20 170)',
  'oklch(0.70 0.22 25)',
  'oklch(0.72 0.15 230)',
  'oklch(0.68 0.18 120)',
];

function ConsistencyAnalysisInner({ allSeries, pressureMax }: ConsistencyAnalysisProps) {
  const [expanded, setExpanded] = useState(true);

  // 动态生成关键压力点（基于外部传入的 pressureMax）
  const pressurePoints = useMemo(() => {
    return generatePressurePoints(pressureMax);
  }, [pressureMax]);

  // 自定义压力点 CV 计算
  const [customPressure, setCustomPressure] = useState<string>('');

  // 数据签名缓存
  const dataSignature = useMemo(() => {
    return allSeries.map(s => `${s.id}:${s.records.length}`).join('|') + `|max:${pressureMax}`;
  }, [allSeries, pressureMax]);

  const analysis = useMemo(() => {
    return computeAnalysis(allSeries, pressurePoints);
  }, [dataSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  // 自定义压力点 CV 计算结果
  const customCVResult = useMemo(() => {
    if (!analysis || !customPressure || customPressure.trim() === '') return null;
    const p = parseFloat(customPressure);
    if (!isFinite(p) || p < 0) return null;

    const values: number[] = [];
    const fileNames: string[] = [];
    for (const { fileName, fit } of analysis.perFileFits) {
      const predicted = hillFunc(p, fit.a, fit.b, fit.n);
      values.push(predicted);
      fileNames.push(fileName);
    }
    if (values.length < 2) return null;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    const cv = mean > 0 ? (std / mean) * 100 : 0;

    return { pressure: p, cv, mean, std, values, fileNames, isOutOfRange: p > pressureMax };
  }, [analysis, customPressure, pressureMax]);

  if (!analysis) {
    return (
      <div
        className="rounded p-4 text-center text-xs font-mono"
        style={{
          background: 'oklch(0.17 0.025 265)',
          border: '1px solid oklch(0.25 0.03 265)',
          color: 'oklch(0.45 0.02 240)',
        }}
      >
        需要至少 2 个数据文件（每个 ≥5 条记录）才能进行 CV 分析和残差分布统计
      </div>
    );
  }

  const { cvPoints, avgCV, cvScore, allResiduals, residualMean, residualStd, residualScore } = analysis;

  const cvChartData = cvPoints.map(p => ({
    pressure: `${p.pressure}N`,
    cv: Math.round(p.cv * 100) / 100,
    mean: Math.round(p.mean * 10) / 10,
  }));

  const histData = buildHistogram(allResiduals, 30);

  const scatterData: { pressure: number; adcPredicted: number; fileName: string; color: string }[] = [];
  for (const cp of cvPoints) {
    cp.values.forEach((v, i) => {
      const seriesIdx = allSeries.findIndex(s => s.name === cp.fileNames[i]);
      scatterData.push({
        pressure: cp.pressure,
        adcPredicted: Math.round(v * 10) / 10,
        fileName: cp.fileNames[i],
        color: SERIES_COLORS[(seriesIdx >= 0 ? seriesIdx : i) % SERIES_COLORS.length],
      });
    });
  }

  return (
    <div
      className="rounded"
      style={{
        background: 'oklch(0.17 0.025 265)',
        border: '1px solid oklch(0.25 0.03 265)',
      }}
    >
      {/* 标题栏 */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
        style={{ borderBottom: expanded ? '1px solid oklch(0.25 0.03 265)' : 'none' }}
      >
        <span className="text-xs font-mono font-medium" style={{ color: 'oklch(0.70 0.18 200)' }}>
          {expanded ? '▼' : '▶'} 一致性评估
        </span>
        <div className="flex items-center gap-3 ml-auto text-xs font-mono">
          <span style={{ color: 'oklch(0.45 0.02 240)', fontSize: '10px' }}>
            0-{pressureMax}N · {pressurePoints.length} 个分析点
          </span>
          <span style={{ color: 'oklch(0.35 0.02 240)' }}>|</span>
          <span style={{ color: getCVColor(avgCV) }}>
            平均 CV: {avgCV.toFixed(2)}% ({getCVLabel(avgCV)})
          </span>
          <span style={{ color: 'oklch(0.35 0.02 240)' }}>|</span>
          <span style={{ color: 'oklch(0.60 0.02 240)' }}>
            残差 σ: {residualStd.toFixed(2)}
          </span>
          <span style={{ color: 'oklch(0.35 0.02 240)' }}>|</span>
          <span style={{ color: 'oklch(0.60 0.02 240)' }}>
            CV 评分: {cvScore.toFixed(0)}
          </span>
          <span style={{ color: 'oklch(0.60 0.02 240)' }}>
            残差评分: {residualScore.toFixed(0)}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="p-4 flex flex-col gap-4">

          {/* 上半部分：CV 分析（左右两图） */}
          <div className="flex gap-4">
            {/* 左图：关键压力点 CV 折线图 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono font-medium" style={{ color: 'oklch(0.65 0.15 200)' }}>
                  关键压力点 CV 分析
                </span>
                <span className="text-xs font-mono" style={{ color: 'oklch(0.40 0.02 240)' }}>
                  ({analysis.perFileFits.length} 个文件独立拟合, 0-{pressureMax}N)
                </span>
              </div>
              <div style={{ height: '220px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cvChartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.02 240)" />
                    <XAxis
                      dataKey="pressure"
                      tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                      axisLine={{ stroke: 'oklch(0.30 0.02 240)' }}
                    />
                    <YAxis
                      tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                      axisLine={{ stroke: 'oklch(0.30 0.02 240)' }}
                      label={{ value: 'CV (%)', angle: -90, position: 'insideLeft', fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'oklch(0.15 0.025 265)',
                        border: '1px solid oklch(0.30 0.03 265)',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: 'oklch(0.70 0.02 240)',
                      }}
                      formatter={(value: number, name: string) => {
                        if (name === 'cv') return [`${value.toFixed(2)}%`, 'CV'];
                        return [value, name];
                      }}
                    />
                    <ReferenceLine y={CV_THRESHOLDS.excellent} stroke="oklch(0.72 0.20 145)" strokeDasharray="5 3" label={{ value: '优秀 3%', fill: 'oklch(0.72 0.20 145)', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", position: 'right' }} />
                    <ReferenceLine y={CV_THRESHOLDS.pass} stroke="oklch(0.80 0.18 90)" strokeDasharray="5 3" label={{ value: '合格 5%', fill: 'oklch(0.80 0.18 90)', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", position: 'right' }} />
                    <ReferenceLine y={CV_THRESHOLDS.warning} stroke="oklch(0.70 0.20 55)" strokeDasharray="5 3" label={{ value: '警告 8%', fill: 'oklch(0.70 0.20 55)', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", position: 'right' }} />
                    <Line
                      type="monotone"
                      dataKey="cv"
                      stroke="oklch(0.70 0.18 200)"
                      strokeWidth={2}
                      dot={{ fill: 'oklch(0.70 0.18 200)', r: 4, strokeWidth: 0 }}
                      activeDot={{ r: 6, fill: 'oklch(0.80 0.18 200)' }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* CV 详情表格 */}
              <div className="mt-2 overflow-x-auto" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                <table className="w-full text-xs font-mono" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid oklch(0.25 0.03 265)', position: 'sticky', top: 0, background: 'oklch(0.17 0.025 265)' }}>
                      <th className="px-2 py-1 text-left" style={{ color: 'oklch(0.50 0.02 240)' }}>压力点</th>
                      <th className="px-2 py-1 text-right" style={{ color: 'oklch(0.50 0.02 240)' }}>CV (%)</th>
                      <th className="px-2 py-1 text-right" style={{ color: 'oklch(0.50 0.02 240)' }}>均值</th>
                      <th className="px-2 py-1 text-right" style={{ color: 'oklch(0.50 0.02 240)' }}>标准差</th>
                      <th className="px-2 py-1 text-center" style={{ color: 'oklch(0.50 0.02 240)' }}>等级</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cvPoints.map(p => (
                      <tr key={p.pressure} style={{ borderBottom: '1px solid oklch(0.20 0.02 265)' }}>
                        <td className="px-2 py-1" style={{ color: 'oklch(0.65 0.02 240)' }}>{p.pressure} N</td>
                        <td className="px-2 py-1 text-right" style={{ color: getCVColor(p.cv) }}>{p.cv.toFixed(2)}%</td>
                        <td className="px-2 py-1 text-right" style={{ color: 'oklch(0.60 0.02 240)' }}>{p.mean.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right" style={{ color: 'oklch(0.60 0.02 240)' }}>{p.std.toFixed(2)}</td>
                        <td className="px-2 py-1 text-center">
                          <span
                            className="px-1.5 py-0.5 rounded"
                            style={{
                              background: getCVColor(p.cv).replace(')', ' / 0.15)'),
                              color: getCVColor(p.cv),
                              fontSize: '9px',
                            }}
                          >
                            {getCVLabel(p.cv)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 右图：各文件在关键压力点的 ADC 预测值散点 */}
            <div className="flex-1 min-w-0">
              {/* 自定义压力点 CV 计算器 */}
              <div
                className="rounded p-3 mb-3"
                style={{
                  background: 'oklch(0.15 0.02 265)',
                  border: '1px solid oklch(0.25 0.03 265)',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-mono font-medium" style={{ color: 'oklch(0.65 0.15 200)' }}>
                    自定义压力点 CV 计算
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder={`输入压力值 (N), 0-${pressureMax}`}
                    value={customPressure}
                    onChange={e => setCustomPressure(e.target.value)}
                    className="flex-1 px-2 py-1 rounded text-xs font-mono outline-none"
                    style={{
                      background: 'oklch(0.20 0.02 265)',
                      border: '1px solid oklch(0.30 0.03 265)',
                      color: 'oklch(0.70 0.02 240)',
                    }}
                  />
                  <button
                    onClick={() => setCustomPressure('')}
                    className="px-2 py-1 rounded text-xs font-mono hover:opacity-80 transition-opacity"
                    style={{
                      background: 'oklch(0.25 0.03 265)',
                      border: '1px solid oklch(0.30 0.03 265)',
                      color: 'oklch(0.55 0.02 240)',
                    }}
                  >
                    清除
                  </button>
                </div>

                {customCVResult ? (
                  <div className="mt-2">
                    {customCVResult.isOutOfRange && (
                      <div className="text-xs font-mono mb-1" style={{ color: 'oklch(0.70 0.20 55)' }}>
                        ⚠ 超出当前分析范围 (0-{pressureMax}N)，结果仅供参考
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono">
                      <span>
                        <span style={{ color: 'oklch(0.50 0.02 240)' }}>CV: </span>
                        <span style={{ color: getCVColor(customCVResult.cv) }}>{customCVResult.cv.toFixed(2)}%</span>
                      </span>
                      <span>
                        <span style={{ color: 'oklch(0.50 0.02 240)' }}>均值: </span>
                        <span style={{ color: 'oklch(0.65 0.02 240)' }}>{customCVResult.mean.toFixed(1)}</span>
                      </span>
                      <span>
                        <span style={{ color: 'oklch(0.50 0.02 240)' }}>标准差: </span>
                        <span style={{ color: 'oklch(0.65 0.02 240)' }}>{customCVResult.std.toFixed(2)}</span>
                      </span>
                      <span
                        className="px-1.5 py-0.5 rounded"
                        style={{
                          background: getCVColor(customCVResult.cv).replace(')', ' / 0.15)'),
                          color: getCVColor(customCVResult.cv),
                          fontSize: '9px',
                        }}
                      >
                        {getCVLabel(customCVResult.cv)}
                      </span>
                    </div>
                    <div className="mt-2 pt-2" style={{ borderTop: '1px solid oklch(0.22 0.03 265)' }}>
                      <span className="text-xs font-mono" style={{ color: 'oklch(0.40 0.02 240)' }}>
                        各文件预测值:
                      </span>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                        {customCVResult.fileNames.map((name, i) => {
                          const seriesIdx = allSeries.findIndex(s => s.name === name);
                          const color = SERIES_COLORS[(seriesIdx >= 0 ? seriesIdx : i) % SERIES_COLORS.length];
                          return (
                            <span key={name} className="text-xs font-mono" style={{ fontSize: '9px' }}>
                              <span style={{ color: 'oklch(0.45 0.02 240)' }}>
                                {name.replace(/\.csv$/i, '').slice(0, 14)}:
                              </span>
                              {' '}
                              <span style={{ color }}>{customCVResult.values[i].toFixed(1)}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs font-mono" style={{ color: 'oklch(0.35 0.02 240)' }}>
                    输入压力值查看该点的 CV 计算结果
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono font-medium" style={{ color: 'oklch(0.65 0.15 200)' }}>
                  各文件关键压力点 ADC 预测值
                </span>
              </div>
              <div style={{ height: '220px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.02 240)" />
                    <XAxis
                      type="number"
                      dataKey="pressure"
                      name="压力"
                      unit="N"
                      tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                      axisLine={{ stroke: 'oklch(0.30 0.02 240)' }}
                      domain={[0, pressureMax]}
                    />
                    <YAxis
                      type="number"
                      dataKey="adcPredicted"
                      name="ADC"
                      tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                      axisLine={{ stroke: 'oklch(0.30 0.02 240)' }}
                      label={{ value: 'ADC 预测值', angle: -90, position: 'insideLeft', fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                    />
                    <ZAxis range={[30, 30]} />
                    <Tooltip
                      contentStyle={{
                        background: 'oklch(0.15 0.025 265)',
                        border: '1px solid oklch(0.30 0.03 265)',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: 'oklch(0.70 0.02 240)',
                      }}
                      formatter={(value: number, name: string) => {
                        if (name === 'ADC') return [value.toFixed(1), 'ADC 预测'];
                        if (name === '压力') return [`${value}N`, '压力'];
                        return [value, name];
                      }}
                    />
                    <Scatter data={scatterData} isAnimationActive={false}>
                      {scatterData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              {/* 图例 */}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {analysis.perFileFits.map((f, i) => (
                  <div key={f.fileName} className="flex items-center gap-1">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
                    />
                    <span className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)', fontSize: '9px' }}>
                      {f.fileName.replace(/\.csv$/i, '').slice(0, 20)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 下半部分：残差分布直方图 */}
          <div style={{ borderTop: '1px solid oklch(0.22 0.03 265)', paddingTop: '16px' }}>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono font-medium" style={{ color: 'oklch(0.65 0.15 200)' }}>
                  残差分布直方图
                </span>
                <span className="text-xs font-mono" style={{ color: 'oklch(0.40 0.02 240)' }}>
                  (全部文件合并, n={allResiduals.length})
                </span>
              </div>
              <div style={{ height: '220px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.02 240)" />
                    <XAxis
                      dataKey="bin"
                      tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" }}
                      axisLine={{ stroke: 'oklch(0.30 0.02 240)' }}
                      interval="preserveStartEnd"
                      label={{ value: '残差 (ADC)', position: 'insideBottom', offset: -2, fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                    />
                    <YAxis
                      tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                      axisLine={{ stroke: 'oklch(0.30 0.02 240)' }}
                      label={{ value: '频次', angle: -90, position: 'insideLeft', fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'oklch(0.15 0.025 265)',
                        border: '1px solid oklch(0.30 0.03 265)',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: 'oklch(0.70 0.02 240)',
                      }}
                      formatter={(value: number) => [value, '频次']}
                    />
                    {histData.length > 0 && (
                      <ReferenceLine
                        x={histData.reduce((closest, d) => Math.abs(d.center - residualMean) < Math.abs(closest.center - residualMean) ? d : closest, histData[0])?.bin}
                        stroke="oklch(0.80 0.18 90)"
                        strokeDasharray="5 3"
                        label={{ value: `μ=${residualMean.toFixed(1)}`, fill: 'oklch(0.80 0.18 90)', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", position: 'top' }}
                      />
                    )}
                    <Bar dataKey="count" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                      {histData.map((entry, index) => {
                        const inSigma = Math.abs(entry.center - residualMean) <= residualStd;
                        return (
                          <Cell
                            key={index}
                            fill={inSigma ? 'oklch(0.58 0.18 265 / 0.7)' : 'oklch(0.40 0.10 265 / 0.5)'}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex gap-4 text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
                <span>均值 μ = {residualMean.toFixed(2)}</span>
                <span>标准差 σ = {residualStd.toFixed(2)}</span>
                <span>范围: [{Math.min(...allResiduals).toFixed(1)}, {Math.max(...allResiduals).toFixed(1)}]</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ConsistencyAnalysis = memo(ConsistencyAnalysisInner);
export default ConsistencyAnalysis;
