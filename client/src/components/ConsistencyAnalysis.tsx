/**
 * ConsistencyAnalysis — 关键压力点 CV 分析 + 残差分布可视化
 * 
 * 基于 Data_analysis/sensor_hill_fit 的一致性评估算法：
 * 1. 关键压力点 CV 分析：对每个文件独立拟合 Hill 参数，在 7 个关键压力点计算 ADC 预测值的变异系数
 * 2. 残差分布：用全局 Hill 参数回代到每个文件，收集残差并统计分布
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

/** 7 个关键压力点 (N) */
const KEY_PRESSURE_POINTS = [5, 10, 20, 30, 50, 70, 100];

/** CV 判据阈值 */
const CV_THRESHOLDS = {
  excellent: 3,   // ≤ 3%: 优秀
  pass: 5,        // 3%-5%: 合格
  warning: 8,     // 5%-8%: 警告
  // > 8%: 不合格
};

/** CV 颜色 */
function getCVColor(cv: number): string {
  if (cv <= CV_THRESHOLDS.excellent) return 'oklch(0.72 0.20 145)'; // 绿
  if (cv <= CV_THRESHOLDS.pass) return 'oklch(0.80 0.18 90)';      // 黄
  if (cv <= CV_THRESHOLDS.warning) return 'oklch(0.70 0.20 55)';   // 橙
  return 'oklch(0.65 0.22 25)';                                     // 红
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
  cv: number;          // 变异系数 (%)
  mean: number;        // ADC 均值
  std: number;         // ADC 标准差
  values: number[];    // 各文件在此压力点的 ADC 预测值
  fileNames: string[]; // 对应的文件名
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

function computeAnalysis(allSeries: DataSeries[]): AnalysisResult | null {
  // 至少需要 2 个文件才能做 CV 分析
  const validSeries = allSeries.filter(s => s.records.length >= 5);
  if (validSeries.length < 2) return null;

  // 1. 对每个文件独立拟合 Hill 参数
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

  // 2. 全局拟合（所有文件数据合并）
  const allPressures: number[] = [];
  const allAdcSums: number[] = [];
  for (const series of validSeries) {
    for (const r of series.records) {
      allPressures.push(r.pressure);
      allAdcSums.push(r.adcSum);
    }
  }
  const globalFit = fitHill(allPressures, allAdcSums);

  // 3. 关键压力点 CV 分析
  const cvPoints: CVAnalysisPoint[] = [];
  for (const p of KEY_PRESSURE_POINTS) {
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
  // 评分：avgCV ≤ 3% → 100 分，≥ 8% → 0 分，线性插值
  const cvScore = Math.max(0, Math.min(100, ((CV_THRESHOLDS.warning - avgCV) / (CV_THRESHOLDS.warning - CV_THRESHOLDS.excellent)) * 100));

  // 4. 残差分布（用全局 Hill 参数回代）
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
  // 评分：σ ≤ 5 → 100 分，σ ≥ 30 → 0 分
  const residualScore = Math.max(0, Math.min(100, ((30 - residualStd) / 25) * 100));

  return {
    cvPoints,
    avgCV,
    cvScore,
    residualStats,
    allResiduals,
    residualMean,
    residualStd,
    residualScore,
    perFileFits,
    globalFit,
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
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const SERIES_COLORS = [
  'oklch(0.70 0.18 200)',  // 蓝
  'oklch(0.72 0.20 145)',  // 绿
  'oklch(0.70 0.20 55)',   // 橙
  'oklch(0.70 0.18 330)',  // 粉
  'oklch(0.65 0.18 280)',  // 紫
  'oklch(0.75 0.15 80)',   // 黄
  'oklch(0.68 0.20 170)',  // 青
  'oklch(0.70 0.22 25)',   // 红
  'oklch(0.72 0.15 230)',  // 淡蓝
  'oklch(0.68 0.18 120)',  // 黄绿
];

function ConsistencyAnalysisInner({ allSeries }: ConsistencyAnalysisProps) {
  const [expanded, setExpanded] = useState(true);

  // 数据签名缓存，避免重复计算
  const dataSignature = useMemo(() => {
    return allSeries.map(s => `${s.id}:${s.records.length}`).join('|');
  }, [allSeries]);

  const analysis = useMemo(() => {
    return computeAnalysis(allSeries);
  }, [dataSignature]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const { cvPoints, avgCV, cvScore, residualStats, allResiduals, residualMean, residualStd, residualScore } = analysis;

  // CV 折线图数据
  const cvChartData = cvPoints.map(p => ({
    pressure: `${p.pressure}N`,
    cv: Math.round(p.cv * 100) / 100,
    mean: Math.round(p.mean * 10) / 10,
  }));

  // 残差直方图数据
  const histData = buildHistogram(allResiduals, 30);

  // 各文件残差统计柱状图数据
  const fileResidualData = residualStats.map((s, i) => ({
    name: s.fileName.replace(/\.csv$/i, '').slice(0, 15),
    fullName: s.fileName,
    std: Math.round(s.std * 100) / 100,
    maxAbs: Math.round(s.maxAbs * 100) / 100,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
  }));

  // 各文件在关键压力点的散点数据
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
        {/* 评分摘要 */}
        <div className="flex items-center gap-3 ml-auto text-xs font-mono">
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
                  ({analysis.perFileFits.length} 个文件独立拟合)
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
                    {/* 参考线 */}
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
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs font-mono" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid oklch(0.25 0.03 265)' }}>
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
                      domain={[0, 'auto']}
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

          {/* 下半部分：残差分布（左右两图） */}
          <div className="flex gap-4" style={{ borderTop: '1px solid oklch(0.22 0.03 265)', paddingTop: '16px' }}>
            {/* 左图：残差分布直方图 */}
            <div className="flex-1 min-w-0">
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
                    {/* 均值参考线 */}
                    <ReferenceLine
                      x={histData.reduce((closest, d) => Math.abs(d.center - residualMean) < Math.abs(closest.center - residualMean) ? d : closest, histData[0])?.bin}
                      stroke="oklch(0.80 0.18 90)"
                      strokeDasharray="5 3"
                      label={{ value: `μ=${residualMean.toFixed(1)}`, fill: 'oklch(0.80 0.18 90)', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", position: 'top' }}
                    />
                    <Bar dataKey="count" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                      {histData.map((entry, index) => {
                        // 在 ±σ 范围内用亮色，外部用暗色
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
              {/* 统计摘要 */}
              <div className="mt-2 flex gap-4 text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
                <span>均值 μ = {residualMean.toFixed(2)}</span>
                <span>标准差 σ = {residualStd.toFixed(2)}</span>
                <span>范围: [{Math.min(...allResiduals).toFixed(1)}, {Math.max(...allResiduals).toFixed(1)}]</span>
              </div>
            </div>

            {/* 右图：各文件残差统计柱状图 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono font-medium" style={{ color: 'oklch(0.65 0.15 200)' }}>
                  各文件残差统计
                </span>
                <span className="text-xs font-mono" style={{ color: 'oklch(0.40 0.02 240)' }}>
                  (σ 和最大绝对残差)
                </span>
              </div>
              <div style={{ height: '220px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fileResidualData} margin={{ top: 10, right: 20, left: 10, bottom: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.02 240)" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", angle: -30, textAnchor: 'end' }}
                      axisLine={{ stroke: 'oklch(0.30 0.02 240)' }}
                      height={50}
                    />
                    <YAxis
                      tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                      axisLine={{ stroke: 'oklch(0.30 0.02 240)' }}
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
                        if (name === 'std') return [value.toFixed(2), '残差 σ'];
                        if (name === 'maxAbs') return [value.toFixed(2), '最大|残差|'];
                        return [value, name];
                      }}
                      labelFormatter={(label) => {
                        const item = fileResidualData.find(d => d.name === label);
                        return item?.fullName || label;
                      }}
                    />
                    <Bar dataKey="std" name="std" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                      {fileResidualData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} fillOpacity={0.7} />
                      ))}
                    </Bar>
                    <Bar dataKey="maxAbs" name="maxAbs" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                      {fileResidualData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} fillOpacity={0.35} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* 图例说明 */}
              <div className="mt-2 flex gap-4 text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)' }}>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-2 rounded-sm" style={{ background: 'oklch(0.58 0.18 265 / 0.7)' }} />
                  <span>残差 σ</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-2 rounded-sm" style={{ background: 'oklch(0.58 0.18 265 / 0.35)' }} />
                  <span>最大 |残差|</span>
                </div>
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
