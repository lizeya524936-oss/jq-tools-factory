/**
 * DataChart - 力学数据与ADC数据图表
 * 支持多系列数据（多CSV文件），每个系列用不同颜色绘制
 * 快捷按钮切换X轴范围：20N / 30N / 50N / 70N / 100N(复位)
 * v1.9.0: 集成 Hill 方程拟合 — 自动拟合压力-ADC曲线，显示拟合方程、系数和 ADC→N 反推公式
 * v1.9.1: 修复拟合曲线独立性 — 拟合基于全部数据(含不可见)，取消勾选后拟合曲线保留；修正 Legend 颜色
 * v1.9.2: 性能优化 — 拟合结果缓存（数据签名比较），大数据集降采样，避免重复计算
 * v1.9.3: 彻底修复卡顿 — 散点降采样显示（每系列最多200点），React.memo 防止无关重渲染
 * 显示形式：
 *   横坐标：串口数据上报的力学数据，以N为单位
 *   纵坐标：串口上报的ADC求和数据，以选定区域的串口上报十六进制数组求和
 */
import { useState, useMemo, useCallback, useRef, memo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ZAxis,
} from 'recharts';
import { DataRecord, toHex } from '@/lib/sensorData';
import {
  fitHill,
  generateFitCurve,
  inverseHill,
  type HillFitResult,
} from '@/lib/hillFit';

/** 单个上传文件的数据系列 */
export interface DataSeries {
  id: string;
  name: string;        // 文件名
  records: DataRecord[];
  color: string;       // 曲线颜色
  visible: boolean;    // 是否显示
}

interface DataChartProps {
  /** 单系列模式（向后兼容） */
  records?: DataRecord[];
  /** 多系列模式 */
  series?: DataSeries[];
  /** 全部系列（含不可见的），用于拟合计算 */
  allSeriesForFit?: DataSeries[];
  title?: string;
  showBrush?: boolean;
  /** 是否启用 Hill 拟合（默认 true） */
  enableFit?: boolean;
  /** 拟合曲线显示状态（外部控制） */
  showFitCurve?: boolean;
  /** 拟合曲线显示状态变更回调 */
  onFitCurveToggle?: (show: boolean) => void;
  /** 拟合结果回调（通知父组件拟合结果） */
  onFitResult?: (result: HillFitResult | null) => void;
}

interface ChartDataPoint {
  pressure: number;
  adcSum: number;
  adcSumHex: string;
  time: string;
  index: number;
  seriesName?: string;
  seriesColor?: string;
}

// X轴范围预设
const X_RANGE_PRESETS = [20, 30, 50, 70, 100] as const;

// 每个系列在图表中最多显示的散点数量
const MAX_DISPLAY_POINTS_PER_SERIES = 200;

// 20 种区分度高的颜色
export const SERIES_COLORS = [
  'oklch(0.70 0.18 200)',  // 蓝
  'oklch(0.72 0.20 145)',  // 绿
  'oklch(0.65 0.22 25)',   // 橙红
  'oklch(0.68 0.20 300)',  // 紫
  'oklch(0.75 0.18 80)',   // 黄
  'oklch(0.65 0.20 350)',  // 粉红
  'oklch(0.70 0.15 170)',  // 青
  'oklch(0.60 0.22 50)',   // 深橙
  'oklch(0.72 0.15 260)',  // 淡蓝紫
  'oklch(0.68 0.20 120)',  // 黄绿
  'oklch(0.60 0.18 330)',  // 玫红
  'oklch(0.75 0.12 220)',  // 天蓝
  'oklch(0.65 0.20 70)',   // 琥珀
  'oklch(0.58 0.22 280)',  // 靛蓝
  'oklch(0.72 0.18 160)',  // 翠绿
  'oklch(0.62 0.20 10)',   // 红
  'oklch(0.70 0.15 240)',  // 钢蓝
  'oklch(0.68 0.18 100)',  // 柠檬绿
  'oklch(0.60 0.20 310)',  // 紫罗兰
  'oklch(0.75 0.15 190)',  // 浅青
];

// 拟合曲线颜色（使用标准 CSS 颜色确保 Legend 正确渲染）
const FIT_CURVE_COLOR = '#f0a030';

/**
 * 对数据点数组进行降采样，保留曲线形状特征
 * 策略：按压力值排序后均匀采样，始终保留首尾点和极值点
 */
