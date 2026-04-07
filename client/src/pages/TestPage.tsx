/**
 * TestPage - 测试页面
 * 展示设备连接状态、传感器数据实时监控、力学仪器数据显示
 * 支持数据采集和 CSV 导出
 * 
 * 采集策略（双保险）：
 * 1. 优先从 SensorDataStreamV2 全局单例获取传感器数据（零延迟，不经过React）
 * 2. 备用从 Context 的 latestSensorMatrix 获取（通过 Ref 同步）
 * 3. 压力数据通过 Ref 同步（更新频率低，useEffect 足够）
 * 
 * v1.8.2 新增：手掌布局/矩阵显示切换开关，连接手套(LH/RH)时可自由选择显示模式
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import SensorMatrix from '@/components/SensorMatrix';
import HandMatrix, { getHandIndices } from '@/components/HandMatrix';
import type { HandSide } from '@/components/HandMatrix';
import PressureChart from '@/components/PressureChart';
import { useSerialData } from './Home';
import { getRealtimeDataPipeline } from '@/lib/realtimeDataPipeline';
import { generateSensorMatrix, SensorPoint } from '@/lib/sensorData';
import { CheckCircle2, AlertCircle, Zap, Circle, Square, Download, Hand, Grid3x3 } from 'lucide-react';

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
  const { latestForceN, latestSensorMatrix, latestAdcValues, isForceConnected, isSensorConnected, sensorDeviceType, sensorProtocol, sensorMatrixSize, sensorFps, forceFps } = useSerialData();

  // ===== 手掌布局/矩阵显示切换 =====
  const handSide: HandSide | null = (sensorDeviceType === 'LH' || sensorDeviceType === 'RH') ? sensorDeviceType : null;
  
  // 从 localStorage 恢复显示模式偏好（true=手掌布局, false=矩阵显示）
  const [useHandLayout, setUseHandLayout] = useState(() => {
    const saved = localStorage.getItem('testPage_useHandLayout');
    return saved !== null ? saved === 'true' : false; // 默认矩阵显示
  });

  // 保存显示模式到 localStorage
  const toggleHandLayout = useCallback(() => {
    setUseHandLayout(prev => {
      const next = !prev;
      localStorage.setItem('testPage_useHandLayout', String(next));
      return next;
    });
  }, []);

  // HandMatrix 选点状态
  const [handSelectedIndices, setHandSelectedIndices] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem('testPage_handSelectedIndices');
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    return new Set();
  });

  const handleHandToggleSelect = useCallback((arrayIndex: number) => {
    setHandSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(arrayIndex)) {
        next.delete(arrayIndex);
      } else {
        next.add(arrayIndex);
      }
      localStorage.setItem('testPage_handSelectedIndices', JSON.stringify([...next]));
      return next;
    });
  }, []);

  // 实际是否显示手掌布局：需要同时满足 handSide 存在 且 用户选择了手掌布局
  const showHandLayout = handSide !== null && useHandLayout;

  // 当传感器协议变化时，自动切换矩阵尺寸
  useEffect(() => {
    if (sensorMatrixSize && sensorMatrixSize !== matrixRows) {
      handleMatrixSizeChange(sensorMatrixSize, sensorMatrixSize);
    }
  }, [sensorMatrixSize]);

  // LH/RH 时自动切换为 16×16 矩阵
  useEffect(() => {
    if (handSide && (matrixRows !== 16 || matrixCols !== 16)) {
      handleMatrixSizeChange(16, 16);
    }
  }, [handSide]);

  // 数据采集状态
  const [isRecording, setIsRecording] = useState(false);
  const [recordedData, setRecordedData] = useState<DataRecord[]>([]);
  // 事件驱动采集：使用 subscribeSensorFrame 取消订阅函数
  const unsubSensorFrameRef = useRef<(() => void) | null>(null);
  const isRecordingRef = useRef(false); // 用于在回调中判断是否正在采集

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
  const showHandLayoutRef = useRef(showHandLayout);

  useEffect(() => { sensorsRef.current = sensors; }, [sensors]);
  useEffect(() => { matrixColsRef.current = matrixCols; }, [matrixCols]);
  useEffect(() => { handSelectedIndicesRef.current = handSelectedIndices; }, [handSelectedIndices]);
  useEffect(() => { showHandLayoutRef.current = showHandLayout; }, [showHandLayout]);

  
  const doExportCSV = useCallback((dataToExport: DataRecord[]) => {
    if (dataToExport.length === 0) {
      alert('暂无采集数据');
      return;
    }

    // 根据当前显示模式选择不同的选点索引
    let selectedIndices: number[];
    if (showHandLayoutRef.current) {
      // 手掌布局模式：使用 handSelectedIndices（数组编号从1开始）
      selectedIndices = [...handSelectedIndicesRef.current];
    } else {
      // 矩阵模式：使用 SensorMatrix 的选点
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
    isRecordingRef.current = true;
    
    // 获取全局单例引用
    const dataPipeline = getRealtimeDataPipeline();
    const detectedFps = dataPipeline.getSensorFps();
    console.log(`[采集] 事件驱动模式启动, 当前检测帧率: ${detectedFps}Hz`);
    
    // ===== 纯事件驱动采集 =====
    // 订阅传感器新帧事件，每收到一帧就记录一条数据
    // 不使用 setInterval，完全由传感器数据到达事件触发
    const unsub = dataPipeline.subscribeSensorFrame((_snapshot) => {
      if (!isRecordingRef.current) return;
      
      const pressure = dataPipeline.getLatestForce();
      const currentAdcValues = dataPipeline.getLatestAdcValues();
      
      recordBufferRef.current.push({
        timestamp: Date.now(),
        pressure,
        adcValues: currentAdcValues ? [...currentAdcValues] : [],
      });
    });
    
    unsubSensorFrameRef.current = unsub;
  }, []);

  // 停止采集（停止后自动导出）
  const handleStopRecording = useCallback(() => {
    // 取消订阅传感器新帧事件
    isRecordingRef.current = false;
    if (unsubSensorFrameRef.current) {
      unsubSensorFrameRef.current();
      unsubSensorFrameRef.current = null;
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
      isRecordingRef.current = false;
      if (unsubSensorFrameRef.current) {
        unsubSensorFrameRef.current();
        unsubSensorFrameRef.current = null;
      }
    };
  }, []);

  const selectedCount = showHandLayout ? handSelectedIndices.size : sensors.filter(s => s.selected).length;
  const adcSum = latestAdcValues ? latestAdcValues.reduce((a, b) => a + b, 0) : 0;
  const recordCount = recordedData.length;

  return (
    <div className="flex flex-col h-full p-4 gap-4" style={{ background: 'oklch(0.13 0.02 265)' }}>
      {/* 采集控制按钮 */}
      <div className="flex items-center gap-2">
        {!isRecording ? (
          <button
            onClick={handleStartRecording}
            disabled={!isSensorConnected}
            className="flex items-center gap-2 px-3 py-2 rounded text-xs font-mono transition-colors disabled:opacity-50"
            style={{
              background: isSensorConnected ? 'oklch(0.72 0.20 145 / 0.15)' : 'oklch(0.20 0.025 265)',
              border: `1px solid ${isSensorConnected ? 'oklch(0.72 0.20 145 / 0.3)' : 'oklch(0.28 0.03 265)'}`,
              color: isSensorConnected ? 'oklch(0.72 0.20 145)' : 'oklch(0.45 0.02 240)',
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
            title="导出CCSV文件"
          >
            <Download size={12} />
            <span>导出</span>
          </button>
        )}

        {/* 帧率显示和采集状态 */}
        <div className="flex items-center gap-3 ml-auto">
          {isSensorConnected && (
            <span className="text-xs font-mono px-2 py-1 rounded" style={{ background: 'oklch(0.20 0.025 265)', color: 'oklch(0.58 0.18 200)', border: '1px solid oklch(0.28 0.03 265)' }}>
              传感器: {sensorFps}Hz
            </span>
          )}
          {isForceConnected && (
            <span className="text-xs font-mono px-2 py-1 rounded" style={{ background: 'oklch(0.20 0.025 265)', color: 'oklch(0.72 0.20 145)', border: '1px solid oklch(0.28 0.03 265)' }}>
              压力计: {forceFps}Hz
            </span>
          )}
          {isRecording && (
            <span className="text-xs font-mono px-2 py-1 rounded animate-pulse" style={{ background: 'oklch(0.65 0.22 25 / 0.15)', color: 'oklch(0.65 0.22 25)', border: '1px solid oklch(0.65 0.22 25 / 0.3)' }}>
              采集中 @{sensorFps || '?'}Hz… {recordBufferRef.current.length} 帧
            </span>
          )}
          {recordCount > 0 && !isRecording && (
            <span className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
              已采集 {recordCount} 帧
            </span>
          )}
        </div>
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

          {/* 手掌布局/矩阵显示切换开关 - 仅在连接手套(LH/RH)时显示 */}
          {handSide && (
            <div className="flex items-center gap-1 mb-3 p-1 rounded-lg" style={{ background: 'oklch(0.13 0.02 265)', border: '1px solid oklch(0.25 0.03 265)' }}>
              <button
                onClick={() => { if (!useHandLayout) toggleHandLayout(); }}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-mono font-medium transition-all"
                style={{
                  background: useHandLayout ? 'oklch(0.58 0.22 265 / 0.25)' : 'transparent',
                  border: useHandLayout ? '1px solid oklch(0.58 0.22 265 / 0.5)' : '1px solid transparent',
                  color: useHandLayout ? 'oklch(0.80 0.15 265)' : 'oklch(0.45 0.02 240)',
                }}
              >
                <Hand size={16} />
                <span>手掌布局</span>
              </button>
              <button
                onClick={() => { if (useHandLayout) toggleHandLayout(); }}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-mono font-medium transition-all"
                style={{
                  background: !useHandLayout ? 'oklch(0.72 0.20 145 / 0.25)' : 'transparent',
                  border: !useHandLayout ? '1px solid oklch(0.72 0.20 145 / 0.5)' : '1px solid transparent',
                  color: !useHandLayout ? 'oklch(0.82 0.15 145)' : 'oklch(0.45 0.02 240)',
                }}
              >
                <Grid3x3 size={16} />
                <span>矩阵显示</span>
              </button>
            </div>
          )}

          {/* 矩阵尺寸调整 - 仅在矩阵模式下显示 */}
          {!showHandLayout && (
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
          )}

          {/* 手掌布局模式下的全选按钮 */}
          {showHandLayout && handSide && (
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => {
                  const allIndices = getHandIndices(handSide);
                  const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                  if (allSelected) {
                    setHandSelectedIndices(new Set());
                    localStorage.setItem('testPage_handSelectedIndices', '[]');
                  } else {
                    const newSet = new Set(allIndices);
                    setHandSelectedIndices(newSet);
                    localStorage.setItem('testPage_handSelectedIndices', JSON.stringify(allIndices));
                  }
                }}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono transition-all"
                style={{
                  background: (() => {
                    const allIndices = getHandIndices(handSide);
                    const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                    return allSelected ? 'oklch(0.35 0.15 30 / 0.3)' : 'oklch(0.30 0.15 250 / 0.3)';
                  })(),
                  border: (() => {
                    const allIndices = getHandIndices(handSide);
                    const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                    return allSelected ? '1px solid oklch(0.50 0.15 30 / 0.5)' : '1px solid oklch(0.50 0.15 250 / 0.5)';
                  })(),
                  color: (() => {
                    const allIndices = getHandIndices(handSide);
                    const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                    return allSelected ? 'oklch(0.70 0.15 30)' : 'oklch(0.70 0.15 250)';
                  })(),
                }}
              >
                {(() => {
                  const allIndices = getHandIndices(handSide);
                  return allIndices.every(i => handSelectedIndices.has(i)) ? '全部取消' : '全选';
                })()}
              </button>
            </div>
          )}

          {/* 传感器矩阵 / 手掌布局 */}
          <div className="flex-1 min-h-0 overflow-auto">
            {showHandLayout && handSide ? (
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
