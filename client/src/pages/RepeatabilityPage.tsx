/**
 * RepeatabilityPage - 重复性检测页面
 * 检测方法B：PLC可编程垂直下压机，间隔1分钟采样，两类数据误差范围±threshold%（可定义）
 */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import SensorMatrix from '@/components/SensorMatrix';
import DataChart, { DataSeries, SERIES_COLORS } from '@/components/DataChart';
import ConsistencyAnalysis from '@/components/ConsistencyAnalysis';
import TestResultCard from '@/components/TestResultCard';
import ParameterPanel from '@/components/ParameterPanel';
import DataTable from '@/components/DataTable';
import SerialMonitor from '@/components/SerialMonitor';
import { useSerialData } from './Home';
import {
  SensorPoint,
  DataRecord,
  generateSensorMatrix,
  generateRepeatabilityData,
  evaluateRepeatability,
  TestResult,
  exportToCSV,
} from '@/lib/sensorData';
import { Play, RefreshCw, Download, Upload } from 'lucide-react';

const DEFAULT_PARAMS = {
  threshold: 8,
  productCount: 10,
  samplesPerProduct: 20,
  forceMin: 10,
  forceMax: 50,
  repeatInterval: 1,
  repeatCount: 30,
  durabilityCount: 10000,
  checkPoints: 5,
};

