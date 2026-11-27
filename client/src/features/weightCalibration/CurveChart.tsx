import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { ArrowUpDown } from 'lucide-react';
import PressureRangeBar from '@/components/PressureRangeBar';
import { CALIBRATION_COLOR, FIT_CURVE_COLOR, fileSeriesColor } from '@/components/forceChartStyle';
import { CHART_RANGE_MIN_N, CHART_RANGE_PRESETS, CHART_RANGE_STEP_N, CURVE_MAX_N, type CalibrationPoint, type CalibrationResult } from './calibration';
import { CsvUpload, CsvFitSettings, CsvComparison } from './CsvComparison';
import WeightCurvePlot from './WeightCurvePlot';
import type { CsvReferenceState } from './useCsvReference';

const rangeConfig = { min: CHART_RANGE_MIN_N, max: CURVE_MAX_N, step: CHART_RANGE_STEP_N, presets: CHART_RANGE_PRESETS };

interface ChartProps {
  result: CalibrationResult | null;
  points: CalibrationPoint[];
  demo: boolean;
  csv: CsvReferenceState;
  collecting: boolean;
}

interface SeriesToggleProps {
  name: string;
  color: string;
  checked: boolean;
  onChange: () => void;
  count?: number;
  dashed?: boolean;
}

function SeriesToggle({ name, color, checked, onChange, count, dashed }: SeriesToggleProps) {
  return <label className="wc-series-toggle" data-checked={checked}
    style={{ '--series-color': color } as CSSProperties}
    title={count === undefined ? name : name + ' · ' + count + ' 个有效原始点'}>
    <input type="checkbox" aria-label={name} checked={checked} onChange={onChange} />
    <i aria-hidden="true" className={dashed ? 'wc-line-key' : 'wc-dot-key'} />
    <span className="wc-series-name">{name}</span>
    {count !== undefined && <small>({count})</small>}
  </label>;
}

export default function CurveChart({ result, points, demo, csv, collecting }: ChartProps) {
  const [maxN, setMaxN] = useState(CURVE_MAX_N);
  const [swapped, setSwapped] = useState(false);
  const [showReference, setShowReference] = useState(true);
  const [showCalibration, setShowCalibration] = useState(true);
  const [hiddenFiles, setHiddenFiles] = useState<ReadonlySet<number>>(() => new Set());
  const fileDragDepth = useRef(0);
  const [fileOverChart, setFileOverChart] = useState(false);
  const { datasets, busy } = csv;
  const uploadDisabled = collecting || busy;
  const reference = busy ? null : csv.reference;
  useEffect(() => { setHiddenFiles(new Set()); }, [datasets]);
  const visibleFiles = useMemo(() => datasets.map((_, index) => !hiddenFiles.has(index)), [datasets, hiddenFiles]);

  function toggleFile(index: number) {
    setHiddenFiles(current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function importFiles(files: File[]) {
    if (!uploadDisabled && files.length) void csv.upload(files);
  }

  function allowFileDrag(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes('Files')) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = uploadDisabled ? 'none' : 'copy';
    return true;
  }

  return <section aria-label="力与 ADC 曲线" className="chart-panel wc-chart-section"
    data-file-over={(fileOverChart && !uploadDisabled) || undefined}
    onDragEnter={event => {
      if (!allowFileDrag(event)) return;
      fileDragDepth.current++;
      setFileOverChart(true);
    }}
    onDragOver={allowFileDrag}
    onDragLeave={() => {
      fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
      if (fileDragDepth.current === 0) setFileOverChart(false);
    }}
    onDrop={event => {
      fileDragDepth.current = 0;
      setFileOverChart(false);
      if (!event.dataTransfer.files.length && !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      importFiles(Array.from(event.dataTransfer.files));
    }}>
    <CsvUpload csv={csv} collecting={collecting} onFiles={importFiles} />
    {(datasets.length > 0 || points.length > 0) && <div className="wc-series-strip" role="group"
      aria-label="图中可见曲线" title="勾选只调整图中显示，CSV 参考拟合和 R² 使用全部已导入文件。">
      {datasets.length > 0 && <SeriesToggle name="CSV Hill 拟合" color={FIT_CURVE_COLOR}
        dashed checked={showReference} onChange={() => setShowReference(value => !value)} />}
      {datasets.map((dataset, index) => <SeriesToggle key={index} name={dataset.fileName}
        color={fileSeriesColor(index)} count={dataset.samples.length} checked={visibleFiles[index]} onChange={() => toggleFile(index)} />)}
      {points.length > 0 && <SeriesToggle name={demo ? '六档标定（示范）' : '六档标定'}
        color={CALIBRATION_COLOR} checked={showCalibration} onChange={() => setShowCalibration(value => !value)} />}
    </div>}

    <div className="wc-chart-frame">
      {fileOverChart && !uploadDisabled && <span className="wc-drop-prompt">
        {datasets.length ? '松开以替换当前参考 CSV' : '松开以导入 CSV'}
      </span>}
      <div className="wc-range">
        <PressureRangeBar compact pressureMax={maxN} onPressureMaxChange={setMaxN}
          dataMaxPressure={CURVE_MAX_N} rangeConfig={rangeConfig} />
      </div>
      <div className="wc-axis-tools">
        <button type="button" aria-pressed={swapped} onClick={() => setSwapped(value => !value)}>
          <ArrowUpDown size={12} aria-hidden="true" />横纵切换
        </button>
        <span className="wc-unit" title="选区通道的 ADC 平均值">ADC Avg</span>
        {swapped && <span className="wc-axes-caption">横轴 ADC Avg · 纵轴 压力 (N)</span>}
      </div>
      <WeightCurvePlot datasets={datasets} reference={reference} scope={csv.scope} excludeSaturated={csv.excludeSaturated} points={points} result={result}
        maxN={maxN} swapped={swapped} visibleFiles={visibleFiles} showReference={showReference}
        showCalibration={showCalibration} demo={demo} />
      {reference && <div className="wc-fit-summary" aria-label="CSV Hill 方程拟合">
        <div className="wc-fit-header"><strong>CSV Hill 方程拟合</strong>
          <span className="wc-fit-r2">R² = {reference.fitR2 === null ? '无法计算' : reference.fitR2.toFixed(6)}</span>
          <span>RMSE = {reference.fitRmse === null ? '无法计算' : reference.fitRmse.toFixed(4) + ' ADC'}</span><span>Hill 3 参数</span>
        </div>
        <div className="wc-fit-equation"><span>拟合方程</span>
          <code>ADC Avg = {reference.a.toFixed(4)} × P^{reference.n.toFixed(4)} / ({reference.b.toFixed(4)}^{reference.n.toFixed(4)} + P^{reference.n.toFixed(4)})</code>
        </div>
        <div className="wc-fit-coverage">拟合范围 {reference.fitMinN.toFixed(3)}–{reference.fitMaxN.toFixed(3)} N · {reference.sampleCount} 个拟合样本 · 未饱和覆盖 {reference.minN.toFixed(3)}–{reference.maxN.toFixed(3)} N</div>
      </div>}
    </div>

    <CsvFitSettings csv={csv} collecting={collecting} />
    <CsvComparison csv={csv} demo={demo} hasCurve={!!result} />
  </section>;
}
