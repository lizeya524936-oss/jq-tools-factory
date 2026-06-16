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
import PressureRangeBar from './PressureRangeBar';
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
  hillFunc,
  inverseHill,
  fitInverseHill,
  generateInvFitCurve,
  invHillFunc,
  type HillFitResult,
  type InvHillFitResult,
  formatInvHillEquation,
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
  /** 外部控制的压力范围最大值 */
  pressureMax?: number;
  /** 压力范围变更回调 */
  onPressureMaxChange?: (val: number) => void;
  /** 数据中的最大压力值（用于 PressureRangeBar） */
  dataMaxPressure?: number;
  /** 横纵坐标是否交换（外部控制，可选） */
  axisSwapped?: boolean;
  /** 横纵坐标交换回调 */
  onAxisSwap?: (v: boolean) => void;
}

interface ChartDataPoint {
  pressure: number;
  adcSum: number;
  adcSumHex: string;
  time: string;
  index: number;
  seriesName?: string;
  seriesColor?: string;
  sensorCount: number;
}

// （X轴范围预设已移至 PressureRangeBar 组件）

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

function MultiSeriesTooltipInner({ active, payload, axisSwapped }: { active: boolean; payload: any[]; axisSwapped: boolean }) {
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
            <span style={{ color: axisSwapped ? FIT_CURVE_COLOR : 'oklch(0.72 0.20 145)' }}>{axisSwapped ? 'ADC (拟合):' : '压力:'}</span>
            <span style={{ color: axisSwapped ? FIT_CURVE_COLOR : 'oklch(0.72 0.20 145)', fontWeight: 600 }}>{axisSwapped ? `${data?.adcSum?.toFixed(1)}` : `${data?.pressure?.toFixed(2)} N`}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: axisSwapped ? 'oklch(0.72 0.20 145)' : FIT_CURVE_COLOR }}>{axisSwapped ? '压力 (拟合):' : 'ADC (拟合):'}</span>
            <span style={{ color: axisSwapped ? 'oklch(0.72 0.20 145)' : FIT_CURVE_COLOR, fontWeight: 600 }}>{axisSwapped ? `${data?.pressure?.toFixed(2)} N` : `${data?.adcSum?.toFixed(1)}`}</span>
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
            <span style={{ color: axisSwapped ? 'oklch(0.70 0.18 200)' : 'oklch(0.72 0.20 145)' }}>{axisSwapped ? 'ADC Sum:' : '压力:'}</span>
            <span style={{ color: axisSwapped ? 'oklch(0.70 0.18 200)' : 'oklch(0.72 0.20 145)', fontWeight: 600 }}>{axisSwapped ? `${data?.adcSum}` : `${data?.pressure?.toFixed(2)} N`}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: data?.seriesColor || 'oklch(0.70 0.18 200)' }}>{axisSwapped ? '压力:' : 'ADC Sum:'}</span>
            <span style={{ color: data?.seriesColor || 'oklch(0.70 0.18 200)', fontWeight: 600 }}>{axisSwapped ? `${data?.pressure?.toFixed(2)} N` : `${data?.adcSum}`}</span>
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

// ─── 导出工具函数 ────────────────────────────────────────────────────────────────

/**
 * 生成 Hill 拟合结果的 LaTeX 公式字符串
 */
