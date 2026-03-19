/**
 * TestPage - 测试页面
 * 展示设备连接状态、传感器数据实时监控、力学仪器数据显示
 * 支持数据采集和 CSV 导出
 * 
 * 采集策略（双保险）：
 * 1. 优先从 SensorDataStreamV2 全局单例获取传感器数据（零延迟，不经过React）
 * 2. 备用从 Context 的 latestSensorMatrix 获取（通过 Ref 同步）
 * 3. 压力数据通过 Ref 同步（更新频率低，useEffect 足够）
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import SensorMatrix from '@/components/SensorMatrix';
import PressureChart from '@/components/PressureChart';
import { useSerialData } from './Home';
import { getSensorDataStreamV2 } from '@/lib/sensorDataStreamV2';
import { getRealtimeDataPipeline } from '@/lib/realtimeDataPipeline';
import { generateSensorMatrix, SensorPoint } from '@/lib/sensorData';
import { CheckCircle2, AlertCircle, Zap, Circle, Square, Download } from 'lucide-react';
import HandMatrix, { getHandIndices } from '@/components/HandMatrix';
import type { HandSide } from '@/components/HandMatrix';

interface DataRecord {
  timestamp: number;
  pressure: number | null;
  adcValues: number[];
}

export default function TestPage() {
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
    const matrix = generateSensorMatrix(rows, cols);
    // 从 localStorage 恢复选点状态
    try {
      const savedSelection = localStorage.getItem('selectedSensorPoints');
      if (savedSelection) {
        const selectedSet = new Set<string>(JSON.parse(savedSelection));
        return matrix.map(s => ({ ...s, selected: selectedSet.has(`${s.row}_${s.col}`) }));
      }
    } catch {}
    return matrix;
  });
  const { latestForceN, latestSensorMatrix, latestAdcValues, isForceConnected, isSensorConnected, sensorDeviceType, sensorProtocol, sensorMatrixSize } = useSerialData();

  // LH/RH 时切换手形矩阵
  const handSide: HandSide | null = (sensorDeviceType === 'LH' || sensorDeviceType === 'RH') ? sensorDeviceType : null;

  // HandMatrix 选点状态（基于数组编号）
  const [handSelectedIndices, setHandSelectedIndices] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem('handSelectedIndices');
      if (saved) return new Set<number>(JSON.parse(saved));
    } catch {}
    return new Set<number>();
  });

  useEffect(() => {
    localStorage.setItem('handSelectedIndices', JSON.stringify([...handSelectedIndices]));
  }, [handSelectedIndices]);

  const handleHandToggleSelect = useCallback((arrayIndex: number) => {
    setHandSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(arrayIndex)) {
        next.delete(arrayIndex);
      } else {
        next.add(arrayIndex);
      }
      return next;
    });
  }, []);

  // 当传感器协议变化时，自动切换矩阵尺寸
  useEffect(() => {
    if (sensorMatrixSize && sensorMatrixSize !== matrixRows) {
      handleMatrixSizeChange(sensorMatrixSize, sensorMatrixSize);
    }
  }, [sensorMatrixSize]);

  // 数据采集状态
  const [isRecording, setIsRecording] = useState(false);
  const [recordedData, setRecordedData] = useState<DataRecord[]>([]);
  const recordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // ===== 使用 Ref 保存最新数据，避免 setInterval 闭包捕获旧值 =====
  const latestForceNRef = useRef<number | null>(null);
  const latestSensorMatrixRef = useRef<number[][] | null>(null);
  
  // 每次数据更新时同步到 Ref（这些 useEffect 在每次 render 后执行）
  useEffect(() => {
    latestForceNRef.current = latestForceN;
  }, [latestForceN]);
  
  useEffect(() => {
    if (latestSensorMatrix) {
      latestSensorMatrixRef.current = latestSensorMatrix;
    }
  }, [latestSensorMatrix]);

  // 更新矩阵尺寸并保存到 localStorage
  const handleMatrixSizeChange = (rows: number, cols: number) => {
    if (rows >= 1 && rows <= 64 && cols >= 1 && cols <= 64) {
      setMatrixRows(rows);
      setMatrixCols(cols);
      setSensors(generateSensorMatrix(rows, cols));
      localStorage.setItem('matrixRows', rows.toString());
      localStorage.setItem('matrixCols', cols.toString());
    }
  };

  // 更新传感器数据，同时保存选点到 localStorage
  const handleSensorChange = (updatedSensors: SensorPoint[]) => {
    setSensors(updatedSensors);
    const selectedKeys = updatedSensors.filter(s => s.selected).map(s => `${s.row}_${s.col}`);
    localStorage.setItem('selectedSensorPoints', JSON.stringify(selectedKeys));
  };

  // 采集数据缓冲区（不用 React State，避免频繁重新渲染）
  const recordBufferRef = useRef<DataRecord[]>([]);
  
  // ===== 导出CSV（使用 useCallback 确保引用稳定） =====
  // 使用 Ref 保存 sensors 和 matrixCols 的最新值，供 exportCSV 使用
  const sensorsRef = useRef(sensors);
  const matrixColsRef = useRef(matrixCols);
  const handSelectedIndicesRef = useRef(handSelectedIndices);
  useEffect(() => { sensorsRef.current = sensors; }, [sensors]);
  useEffect(() => { matrixColsRef.current = matrixCols; }, [matrixCols]);
  useEffect(() => { handSelectedIndicesRef.current = handSelectedIndices; }, [handSelectedIndices]);
  
  const doExportCSV = useCallback((dataToExport: DataRecord[]) => {
    if (dataToExport.length === 0) {
      alert('暂无采集数据');
      return;
    }

    const handIndices = handSelectedIndicesRef.current;
    const hasHandSelection = handIndices && handIndices.size > 0;
    let selectedIndices: number[];
    if (hasHandSelection) {
      // HandMatrix 模式：数组编号即为索引（从1开始）
      selectedIndices = [...handIndices].sort((a, b) => a - b);
    } else {
      const currentSensors = sensorsRef.current;
      const currentMatrixCols = matrixColsRef.current;
      const selectedSensors = currentSensors.filter(s => s.selected);
      selectedIndices = selectedSensors.map(s => s.row * currentMatrixCols + s.col + 1);
    }

    // 时间戳格式化函数：将 Date.now() 毫秒时间戳转为 xxh.xxm.xxs.xxxms
    const formatTimestamp = (ts: number) => {
      const d = new Date(ts);
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      const ms = String(d.getMilliseconds()).padStart(3, '0');
      return `${h}h.${m}m.${s}s.${ms}ms`;
    };

    // 构建CSV内容 (BOM + 表头)
    let csv = '\uFEFF时间,压力(N)';
    if (selectedIndices.length > 0) {
      csv += ',' + selectedIndices.map(idx => `传感器#${idx}`).join(',');
    }
    csv += '\n';

    dataToExport.forEach(data => {
      const pressure = data.pressure !== null ? data.pressure.toFixed(2) : '';
      csv += `${formatTimestamp(data.timestamp)},${pressure}`;
      
      if (selectedIndices.length > 0) {
        selectedIndices.forEach(idx => {
          const adcIdx = idx - 1;
          const adcVal = adcIdx < data.adcValues.length ? data.adcValues[adcIdx] : '';
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

  // 手动导出按钮
  const handleExportCSV = useCallback(() => {
    const dataToExport = recordBufferRef.current.length > 0 ? recordBufferRef.current : recordedData;
    doExportCSV(dataToExport);
  }, [recordedData, doExportCSV]);

  // 开始采集
  const handleStartRecording = useCallback(() => {
    // 清理上一次的缓冲区和状态
    recordBufferRef.current = [];
    setRecordedData([]);
    setIsRecording(true);
    
    // 获取全局单例引用（零延迟，不经过 React State/Props/useEffect）
    const sensorStream = getSensorDataStreamV2();
    const dataPipeline = getRealtimeDataPipeline();
    
    recordIntervalRef.current = setInterval(() => {
      // 压力数据：直接从 RealtimeDataPipeline 全局单例获取（零延迟）
      const pressure = dataPipeline.getLatestForce();
      
      // 传感器数据：双保险策略
      // 方案1：从 SensorDataStreamV2 全局单例获取（零延迟，在 processSensorPackets 中同步写入）
      let currentAdcValues: number[] = [];
      const streamAdcValues = sensorStream.getLatestAdcValues();
      if (streamAdcValues && streamAdcValues.length > 0) {
        currentAdcValues = [...streamAdcValues];
      } else {
        // 方案2：从 Context Ref 获取（备用）
        const matrix = latestSensorMatrixRef.current;
        if (matrix && matrix.length > 0) {
          currentAdcValues = matrix.flat();
        }
      }
      
      recordBufferRef.current.push({
        timestamp: Date.now(),
        pressure,
        adcValues: currentAdcValues,
      });
    }, 10); // 每10ms采集一次
  }, []);

  // 停止采集（停止后自动导出）
  const handleStopRecording = useCallback(() => {
    // 先停止定时器
    if (recordIntervalRef.current) {
      clearInterval(recordIntervalRef.current);
      recordIntervalRef.current = null;
    }
    setIsRecording(false);
    
    // 取出缓冲区数据
    const data = [...recordBufferRef.current];
    setRecordedData(data);
    
    // 直接导出（不依赖 state 更新，直接传入数据）
    if (data.length > 0) {
      // 使用 setTimeout 确保浏览器有时间处理 UI 更新
      setTimeout(() => {
        doExportCSV(data);
      }, 50);
    }
  }, [doExportCSV]);

  // 清理
  useEffect(() => {
    return () => {
      if (recordIntervalRef.current) {
        clearInterval(recordIntervalRef.current);
      }
    };
  }, []);

  const selectedCount = sensors.filter(s => s.selected).length;
  const adcSum = latestAdcValues ? latestAdcValues.reduce((a, b) => a + b, 0) : 0;
  const recordCount = recordedData.length;

  return (
    <div className="flex flex-col h-full p-4 gap-4" style={{ background: 'oklch(0.13 0.02 265)' }}>
      {/* 采集控制按钮 */}
      <div className="flex items-center gap-2">
        {!isRecording ? (
          <button
            onClick={handleStartRecording}
            disabled={!isForceConnected || !isSensorConnected}
            className="flex items-center gap-2 px-3 py-2 rounded text-xs font-mono transition-colors disabled:opacity-50"
            style={{
              background: (isForceConnected && isSensorConnected) ? 'oklch(0.72 0.20 145 / 0.15)' : 'oklch(0.20 0.025 265)',
              border: `1px solid ${(isForceConnected && isSensorConnected) ? 'oklch(0.72 0.20 145 / 0.3)' : 'oklch(0.28 0.03 265)'}`,
              color: (isForceConnected && isSensorConnected) ? 'oklch(0.72 0.20 145)' : 'oklch(0.45 0.02 240)',
            }}
            title="开始采集数据"
          >
            <Circle size={12} />
            <span>采集</span>
          </button>
        ) : (
          <button
            onClick={handleStopRecording}
            className="flex items-center gap-2 px-3 py-2 rounded text-xs font-mono transition-colors"
            style={{
              background: 'oklch(0.65 0.22 25 / 0.15)',
              border: '1px solid oklch(0.65 0.22 25 / 0.3)',
              color: 'oklch(0.65 0.22 25)',
            }}
            title="停止采集"
          >
            <Square size={12} />
            <span>停止</span>
          </button>
        )}
        
        {recordCount > 0 && !isRecording && (
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3 py-2 rounded text-xs font-mono transition-colors"
            style={{
              background: 'oklch(0.75 0.18 55 / 0.15)',
              border: '1px solid oklch(0.75 0.18 55 / 0.3)',
              color: 'oklch(0.75 0.18 55)',
            }}
            title="导出CSV文件"
          >
            <Download size={12} />
            <span>导出</span>
          </button>
        )}
      </div>

      {/* 顶部设备连接状态卡片 */}
      <div className="grid grid-cols-2 gap-3">
        {/* 力学仪器连接状态 */}
        <div
          className="rounded p-3"
          style={{
            background: 'oklch(0.17 0.025 265)',
            border: `1px solid ${isForceConnected ? 'oklch(0.70 0.18 200 / 0.4)' : 'oklch(0.25 0.03 265)'}`,
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            {isForceConnected ? (
              <CheckCircle2 size={14} style={{ color: 'oklch(0.70 0.18 200)' }} />
            ) : (
              <AlertCircle size={14} style={{ color: 'oklch(0.65 0.22 25)' }} />
            )}
            <span className="text-xs font-mono font-medium" style={{ color: isForceConnected ? 'oklch(0.70 0.18 200)' : 'oklch(0.65 0.22 25)' }}>
              力学仪器 (CL2-500N-MH01)
            </span>
          </div>
          <div className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
            状态: <span style={{ color: isForceConnected ? 'oklch(0.72 0.20 145)' : 'oklch(0.40 0.02 240)' }}>
              {isForceConnected ? '已连接' : '未连接'}
            </span>
          </div>
          {isForceConnected && latestForceN !== null && (
            <div className="mt-2 text-xs font-mono" style={{ color: 'oklch(0.72 0.20 145)' }}>
              压力: <span style={{ fontWeight: 600 }}>{latestForceN.toFixed(2)} N</span>
            </div>
          )}
        </div>

        {/* 传感器产品连接状态 */}
        <div
          className="rounded p-3"
          style={{
            background: 'oklch(0.17 0.025 265)',
            border: `1px solid ${isSensorConnected ? 'oklch(0.72 0.20 145 / 0.4)' : 'oklch(0.25 0.03 265)'}`,
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            {isSensorConnected ? (
              <CheckCircle2 size={14} style={{ color: 'oklch(0.72 0.20 145)' }} />
            ) : (
              <AlertCircle size={14} style={{ color: 'oklch(0.65 0.22 25)' }} />
            )}
            <span className="text-xs font-mono font-medium" style={{ color: isSensorConnected ? 'oklch(0.72 0.20 145)' : 'oklch(0.65 0.22 25)' }}>
              传感器产品 (织物触觉传感器)
            </span>
          </div>
          <div className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
            状态: <span style={{ color: isSensorConnected ? 'oklch(0.72 0.20 145)' : 'oklch(0.40 0.02 240)' }}>
              {isSensorConnected ? '已连接' : '未连接'}
            </span>
          </div>
          {isSensorConnected && adcSum > 0 && (
            <div className="mt-2 text-xs font-mono" style={{ color: 'oklch(0.70 0.18 200)' }}>
              ADC Sum: <span style={{ fontWeight: 600 }}>0x{adcSum.toString(16).toUpperCase().padStart(8, '0')}</span>
            </div>
          )}
        </div>
      </div>

      {/* 中间主区域：传感器矩阵 + 压力图表 */}
      <div className="flex-1 min-h-0 flex gap-4">
        {/* 传感器数组显示（左侧，增加1.5倍） */}
        <div
          className="rounded p-4 flex flex-col min-h-0"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', flex: '1.3' }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap size={14} style={{ color: 'oklch(0.70 0.18 200)' }} />
              <span className="text-sm font-mono font-medium" style={{ color: 'oklch(0.70 0.18 200)' }}>
                传感器数组实时监控
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
              <span>矩阵: {matrixRows}×{matrixCols}</span>
              <span style={{ color: 'oklch(0.35 0.02 240)' }}>|</span>
              <span>已选: {selectedCount}</span>
            </div>
          </div>

          {/* 矩阵尺寸调整 */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)' }}>矩阵尺寸:</span>
            <input
              type="number"
              min={1}
              max={16}
              value={matrixRows}
              onChange={e => handleMatrixSizeChange(parseInt(e.target.value), matrixCols)}
              className="w-14 px-2 py-1.5 rounded text-xs font-mono outline-none"
              style={{
                background: 'oklch(0.12 0.02 265)',
                border: '1px solid oklch(0.25 0.03 265)',
                color: 'oklch(0.82 0.01 220)',
              }}
            />
            <span style={{ color: 'oklch(0.50 0.02 240)' }}>×</span>
            <input
              type="number"
              min={1}
              max={16}
              value={matrixCols}
              onChange={e => handleMatrixSizeChange(matrixRows, parseInt(e.target.value))}
              className="w-14 px-2 py-1.5 rounded text-xs font-mono outline-none"
              style={{
                background: 'oklch(0.12 0.02 265)',
                border: '1px solid oklch(0.25 0.03 265)',
                color: 'oklch(0.82 0.01 220)',
              }}
            />
          </div>

          {/* 传感器矩阵 */}
          <div className="flex-1 min-h-0 overflow-auto">
            {handSide ? (
              <HandMatrix
                side={handSide}
                adcValues={latestAdcValues}
                showIndex={true}
                selectedIndices={handSelectedIndices}
                onToggleSelect={handleHandToggleSelect}
              />
            ) : (
              <div style={{ transform: 'scale(1.15)', transformOrigin: 'top left', width: '86.96%' }}>
                <SensorMatrix
                  sensors={sensors}
                  onSelectionChange={handleSensorChange}
                  rows={matrixRows}
                  cols={matrixCols}
                  realtimeMatrix={latestSensorMatrix ?? undefined}
                  isConnected={isSensorConnected}
                />
              </div>
            )}
          </div>
        </div>

        {/* 压力图表显示（右侧） */}
        <div
          className="rounded p-4 flex flex-col min-h-0"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', flex: '1' }}
        >
          <PressureChart />
        </div>
      </div>

      {/* 实时数据面板 */}
      {(isForceConnected || isSensorConnected) && (
        <div
          className="rounded p-3"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}
        >
          <div className="text-xs font-mono font-medium mb-2" style={{ color: 'oklch(0.70 0.18 200)' }}>
            实时数据监控
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs font-mono">
            {isForceConnected && (
              <div>
                <div style={{ color: 'oklch(0.50 0.02 240)' }}>压力 (N)</div>
                <div style={{ color: 'oklch(0.72 0.20 145)', fontSize: '14px', fontWeight: 600, marginTop: '4px' }}>
                  {latestForceN !== null ? latestForceN.toFixed(2) : '--'}
                </div>
              </div>
            )}
            {isSensorConnected && (
              <>
                <div>
                  <div style={{ color: 'oklch(0.50 0.02 240)' }}>ADC Sum</div>
                  <div style={{ color: 'oklch(0.70 0.18 200)', fontSize: '14px', fontWeight: 600, marginTop: '4px' }}>
                    {adcSum}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'oklch(0.50 0.02 240)' }}>ADC Sum (HEX)</div>
                  <div style={{ color: 'oklch(0.70 0.18 200)', fontSize: '14px', fontWeight: 600, marginTop: '4px' }}>
                    0x{adcSum.toString(16).toUpperCase().padStart(8, '0')}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
