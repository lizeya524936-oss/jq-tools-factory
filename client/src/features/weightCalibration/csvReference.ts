import {
  ADC_LIMIT, FORCE_TOLERANCE_N, WEIGHT_STEPS, massToForce, predictADC, validateWeightPlan,
  type CalibrationPoint, type CalibrationResult,
} from './calibration';
import { fitHill, hillFunc } from '@/lib/hillFit';

const MAX_CHANNELS = 32 * 32;

export type CsvScope = 'legacy-loading' | 'loading-low';
export interface CsvSample {
  forceN: number;
  adc: number;
  rowIndex: number;
  /** Any selected individual channel is >=255, even if its average is smaller. */
  saturated: boolean;
}
export interface CsvDataset {
  fileName: string;
  channels1Based: number[] | null;
  samples: CsvSample[];
  sourceKind: 'raw-channels' | 'adc-average' | 'adc-sum';
  sourceLabel: string;
  simulated: boolean;
  counts: { total: number; invalid: number; saturated: number; ignoredModel: number };
  warnings: string[];
  minN: number;
  maxN: number;
}
export interface CsvFileSummary {
  fileName: string;
  totalRows: number;
  validRows: number;
  loadingRows: number;
  usedRows: number;
  saturatedRows: number;
  ignoredModelRows: number;
}
export interface CsvReference {
  files: CsvFileSummary[];
  channels1Based: number[] | null;
  a: number;
  b: number;
  n: number;
  offset: number;
  /** Valid, unsaturated observed coverage, not the fitted asymptote/domain. */
  minN: number;
  maxN: number;
  fitMinN: number;
  fitMaxN: number;
  fitR2: number | null;
  fitRmse: number | null;
  sampleCount: number;
  samples: CsvSample[];
  warnings: string[];
  scope: CsvScope;
  excludeSaturated: boolean;
}
export interface AgreementMetrics {
  r2: number | null;
  rmse: number | null;
  count: number;
  total: number;
  reason?: string;
}
export interface CsvComparisonRow {
  massG: number;
  forceN: number;
  measuredADC: number;
  referenceADC: number | null;
  /** Current measured ADC minus CSV predicted ADC. */
  errorADC: number | null;
  reason?: string;
}
export interface CsvComparison {
  pointMetrics: AgreementMetrics | null;
  curveMetrics: AgreementMetrics | null;
  rows: CsvComparisonRow[];
  curveRange: [number, number] | null;
  warnings: string[];
  blockedReason: string | null;
  pointComplete: boolean;
  pointPartial: boolean;
}

/** A strict RFC4180-style reader. Empty numeric fields never become zero. */
function readCSV(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  if (source.length > 12 * 1024 * 1024) throw new Error('CSV 超过 12 MB，请先缩减数据后上传。');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  function finishRow() {
    row.push(field);
    if (row.some(value => value.trim() !== '')) rows.push(row);
    row = []; field = ''; closedQuote = false;
    if (rows.length > 100001) throw new Error('CSV 超过 100,000 行，请先缩减数据后上传。');
  }
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else field += c;
    } else if (c === ',') {
      row.push(field); field = ''; closedQuote = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      finishRow();
    } else if (c === '"' && field === '' && !closedQuote) {
      quoted = true;
    } else if (c === '"' || (closedQuote && c.trim() !== '')) {
      throw new Error('CSV 引号格式不正确，请重新导出 CSV。');
    } else if (!closedQuote) field += c;
  }
  if (quoted) throw new Error('CSV 存在未闭合的引号。');
  if (field !== '' || row.length || closedQuote) finishRow();
  return rows;
}
const normalized = (value: string) => value.trim().toLowerCase().replace(/[\s_]/g, '').replace(/（/g, '(').replace(/）/g, ')');
function numeric(value: string | undefined): number | null {
  if (value === undefined || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function sameChannels(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);
}
function parseChannels(value: string): number[] | null {
  if (!value.trim()) return null;
  const values = value.split(/[;；,，\s]+/).filter(Boolean).map(numeric);
  if (!values.length || values.some(v => v === null || !Number.isInteger(v) || v < 1 || v > MAX_CHANNELS)) {
    throw new Error('CSV 的选区通道必须是 1–1024 的通道编号，用分号分隔。');
  }
  const channels = values as number[];
  if (new Set(channels).size !== channels.length) throw new Error('CSV 的选区通道包含重复编号。');
  return channels.sort((a, b) => a - b);
}
function bounds(samples: readonly CsvSample[]): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const sample of samples) { min = Math.min(min, sample.forceN); max = Math.max(max, sample.forceN); }
  return [min, max];
}