function generateLatex(fit: HillFitResult, axisSwapped: boolean = false): string {
  const a = fit.a;
  const b = fit.b;
  const n = fit.n;
  // 始终拟合 ADC = f(P)，轴交换时用反函数作为正向公式
  const forwardTitle = axisSwapped
    ? 'Inverse Hill: P = f(ADC) via inverse formula'
    : 'Hill Equation: ADC = f(P)';
  const forwardNum = axisSwapped
    ? `  \\mathrm{P} = ${b.toFixed(4)} \\cdot \\left( \\frac{\\mathrm{ADC}}{${a.toFixed(4)} - \\mathrm{ADC}} \\right)^{\\frac{1}{${n.toFixed(4)}}}`
    : `  \\mathrm{ADC} = ${a.toFixed(4)} \\cdot \\frac{P^{${n.toFixed(4)}}}{${b.toFixed(4)}^{${n.toFixed(4)}} + P^{${n.toFixed(4)}}}`;
  const forwardSym = axisSwapped
    ? 'P = b \\cdot \\left( \\frac{\\mathrm{ADC}}{a - \\mathrm{ADC}} \\right)^{\\frac{1}{n}}'
    : '\\mathrm{ADC} = a \\cdot \\frac{P^{n}}{b^{n} + P^{n}}';
  const inverseNum = axisSwapped
    ? `  \\mathrm{ADC} = ${a.toFixed(4)} \\cdot \\frac{P^{${n.toFixed(4)}}}{${b.toFixed(4)}^{${n.toFixed(4)}} + P^{${n.toFixed(4)}}}`
    : `  P\\,(\\mathrm{N}) = ${b.toFixed(4)} \\cdot \\left( \\frac{\\mathrm{ADC}}{${a.toFixed(4)} - \\mathrm{ADC}} \\right)^{\\frac{1}{${n.toFixed(4)}}}`;
  const inverseSym = axisSwapped
    ? '\\mathrm{ADC} = a \\cdot \\frac{P^{n}}{b^{n} + P^{n}}'
    : 'P = b \\cdot \\left( \\frac{\\mathrm{ADC}}{a - \\mathrm{ADC}} \\right)^{\\frac{1}{n}}';

  const lines: string[] = [];

  lines.push('% ========================================');
  lines.push('% Hill Equation Fitting Result');
  lines.push(`% Direction: ${forwardTitle}`);
  lines.push(`% Method: ${fit.method === 'hill' ? 'Hill 3-parameter' : fit.method === 'hyperbolic' ? 'Hyperbolic (n=1)' : 'Fallback estimate'}`);
  lines.push(`% R^2 = ${fit.r2.toFixed(8)}`);
  lines.push(`% RMSE = ${fit.rmse.toFixed(6)}`);
  lines.push(`% Generated: ${new Date().toISOString()}`);
  lines.push('% ========================================');
  lines.push('');
  lines.push('% --- Forward Formula (symbolic) ---');
  lines.push('\\begin{equation}');
  lines.push(`  ${forwardSym}`);
  lines.push('\\end{equation}');
  lines.push('');
  lines.push('% --- Forward Formula (with coefficients) ---');
  lines.push('\\begin{equation}');
  lines.push(forwardNum);
  lines.push('\\end{equation}');
  lines.push('');
  lines.push('% --- Reverse Formula (symbolic) ---');
  lines.push('\\begin{equation}');
  lines.push(`  ${inverseSym}`);
  lines.push('\\end{equation}');
  lines.push('');
  lines.push('% --- Reverse Formula (with coefficients) ---');
  lines.push('\\begin{equation}');
  lines.push(inverseNum);
  lines.push('\\end{equation}');
  lines.push('');
  lines.push('% --- Coefficients (from ADC = f(P) fit) ---');
  lines.push('\\begin{align}');
  lines.push(`  a &= ${a.toFixed(8)} \\quad &\\text{(saturation value, max ADC)} \\\\`);
  lines.push(`  b &= ${b.toFixed(8)} \\quad &\\text{(half-saturation pressure, N)} \\\\`);
  lines.push(`  n &= ${n.toFixed(8)} \\quad &\\text{(Hill coefficient, steepness)}`);
  lines.push('\\end{align}');
  lines.push('');
  lines.push('% --- Fit Quality ---');
  lines.push('\\begin{align}');
  lines.push(`  R^{2} &= ${fit.r2.toFixed(8)} \\\\`);
  lines.push(`  \\mathrm{RMSE} &= ${fit.rmse.toFixed(6)}`);
  lines.push('\\end{align}');
  lines.push('');

  return lines.join('\n');
}

/**
 * 生成 JSON 格式的拟合结果（含系数、LaTeX 公式、拟合质量）
 */
