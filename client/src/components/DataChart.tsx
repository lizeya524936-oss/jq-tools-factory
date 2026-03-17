/**
 * DataChart - 力学数据与ADC数据图表
 * 支持多系列数据（多CSV文件），每个系列用不同颜色绘制
 * 支持框选缩放和复位功能
 * 显示形式：
 *   横坐标：串口数据上报的力学数据，以N为单位
 *   纵坐标：串口上报的ADC求和数据，以选定区域的串口上报十六进制数组求和
 */
import { useState, useCallback, useRef, useMemo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ZAxis,
  ReferenceArea,
} from 'recharts';
import { DataRecord, toHex } from '@/lib/sensorData';

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
  referenceLines?: { value: number; axis: 'left' | 'right'; label: string }[];
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

interface ZoomState {
  xMin: number | 'auto';
  xMax: number | 'auto';
  yMin: number | 'auto';
  yMax: number | 'auto';
}

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

const MultiSeriesTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0]?.payload as ChartDataPoint;
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

const DEFAULT_ZOOM: ZoomState = { xMin: 'auto', xMax: 'auto', yMin: 'auto', yMax: 'auto' };

export default function DataChart({ records, series, title, showBrush = false, referenceLines = [] }: DataChartProps) {
  // 缩放状态
  const [zoom, setZoom] = useState<ZoomState>(DEFAULT_ZOOM);
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState<{ x: number; y: number } | null>(null);
  const [selEnd, setSelEnd] = useState<{ x: number; y: number } | null>(null);
  const isZoomed = zoom.xMin !== 'auto' || zoom.xMax !== 'auto' || zoom.yMin !== 'auto' || zoom.yMax !== 'auto';

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

  const hasData = allSeries.some(s => s.data.length > 0);

  // 框选缩放处理
  const handleMouseDown = useCallback((e: any) => {
    if (e && e.xValue !== undefined && e.yValue !== undefined) {
      setSelecting(true);
      setSelStart({ x: e.xValue, y: e.yValue });
      setSelEnd(null);
    }
  }, []);

  const handleMouseMove = useCallback((e: any) => {
    if (selecting && e && e.xValue !== undefined && e.yValue !== undefined) {
      setSelEnd({ x: e.xValue, y: e.yValue });
    }
  }, [selecting]);

  const handleMouseUp = useCallback(() => {
    if (selecting && selStart && selEnd) {
      const xMin = Math.min(selStart.x, selEnd.x);
      const xMax = Math.max(selStart.x, selEnd.x);
      const yMin = Math.min(selStart.y, selEnd.y);
      const yMax = Math.max(selStart.y, selEnd.y);

      // 只有当框选区域足够大时才缩放（避免误触）
      const xRange = xMax - xMin;
      const yRange = yMax - yMin;
      if (xRange > 0.5 || yRange > 10) {
        // 添加 5% 的边距
        const xPad = xRange * 0.05;
        const yPad = yRange * 0.05;
        setZoom({
          xMin: Math.max(0, xMin - xPad),
          xMax: xMax + xPad,
          yMin: Math.max(0, yMin - yPad),
          yMax: yMax + yPad,
        });
      }
    }
    setSelecting(false);
    setSelStart(null);
    setSelEnd(null);
  }, [selecting, selStart, selEnd]);

  const handleReset = useCallback(() => {
    setZoom(DEFAULT_ZOOM);
  }, []);

  return (
    <div className="chart-container p-3 h-full flex flex-col">
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
          {/* 缩放控制栏 */}
          <div className="flex items-center gap-2 mb-1" style={{ minHeight: '22px' }}>
            <span className="text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px' }}>
              {isZoomed
                ? `X: ${typeof zoom.xMin === 'number' ? zoom.xMin.toFixed(1) : '?'}~${typeof zoom.xMax === 'number' ? zoom.xMax.toFixed(1) : '?'} N | Y: ${typeof zoom.yMin === 'number' ? zoom.yMin.toFixed(0) : '?'}~${typeof zoom.yMax === 'number' ? zoom.yMax.toFixed(0) : '?'}`
                : '拖拽框选区域进行缩放'}
            </span>
            {isZoomed && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono transition-all"
                style={{
                  background: 'oklch(0.65 0.22 25 / 0.15)',
                  border: '1px solid oklch(0.65 0.22 25 / 0.3)',
                  color: 'oklch(0.65 0.22 25)',
                  fontSize: '9px',
                }}
              >
                复位
              </button>
            )}
          </div>

          <div className="flex-1" style={{ minHeight: 0, cursor: 'crosshair' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart
                margin={{ top: 5, right: 15, left: 5, bottom: 5 }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              >
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
                  domain={[zoom.xMin, zoom.xMax]}
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
                  domain={[zoom.yMin, zoom.yMax]}
                  allowDataOverflow={true}
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
                {referenceLines.map((rl, i) => (
                  <ReferenceLine
                    key={i}
                    y={rl.value}
                    stroke="oklch(0.65 0.22 25)"
                    strokeDasharray="4 4"
                    label={{
                      value: rl.label,
                      fill: 'oklch(0.65 0.22 25)',
                      fontSize: 9,
                      fontFamily: "'IBM Plex Mono', monospace",
                    }}
                  />
                ))}
                {/* 框选区域高亮 */}
                {selecting && selStart && selEnd && (
                  <ReferenceArea
                    x1={selStart.x}
                    x2={selEnd.x}
                    y1={selStart.y}
                    y2={selEnd.y}
                    stroke="oklch(0.70 0.18 200)"
                    strokeOpacity={0.8}
                    fill="oklch(0.70 0.18 200)"
                    fillOpacity={0.15}
                    strokeDasharray="4 4"
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
        </div>
      )}
    </div>
  );
}