export function parseReferenceCSV(text: string, fileName: string): CsvDataset {
  const rows = readCSV(text);
  if (rows.length < 2) throw new Error('CSV 中没有可用的数据行。');
  const headers = rows[0].map(normalized);
  const uniqueColumn = (names: string[]) => {
    const matches = headers.flatMap((h, i) => names.includes(h) ? [i] : []);
    if (matches.length > 1) throw new Error(`CSV 存在多个同义列（${names[0]}），无法确定应使用哪一列。`);
    return matches[0] ?? -1;
  };
  const forceColumn = uniqueColumn(['压力(n)', '力(n)', 'force(n)', 'pressure(n)', 'forcen', 'pressuren']);
  if (forceColumn < 0) throw new Error('未找到力值列。请提供带单位 N 的列，如“压力(N)”或“力(N)”。');
  const sensorColumns = headers.flatMap((h, index) => {
    const match = /^(?:传感器|感測器|sensor)#?(\d+)$/.exec(h);
    return match ? [{ index, channel: Number(match[1]) }] : [];
  });
  if (sensorColumns.some(({ channel }) => channel < 1 || channel > MAX_CHANNELS) || new Set(sensorColumns.map(s => s.channel)).size !== sensorColumns.length) {
    throw new Error('CSV 传感器通道编号越界或重复。');
  }
  const avgColumn = uniqueColumn(['adcavg', 'adcaverage', 'adc平均值', '平均adc', 'adc均值', 'adcavg(0-255)']);
  const sumColumn = uniqueColumn(['adcsum', 'adc总和', 'adc合计']);
  const vectorColumn = uniqueColumn(['adcvalue']);
  const channelsColumn = uniqueColumn(['选区通道', '通道编号', 'channels', 'selectedchannels']);
  const countColumn = uniqueColumn(['通道数', '传感器数量', 'channelcount', 'sensorcount']);
  const typeColumn = uniqueColumn(['类型', 'type']);
  if (!sensorColumns.length && vectorColumn < 0 && avgColumn < 0 && sumColumn < 0) throw new Error('未找到传感器列或 ADC_Avg；ADC Sum 还需明确的通道数量。');
  const sourceKind: CsvDataset['sourceKind'] = sensorColumns.length || vectorColumn >= 0 ? 'raw-channels' : avgColumn >= 0 ? 'adc-average' : 'adc-sum';
  let channels = sensorColumns.length ? sensorColumns.map(s => s.channel).sort((a, b) => a - b) : null;
  let metadataMissing = false;
  let knownChannelCount: number | null = channels?.length ?? null;
  const dataRows = rows.slice(1);
  const hasMeasurements = typeColumn >= 0 && dataRows.some(row => /^(六档测点|六档模拟点)$/.test(row[typeColumn]?.trim() ?? ''));
  const counts = { total: dataRows.length, invalid: 0, saturated: 0, ignoredModel: 0 };
  const samples: CsvSample[] = [];
  let simulated = false;
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const kind = typeColumn >= 0 ? (row[typeColumn] ?? '').trim() : '';
    if (kind === '模型曲线' || (hasMeasurements && !/^(六档测点|六档模拟点)$/.test(kind))) { counts.ignoredModel++; continue; }
    if (kind === '六档模拟点') simulated = true;
    if (row.length !== headers.length) { counts.invalid++; continue; }
    let rowChannels: number[] | null = null;
    if (channelsColumn >= 0) rowChannels = parseChannels(row[channelsColumn]);
    if (rowChannels) {
      if (channels && !sameChannels(channels, rowChannels)) throw new Error('同一 CSV 包含不同选区通道，不能合并为同一传感区域。');
      channels = rowChannels;
    } else if (!sensorColumns.length) metadataMissing = true;
    const explicitCount = countColumn >= 0 ? numeric(row[countColumn]) : null;
    if (explicitCount !== null && (!Number.isInteger(explicitCount) || explicitCount < 1 || explicitCount > MAX_CHANNELS)) throw new Error('CSV 通道数必须为 1–1024 的整数。');
    // Factory exports may store the selected ADC readings in one semicolon-separated cell.
    // Positions in that cell give the count, but do not identify physical channels.
    const channelADCs = sensorColumns.length ? sensorColumns.map(column => numeric(row[column.index]))
      : vectorColumn >= 0 ? row[vectorColumn].split(/[;；]/).map(numeric) : [];
    if (sourceKind === 'raw-channels' && (channelADCs.length > MAX_CHANNELS || channelADCs.some(v => v === null || v < 0 || v > ADC_LIMIT))) {
      counts.invalid++;
      continue;
    }
    const rowCount = channelADCs.length || rowChannels?.length || explicitCount;
    if (rowChannels && rowCount !== rowChannels.length) throw new Error('CSV 的原始 ADC 数量与通道编号数量不一致。');
    if (explicitCount && rowCount !== explicitCount) throw new Error('CSV 通道数与通道编号数量不一致。');
    if (rowCount) {
      if (knownChannelCount !== null && knownChannelCount !== rowCount) throw new Error('同一 CSV 包含不同通道数量，不能混合换算 ADC Avg。');
      knownChannelCount = rowCount;
    }
    if (sourceKind === 'adc-sum' && !rowCount) throw new Error('ADC Sum 必须同时提供该行的通道数或选区通道，不能借用当前选区数量换算。');
    const forceN = numeric(row[forceColumn]);
    const adc = sourceKind === 'raw-channels'
      ? channelADCs.every(v => v !== null && v >= 0 && v <= ADC_LIMIT) ? (channelADCs as number[]).reduce((s, v) => s + v, 0) / channelADCs.length : null
      : sourceKind === 'adc-average' ? numeric(row[avgColumn]) : (() => { const sum = numeric(row[sumColumn]); return sum === null ? null : sum / rowCount!; })();
    if (forceN === null || forceN < 0 || adc === null || adc < 0 || adc > ADC_LIMIT) { counts.invalid++; continue; }
    const saturated = channelADCs.some(v => v !== null && v >= ADC_LIMIT) || adc >= ADC_LIMIT;
    if (saturated) counts.saturated++;
    samples.push({ forceN, adc, saturated, rowIndex: i + 2 });
  }
  if (!samples.length) {
    if (counts.ignoredModel) throw new Error('CSV 只有模型曲线，没有实测数据；模型生成点不能作为实测参考。请上传原始采集 CSV。');
    throw new Error('CSV 中没有有效的力值–ADC 数据，请检查缺失值、单位和数值范围。');
  }
  const warnings: string[] = [];
  if (counts.invalid) warnings.push(`${fileName}：已跳过 ${counts.invalid} 行缺失、非法或超出 ADC 量程的数据。`);
  if (counts.ignoredModel) warnings.push(`${fileName}：已忽略 ${counts.ignoredModel} 行模型曲线/非测点，仅使用测点。`);
  if (!channels || metadataMissing) warnings.push(`${fileName}：部分或全部数据缺少通道编号，无法完全确认与当前选区一致。`);
  if (sourceKind !== 'raw-channels') warnings.push(`${fileName}：只有 ADC 平均值/总和，无法识别平均值低于 255 时的单通道饱和。`);
  if (simulated) warnings.push(`${fileName}：包含模拟测点，比较结果不能作为真实测量验证。`);
  const [minN, maxN] = bounds(samples);
  return { fileName, channels1Based: metadataMissing && !sensorColumns.length ? null : channels, samples, sourceKind,
    sourceLabel: sourceKind === 'raw-channels' ? '原始多通道 CSV → ADC Avg' : sourceKind === 'adc-average' ? 'ADC Avg CSV' : 'ADC Sum ÷ 明确通道数',
    simulated, counts, warnings, minN, maxN };
}