export default function RepeatabilityPage() {
  // 从 localStorage 恢复矩阵尺寸
  const [matrixRows, setMatrixRows] = useState(() => {
    const saved = localStorage.getItem('matrixRows');
    return saved ? parseInt(saved, 10) : 8;
  });
  const [matrixCols, setMatrixCols] = useState(() => {
    const saved = localStorage.getItem('matrixCols');
    return saved ? parseInt(saved, 10) : 8;
  });
  const [sensors, setSensors] = useState<SensorPoint[]>(() => {
    const rows = localStorage.getItem('matrixRows') ? parseInt(localStorage.getItem('matrixRows')!, 10) : 8;
    const cols = localStorage.getItem('matrixCols') ? parseInt(localStorage.getItem('matrixCols')!, 10) : 8;
    return generateSensorMatrix(rows, cols);
  });
  const [records, setRecords] = useState<DataRecord[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [activeView, setActiveView] = useState<'timeline' | 'scatter' | 'table'>('timeline');

  const selectedSensors = sensors.filter(s => s.selected);
  const { latestSensorMatrix, latestAdcValues, latestRawFrame, isForceConnected, isSensorConnected, latestForceN, sendForceCommand, sensorMatrixSize, sensorFps, forceFps } = useSerialData();

  // 实时将串口ADC数据按行列坐标精确注入传感器矩阵
  useEffect(() => {
    if (latestSensorMatrix && latestSensorMatrix.length > 0) {
      setSensors(prev => prev.map(s => ({
        ...s,
        adcValue: (latestSensorMatrix[s.row]?.[s.col]) ?? 0,
      })));
    } else if (latestAdcValues && latestAdcValues.length > 0) {
      setSensors(prev => prev.map(s => ({
        ...s,
        adcValue: latestAdcValues[s.row * matrixCols + s.col] ?? 0,
      })));
    }
  }, [latestSensorMatrix, latestAdcValues, matrixCols]);

  // 当传感器协议变化时，自动切换矩阵尺寸
  useEffect(() => {
    if (sensorMatrixSize && sensorMatrixSize !== matrixRows) {
      handleMatrixResize(sensorMatrixSize, sensorMatrixSize);
    }
  }, [sensorMatrixSize]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleMatrixResize = useCallback((rows: number, cols: number) => {
    setMatrixRows(rows);
    setMatrixCols(cols);
    setSensors(generateSensorMatrix(rows, cols));
    setRecords([]);
    setResult(null);
    // 保存到 localStorage
    localStorage.setItem('matrixRows', rows.toString());
    localStorage.setItem('matrixCols', cols.toString());
  }, []);

  const handleStart = useCallback(async () => {
    if (selectedSensors.length === 0) {
      toast.error('请先选择至少一个传感器点');
      return;
    }
    setIsRunning(true);
    setResult(null);
    toast.info(`开始重复性检测，间隔 ${params.repeatInterval} 分钟，共 ${params.repeatCount} 次采样...`);

    await new Promise(r => setTimeout(r, 1500));

    const data = generateRepeatabilityData(
      selectedSensors,
      params.repeatCount,
      params.repeatInterval,
      (params.forceMin + params.forceMax) / 2
    );
    setRecords(data);

    const testResult = evaluateRepeatability(data, params.threshold);
    setResult(testResult);
    setIsRunning(false);

    if (testResult.passed === true) {
      toast.success(`重复性检测通过！最大偏差 ${(testResult.maxError ?? 0).toFixed(2)}%`);
    } else {
      toast.error(`重复性检测未通过，最大偏差 ${(testResult.maxError ?? 0).toFixed(2)}% 超出阈值 ±${params.threshold}%`);
    }
  }, [selectedSensors, params]);

  const handleReset = async () => {
    // 向压力计发送 CMD_RESET 归零指令
    if (isForceConnected && sendForceCommand) {
      await sendForceCommand(new Uint8Array([0x23, 0x55, 0x00, 0x0A]));
    }
    setRecords([]);
    setResult(null);
    toast.info('数据已重置');
  };

  const handleExport = () => {
    if (records.length === 0) {
      toast.error('暂无数据可导出');
      return;
    }
    exportToCSV(records, `repeatability_${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`已导出 ${records.length} 条数据`);
  };

  // ─── CSV 多文件上传管理 ──────────────────────────────────────────────────
  const [uploadedSeries, setUploadedSeries] = useState<DataSeries[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 解析 CSV 文本为 DataRecord[] */
  const parseCSVText = useCallback((text: string): DataRecord[] => {
    const clean = text.replace(/^\uFEFF/, '');
    const lines = clean.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    const headerLine = lines[0];
    const parsed: DataRecord[] = [];
    const isFormatA = headerLine.includes('传感器#') || headerLine.includes('压力(N)');
    const isFormatB = headerLine.includes('ADC Value') || headerLine.includes('ADC Sum');

    if (isFormatA) {
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 2) continue;
        const time = cols[0] || '';
        const pressure = parseFloat(cols[1]);
        if (isNaN(pressure) && cols[1]?.trim() === '') continue;
        const adcValues: number[] = [];
        for (let j = 2; j < cols.length; j++) {
          const val = parseInt(cols[j], 10);
          adcValues.push(isNaN(val) ? 0 : val);
        }
        const adcSum = adcValues.reduce((a, b) => a + b, 0);
        parsed.push({
          id: `upload_${i}`,
          timestamp: Date.now() + i,
          time,
          pressure: isNaN(pressure) ? 0 : pressure,
          adcValues,
          adcSum,
          adcSumHex: '0x' + adcSum.toString(16).toUpperCase(),
          testMode: 'repeatability',
          sampleIndex: i - 1,
        });
      }
    } else if (isFormatB) {
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^([^,]*),([^,]*),"([^"]*)",([^,]*),([^,]*),([^,]*),([^,]*),?(.*)$/);
        if (!match) continue;
        const [, time, pressureStr, adcValuesStr, adcSumStr, adcSumHex, testMode, sampleIndexStr, productIndexStr] = match;
        const pressure = parseFloat(pressureStr);
        const adcValues = adcValuesStr.split(';').map(Number);
        const adcSum = parseInt(adcSumStr, 10);
        const sampleIndex = parseInt(sampleIndexStr, 10);
        parsed.push({
          id: `upload_${i}`,
          timestamp: Date.now() + i,
          time: time || '',
          pressure: isNaN(pressure) ? 0 : pressure,
          adcValues,
          adcSum: isNaN(adcSum) ? adcValues.reduce((a, b) => a + b, 0) : adcSum,
          adcSumHex: adcSumHex || '',
          testMode: (testMode as DataRecord['testMode']) || 'repeatability',
          sampleIndex: isNaN(sampleIndex) ? i : sampleIndex,
          productIndex: productIndexStr ? parseInt(productIndexStr, 10) : undefined,
        });
      }
    } else {
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 2) continue;
        const time = cols[0] || '';
        const pressure = parseFloat(cols[1]);
        const adcValues: number[] = [];
        for (let j = 2; j < cols.length; j++) {
          const val = parseInt(cols[j], 10);
          if (!isNaN(val)) adcValues.push(val);
        }
        const adcSum = adcValues.reduce((a, b) => a + b, 0);
        parsed.push({
          id: `upload_${i}`,
          timestamp: Date.now() + i,
          time,
          pressure: isNaN(pressure) ? 0 : pressure,
          adcValues,
          adcSum,
          adcSumHex: '0x' + adcSum.toString(16).toUpperCase(),
          testMode: 'repeatability',
          sampleIndex: i - 1,
        });
      }
    }
    // 过滤：只保留压力上升阶段（0→峰值），舍弃下降阶段（峰值→0）
    if (parsed.length <= 1) return parsed;
    let peakIdx = 0;
    let peakPressure = parsed[0].pressure;
    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i].pressure >= peakPressure) {
        peakPressure = parsed[i].pressure;
        peakIdx = i;
      }
    }
    return parsed.slice(0, peakIdx + 1);
  }, []);

  const handleCSVUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);

    setUploadedSeries(prev => {
      const remaining = 20 - prev.length;
      if (remaining <= 0) {
        toast.error('已达最大文件数量(20)，请先清除部分文件');
        return prev;
      }
      const toProcess = fileArray.slice(0, remaining);
      if (fileArray.length > remaining) {
        toast.warning(`仅导入前 ${remaining} 个文件（已达上限 20）`);
      }

      let successCount = 0;
      let failCount = 0;
      let currentIdx = prev.length;

      toProcess.forEach((file, fi) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const text = ev.target?.result as string;
            const parsed = parseCSVText(text);
            if (parsed.length === 0) {
              failCount++;
              if (successCount + failCount === toProcess.length && failCount > 0) {
                toast.error(`${failCount} 个文件解析失败`);
              }
              return;
            }
            const colorIdx = (currentIdx + fi) % SERIES_COLORS.length;
            const newSeries: DataSeries = {
              id: `file_${Date.now()}_${fi}`,
              name: file.name.replace(/\.csv$/i, ''),
              records: parsed,
              color: SERIES_COLORS[colorIdx],
              visible: true,
            };
            setUploadedSeries(p => [...p, newSeries]);
            successCount++;
            if (successCount + failCount === toProcess.length) {
              toast.success(`已导入 ${successCount} 个文件`);
            }
          } catch (err) {
            failCount++;
            console.error(err);
            if (successCount + failCount === toProcess.length) {
              if (successCount > 0) toast.success(`已导入 ${successCount} 个文件`);
              if (failCount > 0) toast.error(`${failCount} 个文件解析失败`);
            }
          }
        };
        reader.readAsText(file);
      });
      return prev;
    });
    e.target.value = '';
  }, [parseCSVText]);

  const handleToggleSeriesVisible = useCallback((id: string) => {
    setUploadedSeries(prev => prev.map(s => s.id === id ? { ...s, visible: !s.visible } : s));
  }, []);

  const handleRemoveSeries = useCallback((id: string) => {
    setUploadedSeries(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleClearAllSeries = useCallback(() => {
    setUploadedSeries([]);
  }, []);

  // 拟合曲线显示状态
  const [showFitCurve, setShowFitCurve] = useState(true);

  // 构建图表系列（useMemo 避免每次渲染创建新引用）
  const chartSeries = useMemo<DataSeries[]>(() => [
    ...(records.length > 0 ? [{
      id: 'realtime',
      name: '实时采集',
      records,
      color: SERIES_COLORS[0],
      visible: true,
    }] : []),
    ...uploadedSeries,
  ], [records, uploadedSeries]);

  // 全部系列（含不可见的），用于拟合计算
  const allSeriesForFit = useMemo<DataSeries[]>(() => [
    ...(records.length > 0 ? [{
      id: 'realtime',
      name: '实时采集',
      records,
      color: SERIES_COLORS[0],
      visible: true,
    }] : []),
    ...uploadedSeries.map(s => ({ ...s, visible: true })),
  ], [records, uploadedSeries]);

  return (
    <div className="flex h-full gap-0">
      {/* 左侧 */}
      <div
        className="flex flex-col gap-3 p-3 overflow-y-auto"
        style={{
          width: '280px',
          minWidth: '280px',
          borderRight: '1px solid oklch(0.22 0.03 265)',
        }}
      >
        <SensorMatrix
          sensors={sensors}
          rows={matrixRows}
          cols={matrixCols}
          onSelectionChange={setSensors}
          onResize={handleMatrixResize}
        />
        <ParameterPanel params={params} onChange={setParams} mode="repeatability" />

        <div className="flex gap-2">
          <button
            onClick={handleStart}
            disabled={isRunning}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-mono font-medium transition-all disabled:opacity-50"
            style={{
              background: isRunning ? 'oklch(0.58 0.22 265 / 0.3)' : 'oklch(0.58 0.22 265)',
              color: 'white',
            }}
          >
            {isRunning ? (
              <>
                <div className="w-3 h-3 border border-t-transparent rounded-full animate-spin" style={{ borderColor: 'white', borderTopColor: 'transparent' }} />
                采集中...
              </>
            ) : (
              <><Play size={12} />开始检测</>
            )}
          </button>
          <button
            onClick={handleExport}
            disabled={isRunning || records.length === 0}
            className="px-3 py-2 rounded text-xs font-mono transition-all disabled:opacity-40"
            style={{
              background: 'oklch(0.72 0.20 145 / 0.15)',
              border: '1px solid oklch(0.72 0.20 145 / 0.3)',
              color: 'oklch(0.72 0.20 145)',
            }}
            title="导出CSV"
          >
            <Download size={12} />
          </button>
          <button
            onClick={handleReset}
            disabled={isRunning}
            className="px-3 py-2 rounded text-xs font-mono transition-all disabled:opacity-50"
            style={{
              background: 'oklch(0.22 0.03 265)',
              border: '1px solid oklch(0.30 0.03 265)',
              color: 'oklch(0.60 0.02 240)',
            }}
          >
            <RefreshCw size={12} />
          </button>
        </div>

        <TestResultCard
          result={result}
          title="重复性判定"
          description={`判断方法B：同隔${params.repeatInterval}分钟取一次压力数值和ADC求和的数值，判断两类数据在采样期间的误差范围是否在±${params.threshold}%范围内`}
          isRunning={isRunning}
        />

        {/* 数据采集控制面板 */}
        <SerialMonitor
          isRunning={isRunning}
          isForceConnected={isForceConnected}
          isSensorConnected={isSensorConnected}
          realSensorData={latestRawFrame}
          latestForceN={latestForceN}
          latestAdcValues={latestAdcValues}
          selectedSensors={selectedSensors}
          matrixCols={matrixCols}
        />

        {/* 实时统计 */}
        {records.length > 0 && (
          <div
            className="rounded p-3 space-y-2"
            style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}
          >
            <div className="text-xs font-mono mb-2" style={{ color: 'oklch(0.55 0.02 240)' }}>
              统计摘要
            </div>
            {[
              { label: '采样次数', value: records.length.toString() },
              {
                label: '压力均值',
                value: `${(records.reduce((a, r) => a + r.pressure, 0) / records.length).toFixed(2)} N`,
              },
              {
                label: 'ADC Sum均值',
                value: Math.round(records.reduce((a, r) => a + r.adcSum, 0) / records.length).toString(),
              },
              {
                label: '压力标准差',
                value: (() => {
                  const mean = records.reduce((a, r) => a + r.pressure, 0) / records.length;
                  const variance = records.reduce((a, r) => a + Math.pow(r.pressure - mean, 2), 0) / records.length;
                  return `${Math.sqrt(variance).toFixed(3)} N`;
                })(),
              },
            ].map(s => (
              <div key={s.label} className="flex justify-between">
                <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)' }}>{s.label}</span>
                <span className="text-xs font-mono" style={{ color: 'oklch(0.75 0.01 220)' }}>{s.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 右侧图表 */}
      <div className="flex-1 flex flex-col min-w-0 p-3 gap-3">
        {/* 工具说明条 */}
        <div
          className="flex items-center gap-3 px-3 py-1.5 rounded text-xs font-mono"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}
        >
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'oklch(0.72 0.20 145)', flexShrink: 0 }} />
            <span style={{ color: 'oklch(0.72 0.20 145)' }}>PLC可编程垂直下压机 / 机器人灵巧手套</span>
            <span style={{ color: 'oklch(0.40 0.02 240)' }}>——编程检测重复性</span>
          </div>
          <div className="w-px h-3" style={{ background: 'oklch(0.28 0.03 265)' }} />
          <span style={{ color: 'oklch(0.50 0.02 240)' }}>检测方法B：对传感器特定区域按照"检测方法B"测试，并进行逻辑判定</span>
          <div className="w-px h-3" style={{ background: 'oklch(0.28 0.03 265)' }} />
          <span style={{ color: 'oklch(0.55 0.02 240)' }}>同隔{params.repeatInterval}分钟取一次压力数值和ADC求和，共{params.repeatCount}次</span>
          <div className="ml-auto flex items-center gap-2">
            <span style={{ color: 'oklch(0.45 0.02 240)' }}>{selectedSensors.length} 个传感器点已选</span>
            <span style={{ color: 'oklch(0.35 0.02 240)' }}>|</span>
            <span style={{ color: 'oklch(0.45 0.02 240)' }}>矩阵 {matrixRows}×{matrixCols}</span>
          </div>
        </div>

        {/* 视图切换 + CSV 上传 */}
        <div className="flex items-center gap-1">
          {[
            { id: 'timeline', label: '时间序列' },
            { id: 'scatter', label: '散点分布' },
            { id: 'table', label: '数据表格' },
          ].map(v => (
            <button
              key={v.id}
              onClick={() => setActiveView(v.id as typeof activeView)}
              className="px-3 py-1 rounded text-xs font-mono transition-all"
              style={{
                background: activeView === v.id ? 'oklch(0.58 0.22 265 / 0.2)' : 'oklch(0.17 0.025 265)',
                border: `1px solid ${activeView === v.id ? 'oklch(0.58 0.22 265 / 0.5)' : 'oklch(0.25 0.03 265)'}`,
                color: activeView === v.id ? 'oklch(0.70 0.18 200)' : 'oklch(0.55 0.02 240)',
              }}
            >
              {v.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {uploadedSeries.length > 0 && (
              <span className="px-2 py-0.5 rounded text-xs font-mono"
                style={{
                  background: 'oklch(0.72 0.20 145 / 0.15)',
                  border: '1px solid oklch(0.72 0.20 145 / 0.3)',
                  color: 'oklch(0.72 0.20 145)',
                  fontSize: '9px',
                }}
              >
                {uploadedSeries.length} 个文件已导入
              </span>
            )}
            {uploadedSeries.length > 0 && (
              <button
                onClick={handleClearAllSeries}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-all"
                style={{
                  background: 'oklch(0.65 0.22 25 / 0.12)',
                  border: '1px solid oklch(0.65 0.22 25 / 0.3)',
                  color: 'oklch(0.65 0.22 25)',
                }}
              >
                清除全部
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              multiple
              onChange={handleCSVUpload}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadedSeries.length >= 20}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-all disabled:opacity-40"
              style={{
                background: 'oklch(0.58 0.22 265 / 0.15)',
                border: '1px solid oklch(0.58 0.22 265 / 0.3)',
                color: 'oklch(0.70 0.18 200)',
              }}
              title={uploadedSeries.length >= 20 ? '已达最大文件数量' : '上传 CSV 文件（最多20个）'}
            >
              <Upload size={11} />
              上传CSV ({uploadedSeries.length}/20)
            </button>
          </div>
        </div>

        {/* 文件列表 - checkbox 控制显示/隐藏 + Hill 拟合曲线 checkbox */}
        {(uploadedSeries.length > 0 || records.length > 0) && activeView === 'scatter' && (
          <div
            className="flex flex-wrap gap-x-3 gap-y-1 px-2 py-1.5 rounded overflow-y-auto"
            style={{ background: 'oklch(0.15 0.02 265)', border: '1px solid oklch(0.22 0.03 265)', maxHeight: '100px' }}
          >
            {/* Hill 拟合曲线 checkbox */}
            <label
              className="flex items-center gap-1.5 cursor-pointer"
              style={{ fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" }}
            >
              <input
                type="checkbox"
                checked={showFitCurve}
                onChange={() => setShowFitCurve(v => !v)}
                className="w-3 h-3 rounded cursor-pointer"
                style={{ accentColor: '#f0a030' }}
              />
              <svg width="14" height="10" style={{ flexShrink: 0 }}>
                <line x1="0" y1="5" x2="14" y2="5" stroke="#f0a030" strokeWidth="2" strokeDasharray="3 2" />
              </svg>
              <span style={{ color: showFitCurve ? '#f0a030' : 'oklch(0.40 0.02 240)' }}>
                Hill 拟合
              </span>
            </label>
            {/* 数据系列 checkbox */}
            {uploadedSeries.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-1.5 cursor-pointer group"
                style={{ fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" }}
              >
                <input
                  type="checkbox"
                  checked={s.visible}
                  onChange={() => handleToggleSeriesVisible(s.id)}
                  className="w-3 h-3 rounded cursor-pointer"
                  style={{ accentColor: s.color }}
                />
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: s.color }}
                />
                <span
                  style={{
                    color: s.visible ? s.color : 'oklch(0.40 0.02 240)',
                    textDecoration: s.visible ? 'none' : 'line-through',
                    maxWidth: '120px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={`${s.name} (${s.records.length}条)`}
                >
                  {s.name}
                </span>
                <span style={{ color: 'oklch(0.40 0.02 240)', fontSize: '9px' }}>
                  ({s.records.length})
                </span>
                <button
                  onClick={(e) => { e.preventDefault(); handleRemoveSeries(s.id); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5"
                  style={{ color: 'oklch(0.65 0.22 25)', fontSize: '10px', lineHeight: 1 }}
                  title="移除此文件"
                >
                  ×
                </button>
              </label>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0">
          {activeView === 'timeline' && (
            <DataChart
              records={records}
              title={`重复性 - 时间序列（间隔${params.repeatInterval}分钟采样）`}
              showBrush={records.length > 20}
            />
          )}

          {activeView === 'scatter' && (
            <DataChart
              series={chartSeries}
              allSeriesForFit={allSeriesForFit}
              showFitCurve={showFitCurve}
              onFitCurveToggle={setShowFitCurve}
              title="压力 vs ADC Sum 散点图（含 Hill 拟合）"
            />
          )}

          {activeView === 'table' && (
            <DataTable records={records} onClear={handleReset} />
          )}
        </div>

        {/* 一致性评估：CV 分析 + 残差分布 */}
        <div className="mt-3">
          <ConsistencyAnalysis allSeries={allSeriesForFit} />
        </div>
      </div>
    </div>
  );
}