function downsampleForDisplay(data: ChartDataPoint[], maxPoints: number): ChartDataPoint[] {
  if (data.length <= maxPoints) return data;

  // 按压力值排序
  const sorted = [...data].sort((a, b) => a.pressure - b.pressure);

  // 均匀采样
  const result: ChartDataPoint[] = [];
  const step = (sorted.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(Math.round(i * step), sorted.length - 1);
    result.push(sorted[idx]);
  }

  return result;
}

const MultiSeriesTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0]?.payload as ChartDataPoint | undefined;
    if (!data) return null;

    // 判断是否为拟合曲线数据点
    if (data.seriesName === 'Hill 拟合') {
      return (
        <div
          className="rounded p-2.5"
          style={{
            background: 'oklch(0.17 0.025 265)',
            border: '1px solid oklch(0.35 0.04 265)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: '11px',
            boxShadow: '0 4px 12px oklch(0 0 0 / 0.4)',
          }}
        >
          <div style={{ color: FIT_CURVE_COLOR, marginBottom: '4px', fontSize: '10px', fontWeight: 600 }}>
            Hill 拟合曲线
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: 'oklch(0.72 0.20 145)' }}>压力:</span>
            <span style={{ color: 'oklch(0.72 0.20 145)', fontWeight: 600 }}>{data?.pressure?.toFixed(2)} N</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: FIT_CURVE_COLOR }}>ADC (拟合):</span>
            <span style={{ color: FIT_CURVE_COLOR, fontWeight: 600 }}>{data?.adcSum?.toFixed(1)}</span>
          </div>
        </div>
      );
    }

    return (
      <div
        className="rounded p-2.5"
        style={{
          background: 'oklch(0.17 0.025 265)',
          border: '1px solid oklch(0.35 0.04 265)',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: '11px',
          boxShadow: '0 4px 12px oklch(0 0 0 / 0.4)',
        }}
      >
        {data?.seriesName && (
          <div style={{ color: data.seriesColor || 'oklch(0.55 0.02 240)', marginBottom: '4px', fontSize: '10px', fontWeight: 600 }}>
            {data.seriesName}
          </div>
        )}
        <div style={{ color: 'oklch(0.55 0.02 240)', marginBottom: '4px', fontSize: '10px' }}>
          样本 #{data?.index} · {data?.time}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: 'oklch(0.72 0.20 145)' }}>压力:</span>
            <span style={{ color: 'oklch(0.72 0.20 145)', fontWeight: 600 }}>{data?.pressure?.toFixed(2)} N</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: data?.seriesColor || 'oklch(0.70 0.18 200)' }}>ADC Sum:</span>
            <span style={{ color: data?.seriesColor || 'oklch(0.70 0.18 200)', fontWeight: 600 }}>{data?.adcSum}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: 'oklch(0.55 0.15 200)' }}>Hex Sum:</span>
            <span style={{ color: 'oklch(0.55 0.15 200)', fontWeight: 600 }}>{data?.adcSumHex}</span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

// 自定义Y轴刻度格式化
const formatAdcTick = (value: number) => {
  if (value >= 10000) return `${(value / 1000).toFixed(0)}k`;
  return `${value}`;
};