export function calculateAgreement(observed: readonly number[], predicted: readonly number[]): AgreementMetrics {
  if (observed.length !== predicted.length) throw new Error('R² 两组数据长度必须一致。');
  const count = observed.length;
  const base = { count, total: count };
  if (observed.some(v => !Number.isFinite(v)) || predicted.some(v => !Number.isFinite(v))) return { ...base, r2: null, rmse: null, reason: '比较数据包含非法数值。' };
  if (!count) return { ...base, r2: null, rmse: null, reason: '没有可比较的数据。' };
  const mean = observed.reduce((s, v) => s + v, 0) / count;
  const sse = observed.reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0);
  const sst = observed.reduce((s, v) => s + (v - mean) ** 2, 0);
  const rmse = Math.sqrt(sse / count);
  if (count < 2) return { ...base, r2: null, rmse, reason: '至少需要 2 对数据才能计算 R²。' };
  if (sst <= Number.EPSILON * Math.max(1, observed.reduce((s, v) => s + v * v, 0))) return { ...base, r2: null, rmse, reason: '参考方向的数据方差为零，R² 无定义。' };
  return { ...base, r2: 1 - sse / sst, rmse };
}

export function buildCsvReference(datasets: CsvDataset[], scope: CsvScope = 'legacy-loading', excludeSaturated = false): CsvReference {
  if (!datasets.length || datasets.length > 10) throw new Error('请上传 1–10 个同一传感区域的 CSV。');
  const known = datasets.filter(d => d.channels1Based !== null).map(d => d.channels1Based!);
  if (known.some(ch => !sameChannels(known[0], ch))) throw new Error('上传 CSV 的通道集合不同，请只合并同一传感区域的数据。');
  const warnings = datasets.flatMap(d => d.warnings);
  const samples: CsvSample[] = [];
  const files: CsvFileSummary[] = [];
  for (const dataset of datasets) {
    let lastPeak = 0;
    for (let i = 1; i < dataset.samples.length; i++) if (dataset.samples[i].forceN >= dataset.samples[lastPeak].forceN) lastPeak = i;
    const loading = dataset.samples.slice(0, lastPeak + 1);
    const inScope = loading.filter(s => scope !== 'loading-low' || s.forceN <= 20);
    const used = inScope.filter(s => !excludeSaturated || !s.saturated);
    samples.push(...used);
    files.push({ fileName: dataset.fileName, totalRows: dataset.counts.total, validRows: dataset.samples.length,
      loadingRows: loading.length, usedRows: used.filter(s => s.forceN > 0).length,
      saturatedRows: inScope.filter(s => s.saturated).length, ignoredModelRows: dataset.counts.ignoredModel });
  }
  const fitSamples = samples.filter(s => s.forceN > 0);
  if (fitSamples.length < 3 || new Set(fitSamples.map(s => s.forceN)).size < 3) throw new Error('所选加载段至少需要 3 个不同的正力值测点，才能拟合 CSV Hill 曲线。');
  if (!fitSamples.some(s => s.adc > 0)) throw new Error('CSV 的正力值 ADC 全为 0，无法拟合有效的 Hill 曲线。');
  const validCoverage = samples.filter(s => !s.saturated);
  if (validCoverage.length < 2 || new Set(validCoverage.map(s => s.forceN)).size < 2) throw new Error('CSV 未饱和测点不足，无法定义有效比较范围。');
  const fit = fitHill(fitSamples.map(s => s.forceN), fitSamples.map(s => s.adc));
  if (!fit || ![fit.a, fit.b, fit.n].every(v => Number.isFinite(v) && v > 0)) throw new Error('CSV Hill 拟合未得到有效参数，请检查数据或切换加载段范围。');
  const metrics = calculateAgreement(fitSamples.map(s => s.adc), fitSamples.map(s => hillFunc(s.forceN, fit.a, fit.b, fit.n)));
  const saturated = files.reduce((sum, f) => sum + f.saturatedRows, 0);
  if (saturated) warnings.push(excludeSaturated
    ? `已排除加载段中 ${saturated} 帧含 255 的饱和数据。`
    : `为兼容旧网页，拟合包含 ${saturated} 帧含 255 的饱和数据；高力饱和可能影响参考曲线。R² 比较范围仍由未饱和观测限定。`);
  if (fit.method === 'fallback') warnings.push('CSV 拟合使用初始估计回退，请谨慎解释比较结果。');
  if (metrics.r2 === null) warnings.push('CSV 响应方差不足，参考拟合 R² 无定义。');
  if (datasets.some(d => d.channels1Based === null)) warnings.push('有 CSV 缺少可核验的通道信息；请确认所有 CSV 来自相同选区。');
  warnings.push('参考 CSV 每个文件取到最后一次最大力值的加载段，采用旧网页的零截距 Hill 拟合；不自动对齐本次零点或增益。');
  const [minN, maxN] = bounds(validCoverage);
  const [fitMinN, fitMaxN] = bounds(fitSamples);
  return { files, channels1Based: known[0] ?? null, a: fit.a, b: fit.b, n: fit.n, offset: 0,
    minN, maxN, fitMinN, fitMaxN, fitR2: metrics.r2, fitRmse: metrics.rmse, sampleCount: fitSamples.length,
    samples, warnings: [...new Set(warnings)], scope, excludeSaturated };
}

