/**
 * DataChart - 力学数据与ADC数据图表
 * 支持多系列数据（多CSV文件），每个系列用不同颜色绘制
 * 快捷按钮切换X轴范围：20N / 30N / 50N / 70N / 100N(复位)
 * v1.9.0: 集成 Hill 方程拟合 — 自动拟合压力-ADC曲线，显示拟合方程、系数和 ADC→N 反推公式
 * 显示形式：
 *   横坐标：串口数据上报的力学数据，以N为单位
 *   纵坐标：串口上报的ADC求和数据，以选定区域的串口上报十六进制数组求和
 */
import { useState, useMemo, useCallback } from 'react';
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
  Line,
  ComposedChart,
} from 'recharts';
import { DataRecord, toHex } from '@/lib/sensorData';
import {
  fitHill,
  generateFitCurve,
  hillFunc,
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
  title?: string;
  showBrush?: boolean;
  /** 是否启用 Hill 拟合（默认 true） */
  enableFit?: boolean;
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

interface ComposedDataPoint {
  pressure: number;
  adcSum?: number;
  fitAdcSum?: number;
  [key: string]: number | string | undefined;
}

// X轴范围预设
const X_RANGE_PRESETS = [20, 30, 50, 70, 100] as const;

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

// 拟合曲线颜色
const FIT_CURVE_COLOR = 'oklch(0.85 0.22 60)'; // 明亮金黄色

const MultiSeriesTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    // 找到散点数据（非拟合曲线的数据）
    const scatterPayload = payload.find((p: any) => p.dataKey !== 'fitAdcSum');
    const fitPayload = payload.find((p: any) => p.dataKey === 'fitAdcSum');
    const data = scatterPayload?.payload as ChartDataPoint | undefined;

    if (!data && fitPayload) {
      // 只有拟合曲线的 tooltip
      const fitData = fitPayload.payload;
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
            <span style={{ color: 'oklch(0.72 0.20 145)', fontWeight: 600 }}>{fitData?.pressure?.toFixed(2)} N</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: FIT_CURVE_COLOR }}>ADC (拟合):</span>
            <span style={{ color: FIT_CURVE_COLOR, fontWeight: 600 }}>{fitData?.fitAdcSum?.toFixed(1)}</span>
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