function generateExportJson(fit: HillFitResult, axisSwapped: boolean = false): string {
  const a = fit.a;
  const b = fit.b;
  const n = fit.n;

  const exportObj = {
    hill_equation: {
      description: axisSwapped
        ? 'Inverse Hill (via standard fit): P = b * (ADC / (a - ADC))^(1/n)'
        : 'Hill Equation: ADC = a * P^n / (b^n + P^n)',
      coefficients: {
        a: { value: a, description: 'Saturation value (max ADC)' },
        b: { value: b, description: 'Half-saturation pressure (N)' },
        n: { value: n, description: 'Hill coefficient (steepness)' },
      },
      fit_quality: {
        r_squared: fit.r2,
        rmse: fit.rmse,
        method: fit.method,
      },
      formulas: {
        forward: axisSwapped ? {
          description: 'ADC to Pressure via inverse formula (shown when swapped)',
          text: `P(N) = ${b.toFixed(4)} * (ADC / (${a.toFixed(4)} - ADC))^(1/${n.toFixed(4)})`,
          latex: `\\mathrm{P} = ${b.toFixed(4)} \\cdot \\left( \\frac{\\mathrm{ADC}}{${a.toFixed(4)} - \\mathrm{ADC}} \\right)^{\\frac{1}{${n.toFixed(4)}}}`,
          latex_symbolic: 'P = b \\cdot \\left( \\frac{\\mathrm{ADC}}{a - \\mathrm{ADC}} \\right)^{\\frac{1}{n}}',
        } : {
          description: 'Pressure to ADC (standard forward)',
          text: `ADC = ${a.toFixed(4)} * P^${n.toFixed(4)} / (${b.toFixed(4)}^${n.toFixed(4)} + P^${n.toFixed(4)})`,
          latex: `\\mathrm{ADC} = ${a.toFixed(4)} \\cdot \\frac{P^{${n.toFixed(4)}}}{${b.toFixed(4)}^{${n.toFixed(4)}} + P^{${n.toFixed(4)}}}`,
          latex_symbolic: '\\mathrm{ADC} = a \\cdot \\frac{P^{n}}{b^{n} + P^{n}}',
        },
        inverse: axisSwapped ? {
          description: 'Pressure to ADC (standard forward, shown as reverse)',
          text: `ADC = ${a.toFixed(4)} * P^${n.toFixed(4)} / (${b.toFixed(4)}^${n.toFixed(4)} + P^${n.toFixed(4)})`,
          latex: `\\mathrm{ADC} = ${a.toFixed(4)} \\cdot \\frac{P^{${n.toFixed(4)}}}{${b.toFixed(4)}^{${n.toFixed(4)}} + P^{${n.toFixed(4)}}}`,
          latex_symbolic: '\\mathrm{ADC} = a \\cdot \\frac{P^{n}}{b^{n} + P^{n}}',
        } : {
          description: 'ADC to Pressure (inverse)',
          text: `P(N) = ${b.toFixed(4)} * (ADC / (${a.toFixed(4)} - ADC))^(1/${n.toFixed(4)})`,
          latex: `P\\,(\\mathrm{N}) = ${b.toFixed(4)} \\cdot \\left( \\frac{\\mathrm{ADC}}{${a.toFixed(4)} - \\mathrm{ADC}} \\right)^{\\frac{1}{${n.toFixed(4)}}}`,
          latex_symbolic: 'P = b \\cdot \\left( \\frac{\\mathrm{ADC}}{a - \\mathrm{ADC}} \\right)^{\\frac{1}{n}}',
        },
      },
    },
    metadata: {
      generated_at: new Date().toISOString(),
      tool: 'JQ Tools Factory - Hill Equation Fitting Engine',
    },
  };

  return JSON.stringify(exportObj, null, 2);
}

/**
 * 触发文件下载
 */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Hill 拟合参数面板 */
