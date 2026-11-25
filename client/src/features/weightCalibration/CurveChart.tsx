import { useMemo, useState } from 'react';
import { buildCurve, massToForce, predictADC, WEIGHT_STEPS, FORCE_TOLERANCE_N, weightLabel, type CalibrationPoint, type CalibrationResult } from './calibration';
import { predictCsvReference } from './csvReference';
import { CsvUpload, CsvComparison } from './CsvComparison';
import type { CsvReferenceState } from './useCsvReference';

const WIDTH = 880, HEIGHT = 350;
const PAD = { left: 60, right: 24, top: 28, bottom: 50 };
export default function CurveChart({ result, points, demo, csv, collecting }: { result: CalibrationResult | null; points: CalibrationPoint[]; demo: boolean; csv: CsvReferenceState; collecting: boolean }) {
  const [maxN, setMaxN] = useState(20);
  const [hover, setHover] = useState<number | null>(null);
  const x = (force: number) => PAD.left + force / maxN * (WIDTH - PAD.left - PAD.right);
  const y = (adc: number) => HEIGHT - PAD.bottom - adc / 255 * (HEIGHT - PAD.top - PAD.bottom);
  const measuredMax = result?.measuredMaxN ?? Math.max(0, ...points.map(point => massToForce(point.massG)));
  const hasExtrapolation = !!result && measuredMax < maxN - 1e-9;
  const curve = useMemo(() => result ? buildCurve(result, maxN) : [], [result, maxN]);
  const reference = csv.busy ? null : csv.reference;
  const csvCurve = useMemo(() => {
    if (!reference || reference.minN >= maxN) return [];
    const min = Math.max(0, reference.minN), max = Math.min(maxN, reference.maxN);
    return Array.from({ length: 401 }, (_, index) => {
      const forceN = min + (max - min) * (index / 400) ** 2;
      return { forceN, adc: predictCsvReference(reference, forceN) };
    });
  }, [reference, maxN]);
  const csvSamples = useMemo(() => {
    const samples = reference?.samples.filter(point => point.forceN <= maxN && !point.saturated && point.adc < 255) ?? [];
    return samples.filter((_, index) => index % Math.max(1, Math.ceil(samples.length / 500)) === 0);
  }, [reference, maxN]);
  const visiblePoints = points.filter(point => massToForce(point.massG) <= maxN + FORCE_TOLERANCE_N);
  const pathFor = (predicted: boolean) => {
    let penDown = false;
    return curve.filter(point => predicted ? point.forceN >= measuredMax - 1e-8 : point.forceN <= measuredMax + 1e-8)
      .map(point => {
        if (point.adc === null || point.adc >= 255 || point.adc < 0) { penDown = false; return ''; }
        const command = penDown ? 'L' : 'M';
        penDown = true;
        return `${command}${x(point.forceN).toFixed(2)},${y(point.adc).toFixed(2)}`;
      }).join(' ');
  };
  const ticks = maxN === 5 ? [0, 1, 2, 3, 4, 5] : maxN === 20 ? [0, 5, 10, 15, 20] : [0, 2.5, 5, 7.5, 10, 12.5];
  const hoverADC = result && hover !== null ? predictADC(result, hover) : null;
  const hoverReference = reference && hover !== null ? predictCsvReference(reference, hover) : null;
  let csvPenDown = false;
  const csvPath = csvCurve.map(point => {
    if (point.adc === null) { csvPenDown = false; return ''; }
    const command = csvPenDown ? 'L' : 'M'; csvPenDown = true;
    return `${command}${x(point.forceN).toFixed(2)},${y(point.adc).toFixed(2)}`;
  }).join(' ');
  return <section className="panel chart-panel" aria-label="力与 ADC 曲线">
    <div className="panel-heading">
      <h2>力–ADC 曲线</h2>
      <div className="segmented" aria-label="曲线显示范围">{[5, 12.5, 20].map(max => <button key={max} className={max === maxN ? 'active' : ''} onClick={() => { setMaxN(max); setHover(null); }}>0–{max} N</button>)}</div>
    </div>
    <CsvUpload csv={csv} collecting={collecting} />
    <div className="chart-legend"><span><i className="legend-dot" />六档采集点</span><span><i className="legend-line" />标定范围内拟合</span>{hasExtrapolation && <span><i className="legend-line dashed" />范围外推估</span>}{reference && <><span><i className="legend-line csv-line" />CSV 参考拟合</span><span><i className="legend-dot csv-dot" />CSV 加载测点</span></>}{demo && <b className="demo-label">示范数据</b>}</div>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`0 至 ${maxN} 牛顿标定曲线；当前显示 ${visiblePoints.length} 个采集点${hasExtrapolation ? `，${measuredMax.toFixed(3)} 牛顿以上为外推` : ''}`} className="curve-svg" onMouseMove={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      const position = (event.clientX - rect.left) / rect.width * WIDTH;
      setHover(Math.max(0, Math.min(maxN, (position - PAD.left) / (WIDTH - PAD.left - PAD.right) * maxN)));
    }} onMouseLeave={() => setHover(null)}>
      {hasExtrapolation && <rect x={x(measuredMax)} y={PAD.top} width={Math.max(0, x(maxN) - x(measuredMax))} height={HEIGHT - PAD.top - PAD.bottom} fill="var(--prediction-fill)" />}
      {[0, 50, 100, 150, 200, 255].map(tick => <g key={tick}><line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className="gridline" /><text x={PAD.left - 12} y={y(tick) + 4} textAnchor="end" className="axis-text">{tick}</text></g>)}
      {ticks.map(tick => <g key={tick}><line x1={x(tick)} x2={x(tick)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="gridline vertical" /><text x={x(tick)} y={HEIGHT - PAD.bottom + 24} textAnchor="middle" className="axis-text">{tick}</text></g>)}
      {hasExtrapolation && <><line x1={x(measuredMax)} x2={x(measuredMax)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="measured-boundary" /><text x={x(measuredMax) - 8} y={PAD.top + 16} textAnchor="end" className="prediction-text">{measuredMax.toFixed(3)} N 标定上限</text></>}
      <text x={PAD.left} y={15} className="axis-text">ADC Avg</text><text x={WIDTH - PAD.right} y={HEIGHT - 5} textAnchor="end" className="axis-text">力（N）</text>
      {csvSamples.map((point, index) => <circle key={index} cx={x(point.forceN)} cy={y(point.adc)} r={2} className="csv-sample" />)}
      {reference && <path d={csvPath} className="curve-path csv-path" data-testid="csv-curve" />}
      {result && <><path data-testid="measured-curve" d={pathFor(false)} className="curve-path" />{hasExtrapolation && <path data-testid="estimated-curve" d={pathFor(true)} className="curve-path prediction" />}</>}
      {visiblePoints.map(point => <g key={point.massG}><circle cx={x(massToForce(point.massG))} cy={y(point.adc)} r={5.5} className="data-point"><title>{weightLabel(point.massG)} · {massToForce(point.massG).toFixed(4)} N · ADC {point.adc.toFixed(3)}</title></circle></g>)}
      {!result && !reference && <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" className="chart-empty">{points.length ? `已采集 ${points.length} / ${WEIGHT_STEPS.length} 档，完成后生成曲线` : '完成六档采集，或先上传历史 CSV'}</text>}
      {hover !== null && (result || reference) && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="hover-line" />}
    </svg>
    <div className="chart-readout">{hover !== null && (result || reference) ? <><b>{hover.toFixed(3)} N</b>{hoverADC !== null && <><span>本次 ADC {Number.isFinite(hoverADC) && hoverADC < 255 ? hoverADC.toFixed(2) : '超出有效范围'}</span><span>{hover <= measuredMax ? '标定范围内' : '外推，未实测验证'}</span></>}{reference && <span className="csv-readout">CSV ADC {hoverReference === null ? '超出有效覆盖范围' : hoverReference.toFixed(2)}</span>}</> : <span>{result ? `标定范围 0–${measuredMax.toFixed(3)} N。${measuredMax < 20 - 1e-9 ? `${measuredMax.toFixed(3)}–20 N 为外推，尚未实测验证。` : "范围内精度仍需独立载荷验证。"}` : reference ? '已显示 CSV 参考曲线；完成六档采集后自动计算测点对比 R²。' : '六档完成后，默认显示目标 0–20 N 曲线。'}{points.length > visiblePoints.length && ` 当前显示 ${visiblePoints.length}/${points.length} 个采集点，切换 0–20 N 可查看全部。`}</span>}</div>
    <CsvComparison csv={csv} demo={demo} hasCurve={!!result} />
  </section>;
}
