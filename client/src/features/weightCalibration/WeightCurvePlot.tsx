import { memo, useMemo } from 'react';
import { ReferenceArea, ReferenceLine, Scatter } from 'recharts';
import { ForceScatterPlot } from '@/components/ForceScatterPlot';
import { CALIBRATION_COLOR, CurveLegendItems, FIT_CURVE_COLOR, fileSeriesColor, seriesLine, type CurveLegendItem } from '@/components/forceChartStyle';
import { CURVE_MAX_N, FORCE_TOLERANCE_N, weightLabel, type CalibrationPoint, type CalibrationResult } from './calibration';
import type { CsvDataset, CsvReference, CsvScope } from './csvReference';
import { calibrationSeries, referenceCurve, sortedLoadingSeries, visibleLoadingPoints } from './weightPlotData';

interface Props {
  datasets: CsvDataset[];
  reference: CsvReference | null;
  scope?: CsvScope;
  excludeSaturated?: boolean;
  points: CalibrationPoint[];
  result: CalibrationResult | null;
  maxN: number;
  swapped: boolean;
  visibleFiles: readonly boolean[];
  showReference: boolean;
  showCalibration: boolean;
  demo: boolean;
}

interface PlotPoint {
  forceN: number;
  adc: number;
  rowIndex?: number;
  massG?: number;
  saturated?: boolean;
}

interface PlotSeries extends CurveLegendItem {
  data: PlotPoint[];
}

function ModelTarget({ cx, cy }: { cx?: number; cy?: number }) {
  return <circle cx={cx} cy={cy} r={4} fill="transparent" />;
}

function PointTooltip({ point, series }: { point: PlotPoint; series: PlotSeries }) {
  return <div className="rounded p-2.5 font-mono" style={{ background: 'var(--jk-s2)', border: '1px solid var(--jk-line-4)', fontSize: 11 }}>
    <strong style={{ color: series.color }}>{series.label}</strong>
    {point.rowIndex != null && <div>CSV 第 {point.rowIndex} 行</div>}
    {point.massG != null && <div>{weightLabel(point.massG)}</div>}
    <div>压力 {point.forceN.toFixed(3)} N</div><div>ADC Avg {point.adc.toFixed(2)}</div>
    {point.saturated && <div style={{ color: 'var(--jk-warn)' }}>含 ADC 255 饱和通道</div>}
  </div>;
}

function WeightCurvePlot({ datasets, reference, scope = 'legacy-loading', excludeSaturated = false, points, result, maxN, swapped, visibleFiles, showReference, showCalibration, demo }: Props) {
  const loading = useMemo(() => sortedLoadingSeries(datasets, scope, excludeSaturated), [datasets, scope, excludeSaturated]);
  const files = useMemo(() => loading.map(samples => visibleLoadingPoints(samples, maxN)), [loading, maxN]);
  const csvFit = useMemo(() => reference ? referenceCurve(reference, maxN) : [], [reference, maxN]);
  const calibration = useMemo(() => calibrationSeries(points, result, maxN), [points, result, maxN]);
  const series: PlotSeries[] = [];
  let rawCount = 0, displayCount = 0;
  if (showReference && csvFit.length) series.push({ key: 'reference', label: 'CSV Hill 拟合', shape: 'dashed', color: FIT_CURVE_COLOR, data: csvFit });
  files.forEach(({ display, count }, index) => {
    if (!visibleFiles[index] || !count) return;
    rawCount += count;
    displayCount += display.length;
    series.push({ key: 'file-' + index, label: datasets[index].fileName, shape: 'samples', color: fileSeriesColor(index), data: display });
  });
  if (showCalibration) {
    if (calibration.fitted.length) series.push({ key: 'fitted', label: '六档 Hill 拟合', shape: 'line', color: CALIBRATION_COLOR, data: calibration.fitted });
    if (calibration.extrapolated.length) series.push({ key: 'extrapolated', label: '六档外推', shape: 'dashed', color: CALIBRATION_COLOR, data: calibration.extrapolated });
    if (calibration.measured.length) series.push({ key: 'measured', label: demo ? '六档示范点' : '六档采集点', shape: 'points', color: CALIBRATION_COLOR, data: calibration.measured });
  }
  const forceAxis = { dataKey: 'forceN', label: '压力 (N)', name: '压力', color: 'var(--jk-ok)', domain: [0, maxN], allowDataOverflow: true };
  const adcAxis = { dataKey: 'adc', label: 'ADC Avg', name: 'ADC Avg', color: 'var(--jk-accent)', domain: [0, 255], ticks: [0, 50, 100, 150, 200, 255], allowDataOverflow: true };
  const predictionLimit = Math.min(maxN, CURVE_MAX_N);
  const hasExtrapolation = showCalibration && result && result.measuredMaxN < predictionLimit - FORCE_TOLERANCE_N;
  return <div data-testid="weight-curve-plot">
    {displayCount < rawCount && <div className="mb-1 font-mono" style={{ fontSize: 10, color: 'var(--jk-text-low)' }}>已降采样显示（{displayCount}/{rawCount} 个 CSV 测点）</div>}
    <div style={{ width: '100%', height: 'clamp(290px, 39vw, 440px)', minWidth: 0 }} role="group" aria-label={`力与 ADC 平均值图，压力范围 0–${maxN} N`}>
      {series.length ? <ForceScatterPlot x={swapped ? adcAxis : forceAxis} y={swapped ? forceAxis : adcAxis}
        legend={<CurveLegendItems items={series} />}
        tooltip={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const p = payload[0].payload as PlotPoint;
          const layer = series.find(s => s.data.includes(p));
          return layer && <PointTooltip point={p} series={layer} />;
        }}>
        {hasExtrapolation && <ReferenceArea {...(swapped ? { y1: result.measuredMaxN, y2: predictionLimit } : { x1: result.measuredMaxN, x2: predictionLimit })} fill="var(--jk-warn)" fillOpacity={0.055} stroke="none" />}
        {hasExtrapolation && <ReferenceLine {...(swapped ? { y: result.measuredMaxN } : { x: result.measuredMaxN })} stroke="var(--jk-text-low)" strokeDasharray="3 4" />}
        {series.map(s => <Scatter key={s.key} name={s.label} className={'weight-series-' + s.key} data={s.data} fill={s.color}
          line={s.shape === 'points' ? false : seriesLine(s.color, s.shape === 'dashed')} lineType="joint"
          shape={s.shape === 'points' || s.shape === 'samples' ? 'circle' : <ModelTarget />}
          isAnimationActive={false} />)}
      </ForceScatterPlot> : <div className="flex h-full items-center justify-center text-xs font-mono" style={{ color: 'var(--jk-text-mid)' }}>
        {!datasets.length && !points.length ? '将历史 CSV 拖到这里，或完成六档采集' : '当前显示范围内没有可见曲线或测点'}
      </div>}
    </div>
    {hasExtrapolation && <p className="hint">六档标定上限 {result.measuredMaxN.toFixed(3)} N。标记区域内为六档模型外推。</p>}
  </div>;
}

export default memo(WeightCurvePlot);
