import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalibrationPoint, CalibrationResult } from './calibration';
import { buildCsvReference, compareCsvReference, parseReferenceCSV, type CsvDataset, type CsvReference, type CsvScope } from './csvReference';

export function useCsvReference(points: CalibrationPoint[], result: CalibrationResult | null, channels1Based: number[], massPlan: number[]) {
  const [datasets, setDatasets] = useState<CsvDataset[]>([]);
  const [scope, setScopeValue] = useState<CsvScope>('legacy-loading');
  const [excludeSaturated, setExcludeValue] = useState(false);
  const [reference, setReference] = useState<CsvReference | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadId = useRef(0);
  useEffect(() => () => { uploadId.current++; }, []);

  useEffect(() => {
    if (!datasets.length) { setReference(null); setBusy(false); return; }
    setBusy(true);
    setReference(null);
    const timer = window.setTimeout(() => {
      try {
        setReference(buildCsvReference(datasets, scope, excludeSaturated));
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally { setBusy(false); }
    }, 30);
    return () => window.clearTimeout(timer);
  }, [datasets, scope, excludeSaturated]);

  const upload = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const id = ++uploadId.current;
    setError(null);
    setBusy(true);
    try {
      if (files.length > 10) throw new Error('一次最多上传 10 个 CSV，请重新选择。');
      if (files.some(file => file.size > 5 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) throw new Error('每个 CSV 最大 5 MB，一次合计最大 20 MB。');
      const parsed = await Promise.all(files.map(async file => {
        if (!/\.csv$/i.test(file.name) && !/^consistency-test(?: \(\d+\))?$/i.test(file.name) && file.type !== 'text/csv') {
          throw new Error(`${file.name}：请选择 CSV 文件。`);
        }
        const bytes = await file.arrayBuffer();
        let content: string;
        try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { content = new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
        return parseReferenceCSV(content, file.name);
      }));
      if (id === uploadId.current) setDatasets(parsed);
    } catch (cause) {
      if (id === uploadId.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setBusy(false);
      }
    }
  }, []);
  const clear = useCallback(() => {
    uploadId.current++;
    setDatasets([]); setReference(null); setError(null); setBusy(false);
  }, []);
  const setScope = (value: CsvScope) => { setScopeValue(value); if (datasets.length) { setBusy(true); setReference(null); } };
  const setExcludeSaturated = (value: boolean) => { setExcludeValue(value); if (datasets.length) { setBusy(true); setReference(null); } };
  const comparison = useMemo(() => reference ? compareCsvReference(reference, points, result, channels1Based, massPlan) : null, [reference, points, result, channels1Based, massPlan]);
  const exportData = reference ? {
    response: 'ADC Avg', scope, excludeSaturated, massLevelsG: massPlan,
    reference, comparison,
    methodology: {
      pointR2: '1 - sum((six-point measured ADC - CSV prediction)^2) / sum((six-point measured ADC - mean measured ADC)^2)',
      curveR2: '1 - sum((CSV prediction - six-point fit)^2) / sum((CSV prediction - mean CSV prediction)^2)',
      curveSamples: 201, range: 'shared unsaturated measured coverage; no extrapolation',
    },
  } : null;
  return { datasets, scope, setScope, excludeSaturated, setExcludeSaturated, reference, comparison, busy, error, upload, clear, exportData };
}

export type CsvReferenceState = ReturnType<typeof useCsvReference>;
