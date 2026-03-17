/**
 * SerialMonitor - 数据采集控制面板
 * 支持开始/停止采集、自动保存CSV文件、生成基准文件
 * 
 * 数据源策略（全部绕过 React State，零延迟）：
 * - 传感器数据：从 SensorDataStreamV2 全局单例获取（在 useSerialPort processSensorPackets 中同步写入）
 * - 压力数据：从 RealtimeDataPipeline 全局单例获取（在 Home.tsx onForceData 中同步写入）
 * - 不依赖 props 传递的 latestForceN 或 latestAdcValues
 * - 不使用 useEffect 同步 Ref（这是之前延迟的根源）
 * 
 * 采集策略：
 * - 使用 setInterval 每10ms采集一次
 * - 数据直接写入 bufferRef（不触发 React 重渲染）
 * - 停止时一次性导出 CSV
 * - 每次开始采集都会清空上一次的数据，支持无限次采集
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Circle, Square, Save, FileText } from 'lucide-react';
import { getSensorDataStreamV2 } from '@/lib/sensorDataStreamV2';
import { getRealtimeDataPipeline } from '@/lib/realtimeDataPipeline';

interface DataRecord {
  timestamp: number;
  pressure: number | null;
  adcValues: number[];
}

interface SerialMonitorProps {
  isRunning?: boolean;
  onDataReceived?: (pressure: number, adcValues: number[]) => void;
  realForceData?: string | null;
  realSensorData?: string | null;
  isForceConnected?: boolean;
  isSensorConnected?: boolean;
  baudRate?: number;
  latestForceN?: number | null;
  latestAdcValues?: number[] | null;
  selectedSensors?: Array<{ row: number; col: number }>;
  matrixCols?: number;
}

export default function SerialMonitor({
  isRunning = false,
  isForceConnected = false,
  isSensorConnected = false,
  latestForceN = null,
  latestAdcValues = null,
  selectedSensors = [],
  matrixCols = 8,
}: SerialMonitorProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordCount, setRecordCount] = useState(0);
  
  // 采集缓冲区（不用 React State，避免频繁重渲染）
  const bufferRef = useRef<DataRecord[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const countIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // 只用 Ref 保存 selectedSensors 和 matrixCols（这两个不是高频更新的）
  const selectedSensorsRef = useRef(selectedSensors);
  const matrixColsRef = useRef(matrixCols);
  
  // 同步低频 props 到 Ref（这两个变化频率很低，不会造成延迟）
  useEffect(() => { selectedSensorsRef.current = selectedSensors; }, [selectedSensors]);
  useEffect(() => { matrixColsRef.current = matrixCols; }, [matrixCols]);
  
  // ===== 导出 CSV =====
  const doExportCSV = useCallback((dataToExport: DataRecord[]) => {
    if (dataToExport.length === 0) {
      alert('暂无采集数据');
      return;
    }
    
    const currentSensors = selectedSensorsRef.current;
    const currentMatrixCols = matrixColsRef.current;
    const selectedIndices = currentSensors.map(s => s.row * currentMatrixCols + s.col);

    // 时间戳格式化函数：将 Date.now() 毫秒时间戳转为 xxh.xxm.xxs.xxxms
    const formatTimestamp = (ts: number) => {
      const d = new Date(ts);
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      const ms = String(d.getMilliseconds()).padStart(3, '0');
      return `${h}h.${m}m.${s}s.${ms}ms`;
    };

    // 构建CSV内容（BOM + 表头）
    let csv = '\uFEFF时间,压力(N)';
    if (selectedIndices.length > 0) {
      csv += ',' + selectedIndices.map(idx => `传感器#${idx + 1}`).join(',');
    }
    csv += '\n';

    // 数据行
    dataToExport.forEach(data => {
      const pressure = data.pressure !== null && data.pressure !== undefined
        ? data.pressure.toFixed(2)
        : '';
      csv += `${formatTimestamp(data.timestamp)},${pressure}`;
      
      if (selectedIndices.length > 0) {
        selectedIndices.forEach(idx => {
          const adcVal = idx < data.adcValues.length ? data.adcValues[idx] : '';
          csv += `,${adcVal}`;
        });
      }
      csv += '\n';
    });

    // 下载CSV
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `test-data-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);
  
  // ===== 开始采集 =====
  const handleStartRecording = useCallback(() => {
    if (selectedSensorsRef.current.length === 0) {
      alert('请先在传感器矩阵中选择至少一个点位后再开始采集');
      return;
    }
    
    // 清空上一次的数据
    bufferRef.current = [];
    setRecordCount(0);
    startTimeRef.current = Date.now();
    setIsRecording(true);
    
    // 获取全局单例引用（在 setInterval 外部获取，避免重复调用）
    const sensorStream = getSensorDataStreamV2();
    const dataPipeline = getRealtimeDataPipeline();
    
    // 主采集定时器：每10ms采集一次
    intervalRef.current = setInterval(() => {
      const absoluteTime = Date.now();
      
      // 压力数据：直接从 RealtimeDataPipeline 全局单例获取（零延迟）
      const pressure = dataPipeline.getLatestForce();
      
      // 传感器数据：直接从 SensorDataStreamV2 全局单例获取（零延迟）
      let currentAdcValues: number[] = [];
      const streamAdcValues = sensorStream.getLatestAdcValues();
      if (streamAdcValues && streamAdcValues.length > 0) {
        currentAdcValues = [...streamAdcValues];
      }
      
      bufferRef.current.push({
        timestamp: absoluteTime,
        pressure,
        adcValues: currentAdcValues,
      });
    }, 10);
    
    // UI 计数更新定时器：每500ms更新一次显示的采集条数（低频，不影响性能）
    countIntervalRef.current = setInterval(() => {
      setRecordCount(bufferRef.current.length);
    }, 500);
  }, []);
  
  // ===== 停止采集（自动导出） =====
  const handleStopRecording = useCallback(() => {
    // 先停止所有定时器
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (countIntervalRef.current) {
      clearInterval(countIntervalRef.current);
      countIntervalRef.current = null;
    }
    setIsRecording(false);
    
    // 取出缓冲区数据
    const data = [...bufferRef.current];
    setRecordCount(data.length);
    
    // 自动导出 CSV
    if (data.length > 0) {
      setTimeout(() => {
        doExportCSV(data);
      }, 50);
    }
  }, [doExportCSV]);
  
  // ===== 生成基准文件 =====
  const handleGenerateBaseline = useCallback(() => {
    const dataToExport = bufferRef.current;
    if (dataToExport.length === 0) {
      alert('暂无采集数据，无法生成基准文件');
      return;
    }

    const currentSensors = selectedSensorsRef.current;
    const currentMatrixCols = matrixColsRef.current;
    const selectedIndices = currentSensors.map(s => s.row * currentMatrixCols + s.col);

    // 计算统计数据
    const pressureValues = dataToExport.filter(d => d.pressure !== null).map(d => d.pressure as number);
    const avgPressure = pressureValues.length > 0 ? pressureValues.reduce((a, b) => a + b, 0) / pressureValues.length : 0;
    const maxPressure = pressureValues.length > 0 ? Math.max(...pressureValues) : 0;
    const minPressure = pressureValues.length > 0 ? Math.min(...pressureValues) : 0;

    // 计算每个传感器的平均ADC值
    const adcStats: Record<number, number[]> = {};
    selectedIndices.forEach(idx => { adcStats[idx] = []; });

    dataToExport.forEach(data => {
      selectedIndices.forEach(idx => {
        if (data.adcValues[idx] !== undefined) {
          adcStats[idx].push(data.adcValues[idx]);
        }
      });
    });

    const baseline = {
      timestamp: new Date().toISOString(),
      testType: '基准测试',
      totalDataPoints: dataToExport.length,
      pressure: {
        average: avgPressure.toFixed(2),
        max: maxPressure.toFixed(2),
        min: minPressure.toFixed(2),
        samples: pressureValues.length,
      },
      sensorADC: Object.entries(adcStats).reduce((acc, [idx, values]) => {
        const avgADC = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        acc[`传感器#${Number(idx) + 1}`] = {
          average: avgADC.toFixed(2),
          max: values.length > 0 ? Math.max(...values) : 0,
          min: values.length > 0 ? Math.min(...values) : 0,
          samples: values.length,
        };
        return acc;
      }, {} as Record<string, any>),
    };

    const blob = new Blob([JSON.stringify(baseline, null, 2)], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `baseline-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (countIntervalRef.current) {
        clearInterval(countIntervalRef.current);
      }
    };
  }, []);

  const adcSum = latestAdcValues ? latestAdcValues.reduce((a, b) => a + b, 0) : 0;

  return (
    <div
      className="flex flex-col rounded overflow-hidden"
      style={{
        background: 'oklch(0.17 0.025 265)',
        border: '1px solid oklch(0.25 0.03 265)',
      }}
    >
      {/* 标题栏 */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ background: 'oklch(0.15 0.025 265)', borderBottom: '1px solid oklch(0.20 0.03 265)' }}
      >
        <div className="flex items-center gap-2">
          <FileText size={14} style={{ color: 'oklch(0.70 0.18 200)' }} />
          <span className="text-sm font-mono font-medium" style={{ color: 'oklch(0.70 0.18 200)' }}>
            数据采集控制
          </span>
        </div>
        <div className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
          已采集: <span style={{ color: 'oklch(0.72 0.20 145)', fontWeight: 600 }}>{recordCount}</span> 条数据
        </div>
      </div>

      {/* 实时数据显示 */}
      {(isForceConnected || isSensorConnected) && (
        <div className="px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid oklch(0.20 0.03 265)' }}>
          <div className="grid grid-cols-3 gap-3 text-xs font-mono">
            {(isForceConnected || latestForceN !== null) && (
              <div
                className="rounded p-2"
                style={{ background: 'oklch(0.12 0.02 265)', border: '1px solid oklch(0.25 0.03 265)' }}
              >
                <div style={{ color: 'oklch(0.50 0.02 240)' }}>压力 (N)</div>
                <div style={{ color: 'oklch(0.72 0.20 145)', fontSize: '14px', fontWeight: 600, marginTop: '4px' }}>
                  {latestForceN !== null ? latestForceN.toFixed(2) : '--'}
                </div>
              </div>
            )}
            {isSensorConnected && (
              <>
                <div
                  className="rounded p-2"
                  style={{ background: 'oklch(0.12 0.02 265)', border: '1px solid oklch(0.25 0.03 265)' }}
                >
                  <div style={{ color: 'oklch(0.50 0.02 240)' }}>ADC Sum</div>
                  <div style={{ color: 'oklch(0.70 0.18 200)', fontSize: '14px', fontWeight: 600, marginTop: '4px' }}>
                    {adcSum}
                  </div>
                </div>
                <div
                  className="rounded p-2"
                  style={{ background: 'oklch(0.12 0.02 265)', border: '1px solid oklch(0.25 0.03 265)' }}
                >
                  <div style={{ color: 'oklch(0.50 0.02 240)' }}>ADC Sum (HEX)</div>
                  <div style={{ color: 'oklch(0.70 0.18 200)', fontSize: '14px', fontWeight: 600, marginTop: '4px', fontFamily: "'IBM Plex Mono', monospace" }}>
                    0x{adcSum.toString(16).toUpperCase().padStart(4, '0')}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 采集状态显示 */}
      {isRecording && (
        <div className="px-4 py-2 flex items-center gap-2 text-xs font-mono" style={{ color: 'oklch(0.70 0.18 200)', borderBottom: '1px solid oklch(0.20 0.03 265)' }}>
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'oklch(0.65 0.22 25)' }} />
          采集中... 数据源: {isForceConnected ? '压力计' : ''}{isForceConnected && isSensorConnected ? ' + ' : ''}{isSensorConnected ? '传感器' : ''}
        </div>
      )}

      {/* 采集控制按钮 */}
      <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
        {!isRecording ? (
          <button
            onClick={handleStartRecording}
            disabled={!isForceConnected && !isSensorConnected}
            className="flex items-center gap-2 px-4 py-2 rounded text-sm font-mono font-medium transition-colors disabled:opacity-50"
            style={{
              background: (isForceConnected || isSensorConnected) ? 'oklch(0.72 0.20 145 / 0.2)' : 'oklch(0.20 0.025 265)',
              border: `1px solid ${(isForceConnected || isSensorConnected) ? 'oklch(0.72 0.20 145 / 0.4)' : 'oklch(0.28 0.03 265)'}`,
              color: (isForceConnected || isSensorConnected) ? 'oklch(0.72 0.20 145)' : 'oklch(0.45 0.02 240)',
            }}
            title="开始采集数据"
          >
            <Circle size={14} />
            <span>开始采集</span>
          </button>
        ) : (
          <button
            onClick={handleStopRecording}
            className="flex items-center gap-2 px-4 py-2 rounded text-sm font-mono font-medium transition-colors"
            style={{
              background: 'oklch(0.65 0.22 25 / 0.2)',
              border: '1px solid oklch(0.65 0.22 25 / 0.4)',
              color: 'oklch(0.65 0.22 25)',
            }}
            title="停止采集并自动保存CSV"
          >
            <Square size={14} />
            <span>停止采集</span>
          </button>
        )}

        {recordCount > 0 && !isRecording && (
          <button
            onClick={handleGenerateBaseline}
            className="flex items-center gap-2 px-4 py-2 rounded text-sm font-mono font-medium transition-colors"
            style={{
              background: 'oklch(0.70 0.18 200 / 0.2)',
              border: '1px solid oklch(0.70 0.18 200 / 0.4)',
              color: 'oklch(0.70 0.18 200)',
            }}
            title="生成基准测试文件（JSON格式）"
          >
            <Save size={14} />
            <span>生成基准文件</span>
          </button>
        )}
      </div>
    </div>
  );
}
