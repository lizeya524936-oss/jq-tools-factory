import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './hostTheme.css';
import { Activity, ArrowRight, Check, CheckCircle2, CircleHelp, Download, FlaskConical, Loader2, Play, Plug, RefreshCw, Settings, Square, Target, Weight } from 'lucide-react';
import { subscribeWeightSensorFrames, type WeightSensorFrame } from '@/lib/weightSensorFrames';
import { WEIGHT_STEPS, REFERENCE_HILL, massToForce, weightLabel, hillShape, fitCalibration, inverseADC, buildCurve, validateWeightPlan, type CalibrationPoint, type CalibrationResult } from './calibration';
import { appendCaptureFrame, createCapture, finishCapture, SETTLE_MS, SAMPLE_MS, STALE_MS, type CaptureWindow, type CaptureFrame } from './capture';
import CurveChart from './CurveChart';
import { useCsvReference } from './useCsvReference';
import WeightPlanEditor, { parseWeightDraft } from './WeightPlanEditor';

const MIDDLE_FINGER = [87, 88, 89, 103, 104, 105, 119, 120, 121].map(value => value - 1);
const WEIGHT_COMBINATIONS: Record<number, string> = {
  0: '移除全部砝码，保持压头与支撑条件一致',
  50: '50 g',
  200: '200 g',
  550: '500 + 50 g',
  1050: '500 + 200 + 200 + 100 + 50 g',
  850: '500 + 200 + 100 + 50 g',
};
const WEIGHT_PLAN_KEY = 'jq-low-force.weight-plan.v1';
function readWeightPlan(): number[] {
  try {
    const stored = localStorage.getItem(WEIGHT_PLAN_KEY);
    return stored ? validateWeightPlan(JSON.parse(stored)) : [...WEIGHT_STEPS];
  } catch { return [...WEIGHT_STEPS]; }
}
function loadInstruction(massG: number): string {
  return WEIGHT_COMBINATIONS[massG] ?? `总质量 ${weightLabel(massG)}（按手头砝码组合）`;
}
function rangeDescription(maxN: number): string {
  return `0–${maxN.toFixed(3)} N 为标定范围` + (maxN < 20 - 1e-9 ? `，${maxN.toFixed(3)}–20 N 为外推，尚未实测验证。` : '，范围内精度仍需独立载荷验证。');
}
type RecordSet = { point: CalibrationPoint; frames: CaptureFrame[] };
type DisplayFrame = { matrix: number[][]; adc: number | null; fresh: boolean; fps: number; saturated: boolean; type: string };
const EMPTY_DISPLAY: DisplayFrame = { matrix: [], adc: null, fresh: false, fps: 0, saturated: false, type: '' };

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface WeightCalibrationProps {
  active: boolean;
  connected: boolean;
  protocol: string;
  baudRate: number;
  deviceType?: string | null;
  sessionId: number;
  onConnect: () => void;
}

