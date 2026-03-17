/**
 * ConsistencyChart - 一致性检测多产品对比图表
 * 展示10个产品的均值曲线（线性均值10条曲线）
 */
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { DataRecord } from '@/lib/sensorData';

interface ConsistencyChartProps {
  records: DataRecord[];
  productCount: number;
  samplesPerProduct: number;
}

// 产品颜色（10种）
const PRODUCT_COLORS = [
  'oklch(0.70 0.18 200)',  // 青蓝
  'oklch(0.72 0.20 145)',  // 绿
  'oklch(0.75 0.18 55)',   // 黄
  'oklch(0.65 0.22 25)',   // 橙红
  'oklch(0.68 0.20 310)',  // 紫
  'oklch(0.70 0.18 170)',  // 青绿
  'oklch(0.72 0.15 240)',  // 蓝
  'oklch(0.75 0.20 80)',   // 黄绿
  'oklch(0.65 0.18 350)',  // 粉红
  'oklch(0.70 0.15 280)',  // 蓝紫
];

export default function ConsistencyChart({ records, productCount, samplesPerProduct }: ConsistencyChartProps) {
  if (records.length === 0) {
    return (
      <div className="chart-container p-3 h-full flex items-center justify-center">
        <div className="text-sm font-mono" style={{ color: 'oklch(0.45 0.02 240)' }}>
          暂无一致性数据
        </div>
      </div>
    );
  }

  // 按产品分组，计算每个采样点的压力和ADC Sum
  const chartData: Record<string, any>[] = [];
  for (let s = 0; s < samplesPerProduct; s++) {
    const point: Record<string, any> = { sample: s + 1 };
    for (let p = 0; p < productCount; p++) {
      const idx = p * samplesPerProduct + s;
      if (idx < records.length) {
        point[`p${p + 1}_pressure`] = records[idx].pressure;
        point[`p${p + 1}_adc`] = records[idx].adcSum;
      }
    }
    chartData.push(point);
  }

  // 计算均值曲线
  chartData.forEach(point => {
    const adcValues = Array.from({ length: productCount }, (_, p) => point[`p${p + 1}_adc`]).filter(Boolean);
    if (adcValues.length > 0) {
      point.mean_adc = Math.round(adcValues.reduce((a: number, b: number) => a + b, 0) / adcValues.length);
    }
  });

  return (
    <div className="chart-container p-3 h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono" style={{ color: 'oklch(0.70 0.18 200)' }}>
          一致性 - ADC Sum 多产品对比
        </span>
        <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)' }}>
          {productCount} 个产品 × {samplesPerProduct} 个采样点
        </span>
      </div>
      <div className="flex-1" style={{ minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.03 265)" strokeOpacity={0.5} />
            <XAxis
              dataKey="sample"
              tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
              axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
              tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
              label={{ value: '采样点', position: 'insideBottom', offset: -3, fill: 'oklch(0.50 0.02 240)', fontSize: 10 }}
            />
            <YAxis
              tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
              axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
              tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
              label={{ value: 'ADC Sum', angle: -90, position: 'insideLeft', fill: 'oklch(0.70 0.18 200)', fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{
                background: 'oklch(0.17 0.025 265)',
                border: '1px solid oklch(0.35 0.04 265)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: '10px',
                color: 'oklch(0.85 0.01 220)',
              }}
            />
            {/* 各产品曲线 */}
            {Array.from({ length: productCount }, (_, p) => (
              <Line
                key={`p${p + 1}`}
                type="monotone"
                dataKey={`p${p + 1}_adc`}
                name={`产品${p + 1}`}
                stroke={PRODUCT_COLORS[p % PRODUCT_COLORS.length]}
                strokeWidth={1}
                dot={false}
                opacity={0.6}
              />
            ))}
            {/* 均值曲线（加粗白色） */}
            <Line
              type="monotone"
              dataKey="mean_adc"
              name="均值"
              stroke="oklch(0.92 0.01 220)"
              strokeWidth={2.5}
              dot={false}
              strokeDasharray="none"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