function HillFitPanel({ fit, axisSwapped }: { fit: HillFitResult; axisSwapped: boolean }) {
  const [calcInput, setCalcInput] = useState('');
  const [calcResult, setCalcResult] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const handleInverse = useCallback(() => {
    const val = parseFloat(calcInput);
    if (isNaN(val)) {
      setCalcResult(axisSwapped ? '请输入有效的压力值' : '请输入有效的 ADC 值');
      return;
    }
    if (axisSwapped) {
      // 输入压力值 → 用 Hill 正向公式计算 ADC
      const adc = hillFunc(val, fit.a, fit.b, fit.n);
      if (val <= 0) {
        setCalcResult('P ≤ 0，无意义');
      } else if (!isFinite(adc)) {
        setCalcResult('计算出错');
      } else {
        setCalcResult(`${val} N → ${adc.toFixed(4)} ADC`);
      }
    } else {
      // 输入 ADC 值 → 用 Hill 反函数计算压力
      const result = inverseHill(val, fit.a, fit.b, fit.n);
      if (result.status === 'valid' && result.pressure !== null) {
        setCalcResult(`${val} → ${result.pressure.toFixed(4)} N`);
      } else if (result.status === 'zero') {
        setCalcResult('ADC ≤ 0，无意义');
      } else if (result.status === 'saturated') {
        setCalcResult(`ADC ≥ a(${fit.a.toFixed(2)})，已饱和`);
      } else if (result.status === 'out_of_range') {
        setCalcResult(`超出范围: ${result.pressure?.toFixed(2)} N`);
      }
    }
  }, [calcInput, fit, axisSwapped]);

  // 导出 JSON
  const handleExportJson = useCallback(() => {
    const json = generateExportJson(fit, axisSwapped);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadFile(json, `hill_fit_${ts}.json`, 'application/json');
  }, [fit]);

  // 导出 LaTeX
  const handleExportLatex = useCallback(() => {
    const latex = generateLatex(fit, axisSwapped);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadFile(latex, `hill_fit_${ts}.tex`, 'application/x-tex');
  }, [fit]);

  // 复制 LaTeX 到剪贴板
  const handleCopyLatex = useCallback(async () => {
    const latex = generateLatex(fit, axisSwapped);
    try {
      await navigator.clipboard.writeText(latex);
      setCopyStatus('已复制');
      setTimeout(() => setCopyStatus(null), 2000);
    } catch {
      // 备用方案
      const textarea = document.createElement('textarea');
      textarea.value = latex;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopyStatus('已复制');
      setTimeout(() => setCopyStatus(null), 2000);
    }
  }, [fit]);

  // 按钮样式
  const exportBtnStyle = {
    background: 'oklch(0.20 0.02 265)',
    border: '1px solid oklch(0.30 0.03 265)',
    color: 'oklch(0.70 0.12 200)',
    fontSize: '9px',
    padding: '2px 8px',
    borderRadius: '4px',
    cursor: 'pointer' as const,
    fontFamily: "'IBM Plex Mono', monospace",
    transition: 'all 0.15s',
  };

  return (
    <div
      className="rounded px-3 py-2 mt-1"
      style={{
        background: 'oklch(0.14 0.02 265)',
        border: `1px solid oklch(0.25 0.03 265)`,
      }}
    >
      {/* 标题行 + 导出按钮 */}
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

        {/* 导出按钮组 */}
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={handleExportJson} style={exportBtnStyle} title="导出拟合系数和公式为 JSON 文件">
            ⬇ JSON
          </button>
          <button onClick={handleExportLatex} style={exportBtnStyle} title="导出拟合方程和反推公式为 LaTeX (.tex) 文件">
            ⬇ LaTeX
          </button>
          <button
            onClick={handleCopyLatex}
            style={{
              ...exportBtnStyle,
              color: copyStatus ? 'oklch(0.72 0.20 145)' : exportBtnStyle.color,
              borderColor: copyStatus ? 'oklch(0.72 0.20 145 / 0.4)' : exportBtnStyle.border.split(' ').pop(),
            }}
            title="复制 LaTeX 公式到剪贴板"
          >
            {copyStatus || '⎘ 复制 LaTeX'}
          </button>
        </div>
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
              {axisSwapped
                ? `P = ${fit.b.toFixed(4)} × (ADC / (${fit.a.toFixed(2)} - ADC))^(1/${fit.n.toFixed(4)})`
                : `ADC = ${fit.a.toFixed(2)} × P^${fit.n.toFixed(4)} / (${fit.b.toFixed(4)}^${fit.n.toFixed(4)} + P^${fit.n.toFixed(4)})`}
            </code>
          </div>

          {/* 系数 */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px' }}>系数:</span>
            <code className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'oklch(0.11 0.015 265)', color: 'oklch(0.75 0.18 80)', fontSize: '9px', border: '1px solid oklch(0.22 0.03 265)' }}>
              a = {fit.a.toFixed(4)} <span style={{ color: 'oklch(0.45 0.02 240)', fontSize: '8px' }}>(max ADC)</span>
            </code>
            <code className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'oklch(0.11 0.015 265)', color: 'oklch(0.72 0.20 145)', fontSize: '9px', border: '1px solid oklch(0.22 0.03 265)' }}>
              b = {fit.b.toFixed(4)} <span style={{ color: 'oklch(0.45 0.02 240)', fontSize: '8px' }}>(半饱和 N)</span>
            </code>
            <code className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'oklch(0.11 0.015 265)', color: 'oklch(0.68 0.20 300)', fontSize: '9px', border: '1px solid oklch(0.22 0.03 265)' }}>
              n = {fit.n.toFixed(4)}
            </code>
          </div>

          {/* 反推公式 */}
          <div className="flex items-start gap-2">
            <span className="text-xs font-mono shrink-0" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px', lineHeight: '18px' }}>
              {axisSwapped ? 'P→ADC:' : 'ADC→N:'}
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
              {axisSwapped
                ? `ADC = ${fit.a.toFixed(2)} × P^${fit.n.toFixed(4)} / (${fit.b.toFixed(4)}^${fit.n.toFixed(4)} + P^${fit.n.toFixed(4)})`
                : `P(N) = ${fit.b.toFixed(4)} × (ADC / (${fit.a.toFixed(2)} - ADC))^(1/${fit.n.toFixed(4)})`}
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
            {axisSwapped ? 'P → ADC 在线计算' : 'ADC → N 在线计算'}
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={calcInput}
              onChange={(e) => setCalcInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleInverse()}
              placeholder={axisSwapped ? '输入压力值 (N)' : '输入 ADC 值'}
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
          {calcResult && (
            <div className="text-xs font-mono" style={{ color: 'oklch(0.72 0.20 145)', fontSize: '10px' }}>
              {calcResult}
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
  pressureMax: externalPressureMax,
  onPressureMaxChange,
  dataMaxPressure,
  axisSwapped: externalAxisSwapped,
  onAxisSwap,
}: DataChartProps) {
  // X轴范围状态：优先使用外部控制
  const [internalXMax, setInternalXMax] = useState<number>(100);
  const xMax = externalPressureMax !== undefined ? externalPressureMax : internalXMax;
  const setXMax = useCallback((val: number) => {
    if (onPressureMaxChange) {
      onPressureMaxChange(val);
    } else {
      setInternalXMax(val);
    }
  }, [onPressureMaxChange]);
  // 内部拟合曲线显示状态（当外部不控制时使用）
  const [internalShowFit, setInternalShowFit] = useState<boolean>(true);
  // 横纵坐标交换状态
  const [internalAxisSwapped, setInternalAxisSwapped] = useState<boolean>(false);
  // SUM/AVG 切换状态
  const [showAvg, setShowAvg] = useState<boolean>(false);
  const axisSwapped = externalAxisSwapped !== undefined ? externalAxisSwapped : internalAxisSwapped;
  const toggleAxisSwap = useCallback(() => {
    const next = !axisSwapped;
    if (onAxisSwap) {
      onAxisSwap(next);
    } else {
      setInternalAxisSwapped(next);
    }
  }, [axisSwapped, onAxisSwap]);

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
          sensorCount: r.adcValues?.length || 1,
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
        sensorCount: r.adcValues?.length || 1,
      }));
      const displayData = downsampleForDisplay(allData, MAX_DISPLAY_POINTS_PER_SERIES);
      result.push({ name: '实时采集', color: SERIES_COLORS[0], data: displayData, totalCount: allData.length });
    }
    return result;
  }, [series, records]);

  // SUM/AVG 切换：当 showAvg 时，将 adcSum 除以传感器数量
  const displaySeries = useMemo(() => {
    if (!showAvg) return visibleSeries;
    return visibleSeries.map(s => ({
      ...s,
      data: s.data.map(d => ({
        ...d,
        adcSum: d.sensorCount > 0 ? d.adcSum / d.sensorCount : d.adcSum,
      })),
    }));
  }, [visibleSeries, showAvg]);

  // Hill 拟合 / Inverse Hill 拟合 — 基于全部数据，带缓存机制
  // axisSwapped=false → Hill 正向: ADC = f(P)
  // axisSwapped=true  → Inverse Hill: P = f(ADC)
  const hillFitResult = useMemo<HillFitResult | null>(() => {
    if (!enableFit) return null;

    const allPressures: number[] = [];
    const allAdcValues: number[] = [];

    const fitSource = allSeriesForFit || series;
    const pressureCeiling = xMax;

    if (fitSource && fitSource.length > 0) {
      fitSource.forEach(s => {
        s.records.forEach(r => {
          if (r.pressure != null && r.adcSum != null && r.pressure > 0 && r.pressure <= pressureCeiling) {
            const sensorCount = r.adcValues?.length || 1;
            allPressures.push(r.pressure);
            allAdcValues.push(showAvg ? r.adcSum / sensorCount : r.adcSum);
          }
        });
      });
    } else if (records && records.length > 0) {
      records.forEach(r => {
        if (r.pressure != null && r.adcSum != null && r.pressure > 0 && r.pressure <= pressureCeiling) {
          const sensorCount = r.adcValues?.length || 1;
          allPressures.push(r.pressure);
          allAdcValues.push(showAvg ? r.adcSum / sensorCount : r.adcSum);
        }
      });
    }

    if (allPressures.length < 5) return null;

    const signature = `range=${pressureCeiling}|swapped=${axisSwapped}|avg=${showAvg}|` + computeDataSignature(allPressures, allAdcValues);
    if (signature === fitCacheRef.current.signature) {
      return fitCacheRef.current.result;
    }

    try {
      if (axisSwapped) {
        // v1.6: Inverse Hill — P = f(ADC)
        const invResult = fitInverseHill(allAdcValues, allPressures);
        if (!invResult) {
          fitCacheRef.current = { signature, result: null };
          return null;
        }
        // 转换为 HillFitResult 兼容格式（复用 a= Vmax, b= K, n= n）
        const result: HillFitResult = {
          a: invResult.Vmax, b: invResult.K, n: invResult.n,
          rmse: invResult.rmse, r2: invResult.r2,
          method: 'hill', // 标记为 hill 以兼容现有 UI
        };
        fitCacheRef.current = { signature, result };
        return result;
      } else {
        const result = fitHill(allPressures, allAdcValues);
        fitCacheRef.current = { signature, result };
        return result;
      }
    } catch (e) {
      console.error('[Hill Fit] 拟合失败:', e);
      fitCacheRef.current = { signature, result: null };
      return null;
    }
  }, [allSeriesForFit, series, records, enableFit, xMax, axisSwapped, showAvg]);

  // 通知父组件拟合结果
  useMemo(() => {
    onFitResult?.(hillFitResult);
  }, [hillFitResult, onFitResult]);

  // 生成拟合曲线数据
  const fitCurveData = useMemo(() => {
    if (!hillFitResult || !showFit) return [];
    if (axisSwapped) {
      // v1.6: 使用 Inverse Hill 拟合直接生成的曲线
      const allAdcValues = (allSeriesForFit || series || []).flatMap(s =>
        s.records.filter(r => r.pressure != null && r.adcSum != null && r.pressure > 0 && r.pressure <= xMax).map(r => r.adcSum)
      );
      if (allAdcValues.length === 0 && records) {
        records.filter(r => r.pressure != null && r.adcSum != null && r.pressure > 0 && r.pressure <= xMax).forEach(r => allAdcValues.push(r.adcSum));
      }
      const adcMax = allAdcValues.length > 0 ? Math.max(...allAdcValues) * 1.05 : 5000;
      const invFit: InvHillFitResult = { Vmax: hillFitResult.a, K: hillFitResult.b, n: hillFitResult.n, rmse: hillFitResult.rmse, r2: hillFitResult.r2, method: 'inv_hill' };
      const curvePoints = generateInvFitCurve(invFit, 0, adcMax, 100);
      return curvePoints.map(p => ({ pressure: p.pressure, adcSum: p.adc }));
    }
    return generateFitCurve(hillFitResult, 0, xMax, 100);
  }, [hillFitResult, showFit, xMax, axisSwapped, allSeriesForFit, series, records]);

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
          {/* 压力范围控制栏（横纵交换时隐藏，因为 X 轴不再是压力） */}
          {!axisSwapped && (
            <div className="mb-1.5">
              <PressureRangeBar
                pressureMax={xMax}
                onPressureMaxChange={setXMax}
                dataMaxPressure={dataMaxPressure}
                compact={true}
              />
            </div>
          )}
          {/* 横纵坐标切换 + SUM/AVG 切换 */}
          <div className="flex items-center gap-2 mb-1.5">
            <button
              onClick={toggleAxisSwap}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono transition-all"
              style={{
                background: axisSwapped ? 'oklch(0.58 0.22 265 / 0.2)' : 'oklch(0.20 0.02 265)',
                border: axisSwapped ? '1px solid oklch(0.58 0.22 265 / 0.5)' : '1px solid oklch(0.30 0.03 265)',
                color: axisSwapped ? 'oklch(0.75 0.12 220)' : 'oklch(0.50 0.02 240)',
                fontSize: '9px',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 5l3-3 3 3"/>
                <path d="M5 2v8"/>
                <path d="M14 11l-3 3-3-3"/>
                <path d="M11 14V6"/>
              </svg>
              横纵切换
            </button>
            <button
              onClick={() => setShowAvg(v => !v)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono transition-all"
              style={{
                background: showAvg ? 'oklch(0.56 0.18 145 / 0.15)' : 'oklch(0.20 0.02 265)',
                border: showAvg ? '1px solid oklch(0.56 0.18 145 / 0.4)' : '1px solid oklch(0.30 0.03 265)',
                color: showAvg ? 'oklch(0.72 0.20 145)' : 'oklch(0.50 0.02 240)',
                fontSize: '9px',
              }}
            >
              {showAvg ? 'AVG' : 'SUM'}
            </button>
            {axisSwapped && (
              <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px' }}>
                X: {showAvg ? 'ADC Avg' : 'ADC Sum'} · Y: 压力 (N)
              </span>
            )}
          </div>
          {/* 降采样提示 */}
          {totalRawPoints > totalDisplayPoints && (
            <div className="mb-1 text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px' }}>
              已降采样显示 ({totalDisplayPoints}/{totalRawPoints} 点)
            </div>
          )}

          <div className="flex-1" style={{ minHeight: '400px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="oklch(0.25 0.03 265)"
                  strokeOpacity={0.6}
                />
                {/* 横坐标：axisSwapped 时为 ADC Sum，否则为 压力 (N) */}
                <XAxis
                  dataKey={axisSwapped ? "adcSum" : "pressure"}
                  type="number"
                  name={axisSwapped ? "ADC Sum" : "压力"}
                  tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                  axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                  tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                  tickFormatter={axisSwapped ? formatAdcTick : undefined}
                  label={{
                    value: axisSwapped ? 'ADC Sum' : '压力 (N)',
                    position: 'insideBottom',
                    offset: -5,
                    fill: axisSwapped ? 'oklch(0.70 0.18 200)' : 'oklch(0.72 0.20 145)',
                    fontSize: 10,
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                  domain={axisSwapped ? ['auto', 'auto'] : [0, xMax]}
                  allowDataOverflow={!axisSwapped}
                />
                {/* 纵坐标：axisSwapped 时为 压力 (N)，否则为 ADC Sum */}
                <YAxis
                  dataKey={axisSwapped ? "pressure" : "adcSum"}
                  type="number"
                  name={axisSwapped ? "压力" : "ADC Sum"}
                  tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                  axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                  tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                  tickFormatter={axisSwapped ? undefined : formatAdcTick}
                  label={{
                    value: axisSwapped ? '压力 (N)' : (showAvg ? 'ADC Avg' : 'ADC Sum'),
                    angle: -90,
                    position: 'insideLeft',
                    fill: axisSwapped ? 'oklch(0.72 0.20 145)' : 'oklch(0.70 0.18 200)',
                    fontSize: 10,
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                  domain={['auto', 'auto']}
                />
                <ZAxis range={[15, 15]} />
                <Tooltip content={(tooltipProps: any) => <MultiSeriesTooltipInner {...tooltipProps} axisSwapped={axisSwapped} />} />
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
                {displaySeries.map((s, idx) => (
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
            <HillFitPanel fit={hillFitResult} axisSwapped={axisSwapped} />
          )}
        </div>
      )}
    </div>
  );
});

export default DataChart;