function WeightCalibration({ active, connected, protocol, baudRate, deviceType, sessionId, onConnect }: WeightCalibrationProps) {
  const [demo, setDemo] = useState(false);
  const [dimensions, setDimensions] = useState({ rows: 16, cols: 16 });
  const [selected, setSelected] = useState<number[]>([]);
  const [selectionInput, setSelectionInput] = useState('');
  const [display, setDisplay] = useState<DisplayFrame>(EMPTY_DISPLAY);
  const [records, setRecords] = useState<RecordSet[]>([]);
  const [weightPlan, setWeightPlan] = useState<number[]>(readWeightPlan);
  const [weightDraft, setWeightDraft] = useState<string[]>(() => weightPlan.map(String));
  const [weightSettingsOpen, setWeightSettingsOpen] = useState(false);
  const weightSettingsButton = useRef<HTMLButtonElement>(null);
  const planDirty = weightDraft.some((value, index) => value.trim() === '' || Number(value) !== weightPlan[index]);
  const plannedMaxN = massToForce(weightPlan[weightPlan.length - 1]);
  const [captureUI, setCaptureUI] = useState<{ massG: number; progress: number; remaining: number; stage: 'settling' | 'sampling'; frames: number } | null>(null);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [notice, setNotice] = useState('选择受力区域后，从 0 g 开始采集。');
  const [error, setError] = useState<string | null>(null);
  const [shapeB, setShapeB] = useState(String(REFERENCE_HILL.b));
  const [shapeN, setShapeN] = useState(String(REFERENCE_HILL.n));
  const [fitMode, setFitMode] = useState<'measured' | 'reference'>('measured');
  const [inputADC, setInputADC] = useState('');
  const [demoMass, setDemoMass] = useState(0);
  const latestRef = useRef<WeightSensorFrame | null>(null);
  const lastSessionRef = useRef(sessionId);
  const sessionProtocolRef = useRef(protocol);
  const sessionDeviceTypeRef = useRef('');
  const sessionBaudRateRef = useRef<number | null>(null);
  const captureRef = useRef<CaptureWindow | null>(null);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const dimensionsRef = useRef(dimensions); dimensionsRef.current = dimensions;
  const demoRef = useRef(demo); demoRef.current = demo;
  const demoMassRef = useRef(demoMass); demoMassRef.current = demoMass;
  const recordsRef = useRef(records); recordsRef.current = records;
  const weightPlanRef = useRef(weightPlan); weightPlanRef.current = weightPlan;
  const frameTimesRef = useRef<number[]>([]);
  const dragRef = useRef<{ active: boolean; adding: boolean }>({ active: false, adding: false });
  const connectedRef = useRef(connected); connectedRef.current = connected;
  const acceptFrame = useCallback((frame: WeightSensorFrame) => {
    latestRef.current = frame;
    if (frame.deviceType) sessionDeviceTypeRef.current = frame.deviceType;
    frameTimesRef.current.push(frame.receivedAt);
    while (frameTimesRef.current.length > 300) frameTimesRef.current.shift();
    if (captureRef.current) appendCaptureFrame(captureRef.current, frame);
  }, []);
  const collecting = captureUI !== null;
  const points = useMemo(() => records.map(record => record.point), [records]);
  const channels1Based = useMemo(() => selected.map(index => index + 1), [selected]);
  const csvReference = useCsvReference(points, result, channels1Based, weightPlan);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const canCapture = active && selected.length > 0 && display.fresh && (demo || connected) && !collecting && !planDirty && !csvReference.busy && !display.saturated && records.length < weightPlan.length;
  const nextMass = weightPlan[records.length] ?? weightPlan[weightPlan.length - 1];

  const resetMeasurements = useCallback((message?: string) => {
    captureRef.current = null;
    setCaptureUI(null); setRecords([]); recordsRef.current = [];
    setResult(null); setError(null);
    if (message) setNotice(message);
  }, []);

  // Keep completed measurements while a tab is hidden or a device is disconnected.
  // Only a new hardware session may start a different device's series.
  useLayoutEffect(() => {
    const changedSession = lastSessionRef.current !== sessionId;
    lastSessionRef.current = sessionId;
    if (!demo && changedSession) {
      resetMeasurements('传感器已重新连接，请从 0 g 开始新一轮采集。');
      sessionDeviceTypeRef.current = '';
    }
    if (!demo && connected) {
      sessionProtocolRef.current = protocol;
      sessionBaudRateRef.current = baudRate;
      if (deviceType) sessionDeviceTypeRef.current = deviceType;
    }
    if (!active || (!connected && !demo) || (!demo && changedSession)) {
      latestRef.current = null;
      frameTimesRef.current = [];
      setDisplay(EMPTY_DISPLAY);
      dragRef.current.active = false;
      if (captureRef.current) {
        captureRef.current = null;
        setCaptureUI(null);
        setNotice('本档采集已中止，已完成的档位已保留。');
      }
    }
  }, [active, connected, demo, sessionId, protocol, baudRate, deviceType, resetMeasurements]);

  useLayoutEffect(() => {
    if (!active || !connected || demo) return;
    return subscribeWeightSensorFrames(acceptFrame);
  }, [active, connected, demo, sessionId, acceptFrame]);

  const applyWeightPlan = () => {
    if (captureRef.current || collecting) return;
    try {
      const next = parseWeightDraft(weightDraft);
      if (next.every((value, index) => value === weightPlan[index])) { setWeightDraft(weightPlan.map(String)); return; }
      resetMeasurements();
      weightPlanRef.current = next; setWeightPlan(next); setWeightDraft(next.map(String));
      setDemoMass(0); demoMassRef.current = 0; setInputADC('');
      let saved = true;
      try { localStorage.setItem(WEIGHT_PLAN_KEY, JSON.stringify(next)); } catch { saved = false; }
      setNotice(`已应用 ${next.join('、')} g。请从 0 g 开始新一轮采集。${saved ? '此浏览器下次打开会记住重量设置。' : '浏览器未能保存设置，本次仍可正常使用。'}`);
      setWeightSettingsOpen(false);
      weightSettingsButton.current?.focus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const changeSelection = useCallback((indices: number[]) => {
    if (captureRef.current) return;
    const next = [...new Set(indices)].sort((a, b) => a - b);
    selectedRef.current = next; setSelected(next);
    setSelectionInput(next.map(index => index + 1).join(', '));
    resetMeasurements('选区已更新，请从 0 g 开始采集。');
  }, [resetMeasurements]);

  useEffect(() => {
    if (!active) return;
    const release = () => { dragRef.current.active = false; };
    window.addEventListener('pointerup', release);
    window.addEventListener('blur', release);
    return () => { window.removeEventListener('pointerup', release); window.removeEventListener('blur', release); };
  }, [active]);

  useEffect(() => {
    if (!active || !demo) return;
    let sequence = 0;
    const timer = window.setInterval(() => {
      const { rows, cols } = dimensionsRef.current;
      const now = performance.now();
      const response = 7 + 290 * hillShape(massToForce(demoMassRef.current), REFERENCE_HILL.b, REFERENCE_HILL.n);
      const area = new Set(selectedRef.current.length ? selectedRef.current : MIDDLE_FINGER);
      const matrix = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => {
        const index = row * cols + col;
        return Math.round(Math.max(0, Math.min(254, area.has(index) ? response + Math.sin(sequence * 0.47 + index) * 1.2 : 1 + Math.sin(index + sequence * 0.1))));
      }));
      acceptFrame({ matrix, rows, cols, sequence: ++sequence, receivedAt: now, deviceType: 'DEMO' });
    }, 40);
    return () => window.clearInterval(timer);
  }, [active, demo, acceptFrame]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const latest = latestRef.current;
      const fresh = !!latest && now - latest.receivedAt <= STALE_MS && (demoRef.current || connectedRef.current);
      if (latest && (latest.rows !== dimensionsRef.current.rows || latest.cols !== dimensionsRef.current.cols)) {
        dimensionsRef.current = { rows: latest.rows, cols: latest.cols };
        setDimensions(dimensionsRef.current);
        selectedRef.current = []; setSelected([]); setSelectionInput('');
        resetMeasurements('已识别新的矩阵尺寸，请重新选区。');
      }
      const values = latest && fresh ? selectedRef.current.map(index => latest.matrix[Math.floor(index / latest.cols)]?.[index % latest.cols]).filter(Number.isFinite) : [];
      const times = frameTimesRef.current.filter(time => time > now - 1000);
      const adc = values.length === selectedRef.current.length && values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      if (fresh && latest) {
        setDisplay({ matrix: latest.matrix, adc, fresh, fps: times.length, saturated: values.some(value => value >= 255), type: latest.deviceType ?? '' });
      } else {
        setDisplay(EMPTY_DISPLAY);
      }
      const capture = captureRef.current;
      if (!capture) return;
      const elapsed = now - capture.startedAt;
      if (!fresh || capture.error) {
        captureRef.current = null; setCaptureUI(null);
        setError(capture.error ?? '未收到持续的新帧，本档采集已取消。请检查设备后重试。');
        return;
      }
      if (elapsed >= SETTLE_MS + SAMPLE_MS) {
        captureRef.current = null; setCaptureUI(null);
        try {
          const point = finishCapture(capture, now, latest!.receivedAt);
          const nextRecords = [...recordsRef.current, { point, frames: capture.frames }];
          recordsRef.current = nextRecords; setRecords(nextRecords); setResult(null);
          const newMass = weightPlanRef.current[nextRecords.length];
          setNotice(newMass === undefined ? '六档已完成，点击「生成 0–20 N 曲线」。' : `${weightLabel(point.massG)} 已保存。请放置 ${weightLabel(newMass)}（${loadInstruction(newMass)}）。`);
          if (newMass !== undefined && demoRef.current) setDemoMass(newMass);
        } catch (captureError) { setError(captureError instanceof Error ? captureError.message : String(captureError)); }
      } else {
        setCaptureUI({ massG: capture.massG, progress: elapsed / (SETTLE_MS + SAMPLE_MS), remaining: Math.max(0, (SETTLE_MS + SAMPLE_MS - elapsed) / 1000), stage: elapsed < SETTLE_MS ? 'settling' : 'sampling', frames: capture.frames.length });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [active, resetMeasurements]);

  const toggleDemo = () => {
    const next = !demo;
    latestRef.current = null; frameTimesRef.current = [];
    sessionDeviceTypeRef.current = '';
    setDisplay(EMPTY_DISPLAY); resetMeasurements(next ? '示范模式：选区后可体验六档采集流程。' : '已返回实测模式，请从 0 g 开始采集。');
    setDemo(next); setDemoMass(0);
    if (next) { setDimensions({ rows: 16, cols: 16 }); setSelected([]); selectedRef.current = []; setSelectionInput(''); }
  };
  const handleCapture = () => {
    if (!canCapture || !latestRef.current || performance.now() - latestRef.current.receivedAt > STALE_MS) return;
    setError(null); setResult(null);
    captureRef.current = createCapture(nextMass, selected, dimensions.rows, dimensions.cols, performance.now());
    setCaptureUI({ massG: nextMass, progress: 0, remaining: 5, stage: 'settling', frames: 0 });
  };
  const handleGenerate = () => {
    if (planDirty) return;
    try {
      const fitted = fitCalibration(points, fitMode === 'reference' ? { ...REFERENCE_HILL, b: Number(shapeB), n: Number(shapeN) } : REFERENCE_HILL, fitMode, weightPlan);
      setResult(fitted); setError(null);
      setNotice(`曲线已生成。${rangeDescription(fitted.measuredMaxN)}`);
    } catch (fitError) { setResult(null); setError(fitError instanceof Error ? fitError.message : String(fitError)); }
  };
  const applySelectionInput = () => {
    try {
      const indices = new Set<number>();
      for (const part of selectionInput.split(/[,，;；\s]+/).filter(Boolean)) {
        const match = /^(\d+)(?:-(\d+))?$/.exec(part);
        if (!match) throw new Error('点位格式请使用 87,88,89 或 87-89。');
        const start = Number(match[1]), end = Number(match[2] ?? match[1]);
        if (start < 1 || end > dimensions.rows * dimensions.cols || end < start) throw new Error('点位编号超出目前矩阵范围。');
        for (let index = start; index <= end; index++) indices.add(index - 1);
      }
      changeSelection([...indices]); setError(null);
    } catch (selectionError) { setError(selectionError instanceof Error ? selectionError.message : String(selectionError)); }
  };
  const exportResult = () => {
    if (!result) return;
    const content = {
      schemaVersion: 3, application: 'JQ Low-force Calibration', applicationVersion: '1.4.0',
      exportedAt: new Date().toISOString(), source: demo ? 'SIMULATED_DEMO_NOT_MEASURED' : 'SERIAL_DEVICE',
      protocol: sessionProtocolRef.current, deviceType: sessionDeviceTypeRef.current, baudRate: sessionBaudRateRef.current,
      response: 'selected-channel ADC average',
      region: { ...dimensions, channels1Based: selected.map(index => index + 1) },
      calibration: result,
      reference: { ...REFERENCE_HILL, b: fitMode === 'reference' ? Number(shapeB) : REFERENCE_HILL.b, n: fitMode === 'reference' ? Number(shapeN) : REFERENCE_HILL.n, role: fitMode === 'reference' ? 'fixed shape' : 'optimizer starting point only', label: '梭织中指历史 Hill 形状' },
      captureSettings: { massLevelsG: [...result.massLevelsG], massDefinition: '各档砝码总质量，按 g=9.80665 m/s² 换算力值', loads: result.massLevelsG.map(massG => ({ label: weightLabel(massG), massG, forceN: massToForce(massG), combination: loadInstruction(massG) })), repetitionsPerLevel: 1, settleMs: SETTLE_MS, sampleMs: SAMPLE_MS, statistic: 'median of per-frame selected-channel averages', weighting: 'equal weight per mass level' },
      measurementRangeN: [0, result.measuredMaxN], displayRangeN: [0, 20], availableChartMaxN: [5, 12.5, 20],
      validation: { independentlyValidated: false, note: rangeDescription(result.measuredMaxN) },
      measurements: records, curve: buildCurve(result), csvComparison: csvReference.exportData,
    };
    const exported = demo ? { ...content, protocol: 'simulation', baudRate: null, deviceType: 'DEMO' } : content;
    download(`${demo ? 'DEMO_' : ''}低力标定_${Date.now()}.json`, JSON.stringify(exported, null, 2), 'application/json;charset=utf-8');
  };
  const exportCSV = () => {
    if (!result) return;
    const source = demo ? '示范模拟数据' : '串口采集校准';
    const rows = [['来源', '类型', '加载说明', '砝码质量(g)', '力(N)', 'ADC_Avg', 'SD_ADC', '新帧数', '范围说明', '选区通道'],
      ...points.map(point => [source, demo ? '六档模拟点' : '六档测点', weightLabel(point.massG), point.massG, massToForce(point.massG), point.adc, point.sd, point.count, demo ? '模拟标定点' : '实测标定点', selected.map(index => index + 1).join(';')]),
      ...buildCurve(result).map(point => [source, '模型曲线', '', '', point.forceN, point.adc ?? '', '', '', point.clipped ? '超出ADC范围，不可用' : point.range === 'measured-range' ? '标定范围内拟合' : '外推，未实测验证', selected.map(index => index + 1).join(';')])];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    download(`${demo ? 'DEMO_' : ''}低力曲线_${Date.now()}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8');
  };
  const manualForce = result && inputADC.trim() && Number.isFinite(Number(inputADC)) ? inverseADC(result, Number(inputADC)) : null;
  const liveForce = result && display.adc !== null ? inverseADC(result, display.adc) : null;

  return <div className="weight-calibration app-shell" hidden={!active}>
    <section className="panel connection-panel">
      <div className="panel-heading">
        <div>
          <h2>六档砝码标定</h2>
          <p className="hint">选择受力区域，依次放置 {weightPlan.join('、')} g。当前最高档为 {plannedMaxN.toFixed(3)} N。</p>
        </div>
        <div className="connection-action">
          <span className={'status-pill ' + (demo || connected ? 'online' : '')}><i />{demo ? '示范数据流' : connected ? '传感器已连接' : '传感器未连接'}</span>
          {!demo && !connected && <button type="button" className="button primary small" onClick={onConnect}><Plug size={15} />连接传感器</button>}
          <button type="button" className={'button secondary small ' + (demo ? 'demo-active' : '')} disabled={collecting} onClick={toggleDemo}><FlaskConical size={15} />{demo ? '退出示范' : '先试用示范'}</button>
        </div>
      </div>
      {demo && <p className="banner demo-banner" role="status">示范模式 · 读数和曲线来自模拟数据，导出文件会标注 DEMO。</p>}
    </section>
      <div className="workspace-grid">
        <section className="panel region-panel"><div className="panel-heading"><div><h2>选择受力区域</h2></div><span className="count-badge">{selected.length} 个点</span></div><div className="region-toolbar"><button className="button small secondary" disabled={collecting || dimensions.rows !== 16 || dimensions.cols !== 16} onClick={() => changeSelection(MIDDLE_FINGER)}><Target size={14} />梭织中指 · 9 点</button><button className="text-button" disabled={collecting || !selected.length} onClick={() => changeSelection([])}>清空</button></div><p className="hint">点选或拖动选区。计算所选通道的 ADC 平均值，用于计算六档载荷的响应曲线。</p>
          <div className={'sensor-grid ' + (dimensions.cols > 20 ? 'dense' : '')} style={{ gridTemplateColumns: `repeat(${dimensions.cols}, minmax(0, 1fr))` }} role="group" aria-label={`${dimensions.rows} 行 ${dimensions.cols} 列传感器矩阵`}>
            {Array.from({ length: dimensions.rows * dimensions.cols }, (_, index) => {
              const value = display.matrix[Math.floor(index / dimensions.cols)]?.[index % dimensions.cols];
              return <button key={index} type="button" aria-label={`传感器 ${index + 1}`} data-saturated={value === 255 || undefined} aria-pressed={selectedSet.has(index)} disabled={collecting} className={'sensor-cell ' + (selectedSet.has(index) ? 'selected' : '')} title={`#${index + 1} · ADC ${value ?? '—'}`} style={value === undefined || selectedSet.has(index) ? undefined : { background: `color-mix(in srgb, var(--accent) ${Math.min(75, value / 255 * 70 + 4)}%, var(--surface))` }} onPointerDown={event => {
                if (collecting || event.button !== 0) return; event.preventDefault(); dragRef.current = { active: true, adding: !selectedSet.has(index) };
                const current = new Set(selectedRef.current); dragRef.current.adding ? current.add(index) : current.delete(index); changeSelection([...current]);
              }} onPointerEnter={() => { if (!dragRef.current.active || collecting) return; const current = new Set(selectedRef.current); dragRef.current.adding ? current.add(index) : current.delete(index); changeSelection([...current]); }} onClick={event => { if (event.detail === 0) { const current = new Set(selectedRef.current); current.has(index) ? current.delete(index) : current.add(index); changeSelection([...current]); } }}><span>{index + 1}</span><b>{value ?? '·'}</b></button>;
            })}
          </div>
          <div className="selection-entry"><label htmlFor="weight-calibration-channels">通道编号（从 1 开始）</label><div><input id="weight-calibration-channels" value={selectionInput} placeholder="例如 87-89,103-105,119-121" disabled={collecting} onChange={event => setSelectionInput(event.target.value)} /><button className="button small secondary" disabled={collecting} onClick={applySelectionInput}>应用</button></div><small>更换选区会清除本次六档数据。</small></div>
          <div className="live-grid"><div><span>区域 ADC Avg</span><strong data-testid="live-adc">{display.adc === null ? '—' : display.adc.toFixed(2)}</strong></div><div><span>有效新帧 / 秒</span><strong>{display.fresh ? display.fps : '—'}</strong></div><div><span>{result ? '目前推算力' : '数据状态'}</span><strong className="small-number">{result ? liveForce === null ? '—' : `${liveForce.toFixed(3)} N` : display.fresh ? '持续更新' : '等待数据'}</strong></div></div>{result && liveForce !== null && liveForce > result.measuredMaxN && <p className="hint">目前推算力超过标定范围，属于外推。</p>}{display.saturated && <p className="inline-error">选区有 ADC 255 饱和通道，请调整受力或选区。</p>}
        </section>
        <section className="panel steps-panel">
          <div className="panel-heading">
            <div><h2>逐档放置砝码</h2></div>
            <div className="steps-heading-actions">
              <span className="count-badge">{records.length} / {weightPlan.length}</span>
              {!weightSettingsOpen && planDirty && <span className="weight-settings-pending" role="status">重量未应用</span>}
              <button
                ref={weightSettingsButton}
                type="button"
                className="button secondary small weight-settings-toggle"
                aria-label="重量设置"
                aria-expanded={weightSettingsOpen}
                aria-controls="weight-plan-settings"
                title={weightSettingsOpen ? '收起重量设置' : '展开重量设置'}
                onClick={() => setWeightSettingsOpen(open => !open)}
              >
                <Settings size={17} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div id="weight-plan-settings" hidden={!weightSettingsOpen}>
            {weightSettingsOpen && <WeightPlanEditor plan={weightPlan} draft={weightDraft} onChange={setWeightDraft} onApply={applyWeightPlan} disabled={collecting} hasMeasurements={records.length > 0} />}
          </div>
          <p className="hint">每档等待 3 秒，再采集 2 秒；取每帧区域平均 ADC 的中位数。</p>
          <div className="weight-steps">{weightPlan.map((massG, index) => {
          const point = records[index]?.point; const active = index === records.length; const isCapturing = captureUI?.massG === massG;
          return <div key={massG} className={'weight-step ' + (point ? 'completed' : active ? 'current' : '')}><div className="step-icon">{point ? <Check size={20} /> : <Weight size={20} />}</div><div className="step-content"><div className="weight-title"><strong>{weightLabel(massG)}</strong><span>{massToForce(massG).toFixed(4)} N</span></div><div className="step-meta">{point ? <><b>ADC {point.adc.toFixed(3)}</b><span>SD {point.sd.toFixed(2)} · {point.count} 帧</span></> : <span>{loadInstruction(massG)}</span>}</div></div><div className="step-state">{point ? <button className="text-button" disabled={collecting} onClick={() => { const remaining = records.slice(0, index); recordsRef.current = remaining; setRecords(remaining); setResult(null); setError(null); setNotice(`请重新采集 ${weightLabel(massG)} 及其后档位。`); if (demo) setDemoMass(massG); }}>重采</button> : isCapturing ? <Loader2 size={18} className="spin" /> : active ? <span>下一档</span> : <span>待采集</span>}</div></div>;
        })}</div>
          {demo && <div className="demo-masses"><span>示范放置重量</span>{weightPlan.map(mass => <button key={mass} disabled={collecting} className={demoMass === mass ? 'active' : ''} onClick={() => setDemoMass(mass)}>{weightLabel(mass)}</button>)}</div>}
          <div className="capture-action">{collecting ? <><div className="capture-progress"><div style={{ width: `${(captureUI?.progress ?? 0) * 100}%` }} /></div><div className="capture-message"><span>{captureUI?.stage === 'settling' ? '等待受力稳定' : `采集中 · ${captureUI?.frames} 个新帧`}</span><strong>{captureUI?.remaining.toFixed(1)} s</strong></div><button className="button secondary full-width" onClick={() => { captureRef.current = null; setCaptureUI(null); setNotice('本档采集已取消，可以重新开始。'); }}><Square size={14} />取消本档</button></> : records.length < weightPlan.length ? <><button className="button primary full-width" disabled={!canCapture || (demo && demoMass !== nextMass)} onClick={handleCapture}><Play size={16} />{nextMass === 0 ? '开始采集 0 g 零点' : `已放好 ${weightLabel(nextMass)}，开始采集`}<ArrowRight size={16} /></button><small>{planDirty ? '请先应用重量设置或取消修改' : csvReference.busy ? '等待 CSV 处理完成后开始采集' : !selected.length ? '先选择左侧传感器区域' : !display.fresh ? '等待设备连接与有效新帧' : demo && demoMass !== nextMass ? `请先将示范重量设为 ${weightLabel(nextMass)}` : '采集时请保持砝码位置与接触面不变'}</small></> : <button className="button primary full-width" disabled={planDirty} onClick={handleGenerate}><Activity size={17} />生成 0–20 N 曲线<ArrowRight size={17} /></button>}</div>
          <div className="scope-note"><CircleHelp size={17} /><p>最高档 {weightLabel(weightPlan[weightPlan.length - 1])} ≈ <b>{plannedMaxN.toFixed(3)} N</b>。{plannedMaxN < 20 - 1e-9 ? `${plannedMaxN.toFixed(3)}–20 N 为外推，尚未实测验证。` : "范围内精度仍需独立载荷验证。"}每档各测一次；达到 ADC 255 的数据不参与拟合。</p></div>
          <div className="model-settings"><label>拟合方法<select aria-label="拟合方法" value={fitMode} disabled={collecting} onChange={event => { setFitMode(event.target.value as 'measured' | 'reference'); setResult(null); setError(null); }}><option value="measured">本次六档实测 · 拟合 Hill a、b、n</option><option value="reference">历史参考形状 · 仅校准幅值</option></select></label><p>{fitMode === 'measured' ? '0 g 确定零点，其余五档等权拟合曲线形状。' : '固定历史曲线的 b、n，仅用本次五个非零档校准幅值。换材料或受力区域后需验证参考形状。'}</p></div>{fitMode === 'reference' && <details className="model-settings"><summary>参考曲线参数</summary><div className="shape-fields"><label>b（N）<input aria-label="Hill b" type="number" min="0.001" step="0.0001" value={shapeB} disabled={collecting} onChange={event => { setShapeB(event.target.value); setResult(null); }} /></label><label>n<input aria-label="Hill n" type="number" min="0.001" step="0.0001" value={shapeN} disabled={collecting} onChange={event => { setShapeN(event.target.value); setResult(null); }} /></label></div></details>}
          <button className="text-button reset-button" disabled={collecting || !records.length} onClick={() => { resetMeasurements('已清除本轮数据，请重新采集 0 g。'); if (demo) setDemoMass(0); }}><RefreshCw size={13} />重新开始一轮</button>
        </section>
      </div>
      <div className={'notice ' + (error ? 'error' : '')} role={error ? 'alert' : 'status'}>{error ? <CircleHelp size={17} /> : <CheckCircle2 size={17} />}<span>{error ?? notice}</span></div>
      <CurveChart result={result} points={points} demo={demo} csv={csvReference} collecting={collecting} />
      {result && <section className="panel result-panel" data-testid="calibration-result"><div className="panel-heading"><div><h2>标定结果 {demo && <span className="demo-label">示范</span>}</h2></div><div className="export-actions"><button className="button secondary small" onClick={exportCSV}><Download size={15} />曲线 CSV</button><button className="button secondary small" onClick={exportResult}><Download size={15} />完整 JSON</button></div></div><div className="result-grid"><div className="equation-block"><span>正向方程 · ADC Avg · {result.mode === 'measured' ? '本次六档实测拟合' : '历史参考形状'}</span><code>ADC = {result.offset.toFixed(4)} + {result.a.toFixed(4)} × P^{result.n.toFixed(4)} / ({result.b.toFixed(4)}^{result.n.toFixed(4)} + P^{result.n.toFixed(4)})</code><div className="fit-stats"><span>零点 c <b>{result.offset.toFixed(3)}</b></span><span>非零档 R² <b>{result.r2 === null ? '—' : result.r2.toFixed(4)}</b></span><span>标定点 RMSE <b>{result.rmse.toFixed(3)} ADC</b></span></div><small>RMSE 与 R² 仅反映五个非零档的拟合程度；曲线精度需用独立重量验证。</small></div><div className="inverse-box"><label htmlFor="weight-calibration-adc">ADC → 力值（0–20 N）</label><input id="weight-calibration-adc" type="number" min="0" max="255" step="0.01" placeholder="输入区域 ADC Avg" value={inputADC} onChange={event => setInputADC(event.target.value)} /><strong>{manualForce === null ? inputADC.trim() ? '超出有效范围' : '—' : `${manualForce.toFixed(4)} N`}</strong><small>{manualForce !== null && manualForce > result.measuredMaxN ? '外推结果，未实测验证' : '依本次标定方程反算'}</small></div></div>{result.warnings.map((warning, index) => <p className="result-warning" key={index}>{warning}</p>)}</section>}
  </div>;
}

export default memo(WeightCalibration);