export function predictCsvReference(reference: CsvReference, forceN: number): number | null {
  if (!Number.isFinite(forceN) || forceN < 0 || forceN < reference.minN - FORCE_TOLERANCE_N || forceN > reference.maxN + FORCE_TOLERANCE_N) return null;
  const value = reference.offset + hillFunc(forceN, reference.a, reference.b, reference.n);
  return Number.isFinite(value) && value >= 0 && value < ADC_LIMIT ? value : null;
}

export function compareCsvReference(
  reference: CsvReference,
  points: readonly CalibrationPoint[],
  result: CalibrationResult | null,
  selectedChannels1Based: readonly number[],
  massPlan: readonly number[] = WEIGHT_STEPS,
): CsvComparison {
  const massLevelsG = validateWeightPlan(massPlan);
  const warnings: string[] = [];
  let blockedReason: string | null = null;
  if (reference.channels1Based && !sameChannels(reference.channels1Based, selectedChannels1Based)) blockedReason = 'CSV 通道集合与当前传感器选区不同，请选择同一区域后再比较。';
  if (!reference.channels1Based) warnings.push('CSV 未提供选区通道，无法自动核验区域，请确认是同一区域的 ADC Avg。');
  const pointComplete = points.length === massLevelsG.length && massLevelsG.every(mass => points.filter(p => p.massG === mass).length === 1);
  const resultMatchesPlan = result !== null && result.massLevelsG.length === massLevelsG.length
    && massLevelsG.every((mass, i) => result.massLevelsG[i] === mass);
  if (result && !resultMatchesPlan) warnings.push('当前拟合结果的重量档位与当前计划不一致；请按当前计划重新拟合后再比较曲线 R²。');
  const rows: CsvComparisonRow[] = [...points].sort((a, b) => a.massG - b.massG).map(point => {
    const forceN = Number.isFinite(point.massG) && point.massG >= 0 ? massToForce(point.massG) : NaN;
    let reason: string | undefined = blockedReason ?? undefined;
    if (!reason && (!Number.isFinite(point.adc) || point.adc < 0 || point.adc >= ADC_LIMIT || point.saturatedSamples > 0)) reason = '本次测点无效或饱和';
    if (!reason && (!Number.isFinite(forceN) || forceN < reference.minN - FORCE_TOLERANCE_N || forceN > reference.maxN + FORCE_TOLERANCE_N)) reason = '超出 CSV 未饱和实测覆盖范围';
    const referenceADC = reason ? null : predictCsvReference(reference, forceN);
    if (!reason && referenceADC === null) reason = 'CSV 模型预测超出有效 ADC 范围';
    return { massG: point.massG, forceN, measuredADC: point.adc, referenceADC, errorADC: referenceADC === null ? null : point.adc - referenceADC, reason };
  });
  const used = rows.filter(row => row.referenceADC !== null);
  const pointMetrics = !blockedReason && pointComplete ? { ...calculateAgreement(used.map(r => r.measuredADC), used.map(r => r.referenceADC!)), total: massLevelsG.length } : null;
  const pointPartial = pointComplete && used.length < massLevelsG.length;
  if (!pointComplete) warnings.push(`完成 ${massLevelsG.join('、')} g 共 ${massLevelsG.length} 档采集后计算六点 R²。`);
  if (pointPartial && !blockedReason) warnings.push(`CSV 有效覆盖 ${used.length}/${massLevelsG.length} 个测点；当前六点 R² 仅为覆盖点的部分比较，不代表全部六档。`);
  let curveMetrics: AgreementMetrics | null = null;
  let curveRange: [number, number] | null = null;
  if (!blockedReason && result && resultMatchesPlan && pointComplete) {
    const validPoints = points.filter(p => Number.isFinite(p.adc) && p.adc >= 0 && p.adc < ADC_LIMIT && p.saturatedSamples === 0);
    const min = Math.max(reference.minN, Math.min(...validPoints.map(p => massToForce(p.massG))));
    let max = Math.min(20, reference.maxN, result.measuredMaxN, Math.max(...validPoints.map(p => massToForce(p.massG))));
    // Both Hill models are increasing. Trim the common range before either
    // model reaches ADC255 rather than silently dropping interior grid samples.
    const observable = (force: number) => predictCsvReference(reference, force) !== null && Number.isFinite(predictADC(result, force)) && predictADC(result, force) >= 0 && predictADC(result, force) < ADC_LIMIT;
    if (Number.isFinite(min) && Number.isFinite(max) && max > min && observable(min)) {
      if (!observable(max)) {
        let lower = min, upper = max;
        for (let i = 0; i < 60; i++) { const middle = (lower + upper) / 2; if (observable(middle)) lower = middle; else upper = middle; }
        max = lower;
        warnings.push('曲线比较上限已缩至模型达到 ADC 255 前，饱和预测不参与 R²。');
      }
      if (max > min + 1e-9) {
        const forces = Array.from({ length: 201 }, (_, i) => min + (max - min) * i / 200);
        curveMetrics = calculateAgreement(forces.map(f => predictCsvReference(reference, f)!), forces.map(f => predictADC(result, f)));
        curveRange = [min, max];
      }
    }
    if (!curveRange) warnings.push('当前曲线与 CSV 没有足够的共同有效实测区间，无法计算曲线 R²。');
  }
  return { pointMetrics, curveMetrics, rows, curveRange, warnings, blockedReason, pointComplete, pointPartial };
}