/** 自定义 Legend 渲染器，为拟合曲线使用虚线样式 */
const CustomLegend = ({ payload }: any) => {
  if (!payload || payload.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-1">
      {payload.map((entry: any, index: number) => {
        const isFit = entry.value === 'Hill 拟合';
        return (
          <div key={`legend-${index}`} className="flex items-center gap-1.5" style={{ fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" }}>
            {isFit ? (
              // 拟合曲线用虚线图标
              <svg width="20" height="10">
                <line x1="0" y1="5" x2="20" y2="5" stroke={FIT_CURVE_COLOR} strokeWidth="2" strokeDasharray="4 2" />
              </svg>
            ) : (
              // 普通系列用圆点 + 实线
              <svg width="20" height="10">
                <line x1="0" y1="5" x2="20" y2="5" stroke={entry.color} strokeWidth="1.5" />
                <circle cx="10" cy="5" r="3" fill={entry.color} />
              </svg>
            )}
            <span style={{ color: entry.color || 'oklch(0.60 0.02 240)' }}>
              {entry.value}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/** Hill 拟合参数面板 */
function HillFitPanel({ fit }: { fit: HillFitResult }) {
  const [adcInput, setAdcInput] = useState('');
  const [inverseResult, setInverseResult] = useState<string | null>(null);

  const handleInverse = useCallback(() => {
    const adcVal = parseFloat(adcInput);
    if (isNaN(adcVal)) {
      setInverseResult('请输入有效的 ADC 值');
      return;
    }
    const result = inverseHill(adcVal, fit.a, fit.b, fit.n);
    if (result.status === 'valid' && result.pressure !== null) {
      setInverseResult(`${adcVal} → ${result.pressure.toFixed(4)} N`);
    } else if (result.status === 'zero') {
      setInverseResult('ADC ≤ 0，无意义');
    } else if (result.status === 'saturated') {
      setInverseResult(`ADC ≥ a(${fit.a.toFixed(2)})，已饱和`);
    } else if (result.status === 'out_of_range') {
      setInverseResult(`超出范围: ${result.pressure?.toFixed(2)} N`);
    }
  }, [adcInput, fit]);

  return (
    <div
      className="rounded px-3 py-2 mt-1"
      style={{
        background: 'oklch(0.14 0.02 265)',
        border: `1px solid oklch(0.25 0.03 265)`,
      }}
    >
      {/* 标题行 */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-mono font-semibold" style={{ color: FIT_CURVE_COLOR }}>
          Hill 方程拟合
        </span>
        <span
          className="px-1.5 py-0.5 rounded text-xs font-mono"
          style={{
            background: fit.r2 >= 0.99 ? 'oklch(0.72 0.20 145 / 0.15)' : fit.r2 >= 0.95 ? 'oklch(0.75 0.18 80 / 0.15)' : 'oklch(0.65 0.22 25 / 0.15)',
            color: fit.r2 >= 0.99 ? 'oklch(0.72 0.20 145)' : fit.r2 >= 0.95 ? 'oklch(0.75 0.18 80)' : 'oklch(0.65 0.22 25)',
            fontSize: '9px',
          }}
        >
          R² = {fit.r2.toFixed(6)}
        </span>
        <span
          className="px-1.5 py-0.5 rounded text-xs font-mono"
          style={{
            background: 'oklch(0.20 0.02 265)',
            color: 'oklch(0.55 0.02 240)',
            fontSize: '9px',
          }}
        >
          RMSE = {fit.rmse.toFixed(4)}
        </span>
        <span
          className="px-1.5 py-0.5 rounded text-xs font-mono"
          style={{
            background: 'oklch(0.20 0.02 265)',
            color: 'oklch(0.55 0.02 240)',
            fontSize: '9px',
          }}
        >
          {fit.method === 'hill' ? 'Hill 3参数' : fit.method === 'hyperbolic' ? '双曲线 (n=1)' : '兜底估计'}
        </span>
      </div>

      {/* 拟合方程和系数 — 两列布局 */}
      <div className="flex gap-4">
        {/* 左列：方程和系数 */}
        <div className="flex-1 flex flex-col gap-1.5">
          {/* 正向方程 */}
          <div className="flex items-start gap-2">
            <span className="text-xs font-mono shrink-0" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px', lineHeight: '18px' }}>
              拟合方程:
            </span>
            <code
              className="text-xs font-mono px-2 py-0.5 rounded"
              style={{
                background: 'oklch(0.11 0.015 265)',
                color: 'oklch(0.80 0.15 200)',
                fontSize: '10px',
                border: '1px solid oklch(0.22 0.03 265)',
                lineHeight: '18px',
              }}
            >
              ADC = {fit.a.toFixed(2)} &times; P<sup>{fit.n.toFixed(4)}</sup> / ({fit.b.toFixed(4)}<sup>{fit.n.toFixed(4)}</sup> + P<sup>{fit.n.toFixed(4)}</sup>)
            </code>
          </div>

          {/* 系数 */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px' }}>系数:</span>
            <code className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'oklch(0.11 0.015 265)', color: 'oklch(0.75 0.18 80)', fontSize: '9px', border: '1px solid oklch(0.22 0.03 265)' }}>
              a = {fit.a.toFixed(4)}
            </code>
            <code className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'oklch(0.11 0.015 265)', color: 'oklch(0.72 0.20 145)', fontSize: '9px', border: '1px solid oklch(0.22 0.03 265)' }}>
              b = {fit.b.toFixed(4)}
            </code>
            <code className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'oklch(0.11 0.015 265)', color: 'oklch(0.68 0.20 300)', fontSize: '9px', border: '1px solid oklch(0.22 0.03 265)' }}>
              n = {fit.n.toFixed(4)}
            </code>
          </div>

          {/* 反推公式 */}
          <div className="flex items-start gap-2">
            <span className="text-xs font-mono shrink-0" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px', lineHeight: '18px' }}>
              ADC→N:
            </span>
            <code
              className="text-xs font-mono px-2 py-0.5 rounded"
              style={{
                background: 'oklch(0.11 0.015 265)',
                color: 'oklch(0.72 0.20 145)',
                fontSize: '10px',
                border: '1px solid oklch(0.22 0.03 265)',
                lineHeight: '18px',
              }}
            >
              P(N) = {fit.b.toFixed(4)} &times; (ADC / ({fit.a.toFixed(2)} - ADC))<sup>1/{fit.n.toFixed(4)}</sup>
            </code>
          </div>
        </div>

        {/* 右列：在线计算器 */}
        <div
          className="flex flex-col gap-1.5 px-3 py-2 rounded"
          style={{
            background: 'oklch(0.11 0.015 265)',
            border: '1px solid oklch(0.22 0.03 265)',
            minWidth: '180px',
          }}
        >
          <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px' }}>
            ADC → N 在线计算
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={adcInput}
              onChange={(e) => setAdcInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleInverse()}
              placeholder="输入 ADC 值"
              className="flex-1 px-2 py-1 rounded text-xs font-mono"
              style={{
                background: 'oklch(0.17 0.025 265)',
                border: '1px solid oklch(0.30 0.03 265)',
                color: 'oklch(0.85 0.12 200)',
                fontSize: '10px',
                outline: 'none',
              }}
            />
            <button
              onClick={handleInverse}
              className="px-2 py-1 rounded text-xs font-mono"
              style={{
                background: 'oklch(0.70 0.18 200 / 0.2)',
                border: '1px solid oklch(0.70 0.18 200 / 0.4)',
                color: 'oklch(0.85 0.12 200)',
                fontSize: '10px',
              }}
            >
              计算
            </button>
          </div>
          {inverseResult && (
            <div className="text-xs font-mono" style={{ color: 'oklch(0.72 0.20 145)', fontSize: '10px' }}>
              {inverseResult}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 计算数据签名：用于快速判断拟合输入数据是否变化
 * 采样关键位置的 pressure 和 adcSum 值，生成一个字符串签名
 */
function computeDataSignature(allPressures: number[], allAdcValues: number[]): string {
  const n = allPressures.length;
  if (n === 0) return 'empty';
  // 采样最多 20 个关键位置（首、尾、均匀分布）
  const sampleCount = Math.min(20, n);
  const parts: string[] = [`n=${n}`];
  for (let i = 0; i < sampleCount; i++) {
    const idx = Math.floor(i * (n - 1) / Math.max(1, sampleCount - 1));
    parts.push(`${allPressures[idx].toFixed(2)}:${allAdcValues[idx].toFixed(1)}`);
  }
  return parts.join('|');
}

/**
 * DataChart 组件 — 使用 React.memo 避免父组件无关状态变化导致重渲染
 */
const DataChart = memo(function DataChart({
  records,
  series,
  allSeriesForFit,
  title,
  enableFit = true,
  showFitCurve: externalShowFit,
  onFitCurveToggle,
  onFitResult,
}: DataChartProps) {
  // X轴范围状态
  const [xMax, setXMax] = useState<number>(100);
  // 内部拟合曲线显示状态（当外部不控制时使用）
  const [internalShowFit, setInternalShowFit] = useState<boolean>(true);

  // 最终的 showFit 状态：优先使用外部控制
  const showFit = externalShowFit !== undefined ? externalShowFit : internalShowFit;
  const toggleShowFit = useCallback(() => {
    if (onFitCurveToggle) {
      onFitCurveToggle(!showFit);
    } else {
      setInternalShowFit(v => !v);
    }
  }, [showFit, onFitCurveToggle]);

  // ─── 拟合结果缓存 ───
  const fitCacheRef = useRef<{
    signature: string;
    result: HillFitResult | null;
  }>({ signature: '', result: null });

  // 构建可见系列数据（用于图表绘制），并进行降采样
  const visibleSeries = useMemo(() => {
    const result: { name: string; color: string; data: ChartDataPoint[]; totalCount: number }[] = [];

    if (series && series.length > 0) {
      series.forEach(s => {
        if (!s.visible) return;
        const allData = s.records.map((r, i) => ({
          pressure: r.pressure,
          adcSum: r.adcSum,
          adcSumHex: r.adcSumHex || toHex(r.adcSum),
          time: r.time,
          index: i + 1,
          seriesName: s.name,
          seriesColor: s.color,
        }));
        // 降采样：每个系列最多显示 MAX_DISPLAY_POINTS_PER_SERIES 个点
        const displayData = downsampleForDisplay(allData, MAX_DISPLAY_POINTS_PER_SERIES);
        result.push({ name: s.name, color: s.color, data: displayData, totalCount: allData.length });
      });
    } else if (records && records.length > 0) {
      const allData = records.map((r, i) => ({
        pressure: r.pressure,
        adcSum: r.adcSum,
        adcSumHex: r.adcSumHex || toHex(r.adcSum),
        time: r.time,
        index: i + 1,
        seriesName: '实时采集',
        seriesColor: SERIES_COLORS[0],
      }));
      const displayData = downsampleForDisplay(allData, MAX_DISPLAY_POINTS_PER_SERIES);
      result.push({ name: '实时采集', color: SERIES_COLORS[0], data: displayData, totalCount: allData.length });
    }
    return result;
  }, [series, records]);

  // Hill 拟合 — 基于全部数据（包括不可见的系列），带缓存机制避免重复计算
  const hillFitResult = useMemo<HillFitResult | null>(() => {
    if (!enableFit) return null;

    const allPressures: number[] = [];
    const allAdcValues: number[] = [];

    // 优先使用 allSeriesForFit（含不可见系列），否则使用 series/records
    const fitSource = allSeriesForFit || series;

    if (fitSource && fitSource.length > 0) {
      fitSource.forEach(s => {
        s.records.forEach(r => {
          if (r.pressure != null && r.adcSum != null && r.pressure > 0) {
            allPressures.push(r.pressure);
            allAdcValues.push(r.adcSum);
          }
        });
      });
    } else if (records && records.length > 0) {
      records.forEach(r => {
        if (r.pressure != null && r.adcSum != null && r.pressure > 0) {
          allPressures.push(r.pressure);
          allAdcValues.push(r.adcSum);
        }
      });
    }

    if (allPressures.length < 5) return null;

    // 计算数据签名，与缓存比较
    const signature = computeDataSignature(allPressures, allAdcValues);
    if (signature === fitCacheRef.current.signature) {
      // 数据没变，直接返回缓存结果
      return fitCacheRef.current.result;
    }

    // 数据变了，重新拟合
    try {
      const result = fitHill(allPressures, allAdcValues);
      fitCacheRef.current = { signature, result };
      return result;
    } catch (e) {
      console.error('[Hill Fit] 拟合失败:', e);
      fitCacheRef.current = { signature, result: null };
      return null;
    }
  }, [allSeriesForFit, series, records, enableFit]);

  // 通知父组件拟合结果
  useMemo(() => {
    onFitResult?.(hillFitResult);
  }, [hillFitResult, onFitResult]);

  // 生成拟合曲线数据（只需要少量点即可画出平滑曲线）
  const fitCurveData = useMemo(() => {
    if (!hillFitResult || !showFit) return [];
    return generateFitCurve(hillFitResult, 0, xMax, 100);
  }, [hillFitResult, showFit, xMax]);

  // 判断是否有数据可显示（可见系列有数据，或者拟合曲线有数据）
  const hasVisibleData = visibleSeries.some(s => s.data.length > 0);
  const hasFitData = fitCurveData.length > 0;
  const hasData = hasVisibleData || hasFitData;

  // 统计总数据点数
  const totalDisplayPoints = visibleSeries.reduce((sum, s) => sum + s.data.length, 0);
  const totalRawPoints = visibleSeries.reduce((sum, s) => sum + s.totalCount, 0);

  return (
    <div className="chart-container p-3 flex flex-col" style={{ minHeight: '480px', height: '100%' }}>
      {title && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono" style={{ color: 'oklch(0.70 0.18 200)' }}>
            {title}
          </span>
          <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)' }}>
            {visibleSeries.length} 个系列 · {totalDisplayPoints} 个显示点
            {totalRawPoints > totalDisplayPoints && (
              <span style={{ color: 'oklch(0.40 0.02 240)' }}> (原始 {totalRawPoints})</span>
            )}
          </span>
        </div>
      )}

      {!hasData ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-sm font-mono mb-1" style={{ color: 'oklch(0.45 0.02 240)' }}>
              暂无数据
            </div>
            <div className="text-xs font-mono" style={{ color: 'oklch(0.35 0.02 240)' }}>
              请选择传感器并开始检测，或上传 CSV 文件
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
          {/* X轴范围快捷按钮 */}
          <div className="flex items-center gap-1.5 mb-1.5" style={{ minHeight: '24px' }}>
            <span className="text-xs font-mono mr-1" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px' }}>
              X轴范围:
            </span>
            {X_RANGE_PRESETS.map(val => (
              <button
                key={val}
                onClick={() => setXMax(val)}
                className="px-2 py-0.5 rounded text-xs font-mono transition-all"
                style={{
                  background: xMax === val ? 'oklch(0.70 0.18 200 / 0.25)' : 'oklch(0.20 0.02 265)',
                  border: `1px solid ${xMax === val ? 'oklch(0.70 0.18 200 / 0.6)' : 'oklch(0.30 0.03 265)'}`,
                  color: xMax === val ? 'oklch(0.85 0.12 200)' : 'oklch(0.55 0.02 240)',
                  fontSize: '10px',
                  fontWeight: xMax === val ? 600 : 400,
                }}
              >
                {val === 100 ? '100N (全部)' : `${val}N`}
              </button>
            ))}
            {/* 降采样提示 */}
            {totalRawPoints > totalDisplayPoints && (
              <span className="ml-2 text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px' }}>
                已降采样显示 ({totalDisplayPoints}/{totalRawPoints} 点)
              </span>
            )}
          </div>

          <div className="flex-1" style={{ minHeight: '400px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="oklch(0.25 0.03 265)"
                  strokeOpacity={0.6}
                />
                {/* 横坐标：力学数据（N） */}
                <XAxis
                  dataKey="pressure"
                  type="number"
                  name="压力"
                  tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                  axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                  tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                  label={{
                    value: '压力 (N)',
                    position: 'insideBottom',
                    offset: -5,
                    fill: 'oklch(0.72 0.20 145)',
                    fontSize: 10,
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                  domain={[0, xMax]}
                  allowDataOverflow={true}
                />
                {/* 纵坐标：ADC求和 */}
                <YAxis
                  dataKey="adcSum"
                  type="number"
                  name="ADC Sum"
                  tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                  axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                  tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                  tickFormatter={formatAdcTick}
                  label={{
                    value: 'ADC Sum',
                    angle: -90,
                    position: 'insideLeft',
                    fill: 'oklch(0.70 0.18 200)',
                    fontSize: 10,
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                  domain={['auto', 'auto']}
                />
                <ZAxis range={[15, 15]} />
                <Tooltip content={<MultiSeriesTooltip />} />
                <Legend content={<CustomLegend />} />
                {/* 拟合曲线 — 使用 Scatter + line */}
                {showFit && fitCurveData.length > 0 && (
                  <Scatter
                    name="Hill 拟合"
                    data={fitCurveData.map(p => ({
                      pressure: p.pressure,
                      adcSum: p.adcSum,
                      seriesName: 'Hill 拟合',
                      seriesColor: FIT_CURVE_COLOR,
                      time: '',
                      index: 0,
                      adcSumHex: '',
                    }))}
                    fill={FIT_CURVE_COLOR}
                    line={{ stroke: FIT_CURVE_COLOR, strokeWidth: 2, strokeDasharray: '6 3' }}
                    lineType="joint"
                    shape={() => <></>}
                    legendType="line"
                    isAnimationActive={false}
                  />
                )}
                {/* 多系列散点（已降采样） */}
                {visibleSeries.map((s, idx) => (
                  <Scatter
                    key={s.name + idx}
                    name={s.name}
                    data={s.data}
                    fill={s.color}
                    line={{ stroke: s.color, strokeWidth: 1.5 }}
                    lineType="joint"
                    shape="circle"
                    isAnimationActive={false}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Hill 拟合参数面板 */}
          {hillFitResult && (
            <HillFitPanel fit={hillFitResult} />
          )}
        </div>
      )}
    </div>
  );
});

export default DataChart;
