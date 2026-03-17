/**
 * DataChart - 力学数据与ADC数据图表
 * 显示形式：
 *   横坐标：串口数据上报的力学数据，以N为单位
 *   纵坐标：串口上报的ADC求和数据，以选定区域的串口上报十六进制数组求和
 */
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Brush,
  Area,
} from 'recharts';
import { DataRecord, toHex } from '@/lib/sensorData';

interface DataChartProps {
  records: DataRecord[];
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
}

const CustomTooltip = ({ active, payload }: any) => {
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
        <div style={{ color: 'oklch(0.55 0.02 240)', marginBottom: '4px', fontSize: '10px' }}>
          样本 #{data?.index} · {data?.time}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: 'oklch(0.72 0.20 145)' }}>压力:</span>
            <span style={{ color: 'oklch(0.72 0.20 145)', fontWeight: 600 }}>{data?.pressure} N</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: 'oklch(0.70 0.18 200)' }}>ADC Sum:</span>
            <span style={{ color: 'oklch(0.70 0.18 200)', fontWeight: 600 }}>{data?.adcSum}</span>
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

// 自定义Y轴刻度格式化：同时显示十进制和十六进制
const formatAdcTick = (value: number) => {
  if (value >= 10000) return `${(value / 1000).toFixed(0)}k`;
  return `${value}`;
};

export default function DataChart({ records, title, showBrush = false, referenceLines = [] }: DataChartProps) {
  const chartData: ChartDataPoint[] = records.map((r, i) => ({
    pressure: r.pressure,
    adcSum: r.adcSum,
    adcSumHex: r.adcSumHex || toHex(r.adcSum),
    time: r.time,
    index: i + 1,
  }));

  const hasData = chartData.length > 0;

  return (
    <div className="chart-container p-3 h-full flex flex-col">
      {title && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono" style={{ color: 'oklch(0.70 0.18 200)' }}>
            {title}
          </span>
          <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)' }}>
            {records.length} 个数据点
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
              请选择传感器并开始检测
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1" style={{ minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 15, left: 5, bottom: showBrush ? 30 : 5 }}>
              <defs>
                <linearGradient id="adcSumGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.70 0.18 200)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="oklch(0.70 0.18 200)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="oklch(0.25 0.03 265)"
                strokeOpacity={0.6}
              />
              {/* 横坐标：力学数据（N） */}
              <XAxis
                dataKey="pressure"
                type="number"
                tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                label={{
                  value: '压力 (N)',
                  position: 'insideBottom',
                  offset: showBrush ? -25 : -5,
                  fill: 'oklch(0.72 0.20 145)',
                  fontSize: 10,
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
                domain={['auto', 'auto']}
              />
              {/* 纵坐标：ADC求和 */}
              <YAxis
                yAxisId="left"
                tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                tickFormatter={formatAdcTick}
                label={{
                  value: 'ADC Sum (选定区域)',
                  angle: -90,
                  position: 'insideLeft',
                  fill: 'oklch(0.70 0.18 200)',
                  fontSize: 10,
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{
                  fontSize: '11px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: 'oklch(0.60 0.02 240)',
                }}
              />
              {referenceLines.map((rl, i) => (
                <ReferenceLine
                  key={i}
                  yAxisId="left"
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
              {/* ADC Sum 面积 + 折线 */}
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="adcSum"
                name="ADC Sum"
                stroke="oklch(0.70 0.18 200)"
                fill="url(#adcSumGradient)"
                strokeWidth={2}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="adcSum"
                name="ADC Sum"
                stroke="oklch(0.70 0.18 200)"
                strokeWidth={2}
                dot={{ r: 2, fill: 'oklch(0.70 0.18 200)' }}
                activeDot={{ r: 5, fill: 'oklch(0.70 0.18 200)', stroke: 'oklch(0.85 0.10 200)', strokeWidth: 2 }}
                legendType="none"
              />
              {showBrush && (
                <Brush
                  dataKey="pressure"
                  height={20}
                  stroke="oklch(0.30 0.03 265)"
                  fill="oklch(0.17 0.025 265)"
                  travellerWidth={6}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