/** Hill 拟合参数面板 */
function HillFitPanel({ fit, showFit, onToggle }: { fit: HillFitResult; showFit: boolean; onToggle: () => void }) {
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
      {/* 标题行 + 开关 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
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
        <button
          onClick={onToggle}
          className="px-2 py-0.5 rounded text-xs font-mono transition-all"
          style={{
            background: showFit ? 'oklch(0.85 0.22 60 / 0.2)' : 'oklch(0.20 0.02 265)',
            border: `1px solid ${showFit ? 'oklch(0.85 0.22 60 / 0.5)' : 'oklch(0.30 0.03 265)'}`,
            color: showFit ? FIT_CURVE_COLOR : 'oklch(0.55 0.02 240)',
            fontSize: '10px',
          }}
        >
          {showFit ? '隐藏拟合曲线' : '显示拟合曲线'}
        </button>
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
              ADC = {fit.a.toFixed(2)} &times; P<sup>{fit.n.toFixed(4)}</sup> / ({fit.b.toFixed(2)}<sup>{fit.n.toFixed(4)}</sup> + P<sup>{fit.n.toFixed(4)}</sup>)
            </code>
          </div>

          {/* 系数表 */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono shrink-0" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px' }}>
              拟合系数:
            </span>
            <div className="flex items-center gap-2">
              {[
                { label: 'a (饱和值)', value: fit.a.toFixed(6), desc: 'ADC 最大值' },
                { label: 'b (半饱和压力)', value: fit.b.toFixed(6), desc: 'P=b 时 ADC=a/2' },
                { label: 'n (Hill系数)', value: fit.n.toFixed(6), desc: '曲线陡峭度' },
              ].map(({ label, value }) => (
                <span
                  key={label}
                  className="px-2 py-0.5 rounded text-xs font-mono"
                  style={{
                    background: 'oklch(0.11 0.015 265)',
                    border: '1px solid oklch(0.22 0.03 265)',
                    fontSize: '10px',
                  }}
                >
                  <span style={{ color: 'oklch(0.55 0.02 240)' }}>{label} = </span>
                  <span style={{ color: 'oklch(0.80 0.18 145)', fontWeight: 600 }}>{value}</span>
                </span>
              ))}
            </div>
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
                color: 'oklch(0.80 0.15 60)',
                fontSize: '10px',
                border: '1px solid oklch(0.22 0.03 265)',
                lineHeight: '18px',
              }}
            >
              P(N) = {fit.b.toFixed(2)} &times; (ADC / ({fit.a.toFixed(2)} - ADC))<sup>1/{fit.n.toFixed(4)}</sup>
            </code>
          </div>
        </div>

        {/* 右列：ADC→N 在线计算器 */}
        <div
          className="flex flex-col gap-1 px-2 py-1.5 rounded shrink-0"
          style={{
            background: 'oklch(0.11 0.015 265)',
            border: '1px solid oklch(0.22 0.03 265)',
            width: '200px',
          }}
        >
          <span className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)', fontSize: '9px' }}>
            ADC → N 在线计算
          </span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={adcInput}
              onChange={e => { setAdcInput(e.target.value); setInverseResult(null); }}
              onKeyDown={e => { if (e.key === 'Enter') handleInverse(); }}
              placeholder="输入 ADC 值"
              className="flex-1 px-2 py-1 rounded text-xs font-mono outline-none"
              style={{
                background: 'oklch(0.17 0.025 265)',
                border: '1px solid oklch(0.30 0.03 265)',
                color: 'oklch(0.85 0.05 200)',
                fontSize: '10px',
              }}
            />
            <button
              onClick={handleInverse}
              className="px-2 py-1 rounded text-xs font-mono transition-all"
              style={{
                background: 'oklch(0.85 0.22 60 / 0.15)',
                border: '1px solid oklch(0.85 0.22 60 / 0.3)',
                color: FIT_CURVE_COLOR,
                fontSize: '10px',
              }}
            >
              计算
            </button>
          </div>
          {inverseResult && (
            <span className="text-xs font-mono" style={{ color: 'oklch(0.80 0.15 145)', fontSize: '10px' }}>
              {inverseResult}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DataChart({ records, series, title, enableFit = true }: DataChartProps) {
  // X轴范围状态
  const [xMax, setXMax] = useState<number>(100);
  // 是否显示拟合曲线
  const [showFit, setShowFit] = useState<boolean>(true);

  // 构建多系列数据
  const allSeries = useMemo(() => {
    const result: { name: string; color: string; data: ChartDataPoint[] }[] = [];

    if (series && series.length > 0) {
      series.forEach(s => {
        if (!s.visible) return;
        const data = s.records.map((r, i) => ({
          pressure: r.pressure,
          adcSum: r.adcSum,
          adcSumHex: r.adcSumHex || toHex(r.adcSum),
          time: r.time,
          index: i + 1,
          seriesName: s.name,
          seriesColor: s.color,
        }));
        result.push({ name: s.name, color: s.color, data });
      });
    } else if (records && records.length > 0) {
      const data = records.map((r, i) => ({
        pressure: r.pressure,
        adcSum: r.adcSum,
        adcSumHex: r.adcSumHex || toHex(r.adcSum),
        time: r.time,
        index: i + 1,
        seriesName: '实时采集',
        seriesColor: SERIES_COLORS[0],
      }));
      result.push({ name: '实时采集', color: SERIES_COLORS[0], data });
    }
    return result;
  }, [series, records]);

  // Hill 拟合（合并所有可见系列的数据进行拟合）
  const hillFitResult = useMemo<HillFitResult | null>(() => {
    if (!enableFit) return null;

    // 收集所有可见系列中有 pressure 的数据
    const allPressures: number[] = [];
    const allAdcValues: number[] = [];

    allSeries.forEach(s => {
      s.data.forEach(d => {
        if (d.pressure != null && d.adcSum != null && d.pressure > 0) {
          allPressures.push(d.pressure);
          allAdcValues.push(d.adcSum);
        }
      });
    });

    if (allPressures.length < 5) return null;

    try {
      return fitHill(allPressures, allAdcValues);
    } catch (e) {
      console.error('[Hill Fit] 拟合失败:', e);
      return null;
    }
  }, [allSeries, enableFit]);

  // 生成拟合曲线数据
  const fitCurveData = useMemo(() => {
    if (!hillFitResult || !showFit) return [];
    // 根据当前 X 轴范围生成拟合曲线
    return generateFitCurve(hillFitResult, 0, xMax, 150);
  }, [hillFitResult, showFit, xMax]);

  const hasData = allSeries.some(s => s.data.length > 0);

  return (
    <div className="chart-container p-3 flex flex-col" style={{ minHeight: '480px', height: '100%' }}>
      {title && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono" style={{ color: 'oklch(0.70 0.18 200)' }}>
            {title}
          </span>
          <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)' }}>
            {allSeries.length} 个系列 · {allSeries.reduce((sum, s) => sum + s.data.length, 0)} 个数据点
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
                <ZAxis range={[20, 20]} />
                <Tooltip content={<MultiSeriesTooltip />} />
                <Legend
                  wrapperStyle={{
                    fontSize: '10px',
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: 'oklch(0.60 0.02 240)',
                  }}
                />
                {/* 拟合曲线（放在散点下面，作为背景） */}
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
                    fill="none"
                    line={{ stroke: FIT_CURVE_COLOR, strokeWidth: 2, strokeDasharray: '6 3' }}
                    lineType="joint"
                    shape={() => null}
                  />
                )}
                {/* 多系列散点 */}
                {allSeries.map((s, idx) => (
                  <Scatter
                    key={s.name + idx}
                    name={s.name}
                    data={s.data}
                    fill={s.color}
                    line={{ stroke: s.color, strokeWidth: 1.5 }}
                    lineType="joint"
                    shape="circle"
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Hill 拟合参数面板 */}
          {hillFitResult && (
            <HillFitPanel
              fit={hillFitResult}
              showFit={showFit}
              onToggle={() => setShowFit(v => !v)}
            />
          )}
        </div>
      )}
    </div>
  );
}
