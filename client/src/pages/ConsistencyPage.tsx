/**
 * ConsistencyPage - 一致性检测页面
 * 检测方法A：手动垂直下压机，多个产品，剔除偏差较大数据，求均值曲线
 * 判断：forceMin-forceMax范围内，5个间隔一致数据点，误差范围±threshold%（可定义）
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import SensorMatrix from '@/components/SensorMatrix';
import DataChart, { DataSeries, SERIES_COLORS } from '@/components/DataChart';
import TestResultCard from '@/components/TestResultCard';
import ParameterPanel from '@/components/ParameterPanel';
import SerialMonitor from '@/components/SerialMonitor';
import PressureChart from '@/components/PressureChart';
import { useSerialData } from './Home';
import { getRealtimeDataPipeline } from '@/lib/realtimeDataPipeline';
import { getSensorDataStreamV2 } from '@/lib/sensorDataStreamV2';
import {
  SensorPoint,
  DataRecord,
  generateSensorMatrix,
  generateConsistencyData,
  evaluateConsistency,
  TestResult,
  exportToCSV,
} from '@/lib/sensorData';
import { RefreshCw, Download, Upload, Hand, Grid3x3 } from 'lucide-react';
import HandMatrix, { getHandIndices } from '@/components/HandMatrix';
import type { HandSide } from '@/components/HandMatrix';

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

export default function ConsistencyPage() {
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
  const [records, setRecords] = useState<DataRecord[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [params, setParams] = useState(DEFAULT_PARAMS);

  const selectedSensors = sensors.filter(s => s.selected);
  
  // 选点变化时保存到 localStorage
  useEffect(() => {
    const selectedKeys = sensors.filter(s => s.selected).map(s => `${s.row}_${s.col}`);
    localStorage.setItem('selectedSensorPoints', JSON.stringify(selectedKeys));
  }, [sensors]);

  // HandMatrix 选点状态（基于数组编号）
  const [handSelectedIndices, setHandSelectedIndices] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem('handSelectedIndices');
      if (saved) return new Set<number>(JSON.parse(saved));
    } catch {}
    return new Set<number>();
  });

  // HandMatrix 选点变化时保存到 localStorage
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
  const { latestSensorMatrix, latestAdcValues, latestRawFrame, isForceConnected, isSensorConnected, latestForceN, sendForceCommand, sensorDeviceType, sensorMatrixSize, sensorFps, forceFps } = useSerialData();

  // LH/RH 时自动切换为 16×16 矩阵
  const handSide: HandSide | null = (sensorDeviceType === 'LH' || sensorDeviceType === 'RH') ? sensorDeviceType : null;

  // ===== 手掌布局/矩阵显示切换 =====
  const [useHandLayout, setUseHandLayout] = useState(() => {
    const saved = localStorage.getItem('consistencyPage_useHandLayout');
    return saved !== null ? saved === 'true' : true; // 一致性页面默认手掌布局
  });
  const toggleHandLayout = useCallback(() => {
    setUseHandLayout(prev => {
      const next = !prev;
      localStorage.setItem('consistencyPage_useHandLayout', String(next));
      return next;
    });
  }, []);
  // 实际是否显示手掌布局
  const showHandLayout = handSide !== null && useHandLayout;

  useEffect(() => {
    if (handSide && (matrixRows !== 16 || matrixCols !== 16)) {
      handleMatrixResize(16, 16);
    }
  }, [handSide]);  // eslint-disable-line react-hooks/exhaustive-deps

  // 当传感器协议变化时，自动切换矩阵尺寸
  useEffect(() => {
    if (sensorMatrixSize && sensorMatrixSize !== matrixRows) {
      handleMatrixResize(sensorMatrixSize, sensorMatrixSize);
    }
  }, [sensorMatrixSize]);  // eslint-disable-line react-hooks/exhaustive-deps

  // 使用 RealtimeDataPipeline 获取数据，避免频繁的 React 重新渲染
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    // 定期从 RealtimeDataPipeline 获取数据，而不是依赖 React State 变化
    updateIntervalRef.current = setInterval(() => {
      const pipeline = getRealtimeDataPipeline();
      const snapshot = pipeline.getCurrentSnapshot();
      
      if (snapshot.sensorMatrix && snapshot.sensorMatrix.length > 0) {
        // 优先使用二维矩阵：按行列坐标精确映射
        setSensors(prev => prev.map(s => ({
          ...s,
          adcValue: (snapshot.sensorMatrix![s.row]?.[s.col]) ?? 0,
        })));
      } else if (snapshot.adcValues && snapshot.adcValues.length > 0) {
        // 备用：一维展开行优先顺序
        setSensors(prev => prev.map(s => ({
          ...s,
          adcValue: snapshot.adcValues![s.row * matrixCols + s.col] ?? 0,
        })));
      }
    }, 50); // 每50ms更新一次UI
    
    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
    };
  }, [matrixCols]);

  // 矩阵尺寸变更并保存到 localStorage
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
    // 检查是否有选点：手掌布局模式用 handSelectedIndices，矩阵模式用 selectedSensors
    const hasSelection = showHandLayout
      ? handSelectedIndices.size > 0
      : selectedSensors.length > 0;
    if (!hasSelection) {
      toast.error('请先选择至少一个传感器点');
      return;
    }

    setIsRunning(true);
    setRecords([]);
    setResult(null);

    // 快照当前 HandMatrix 选点（避免闭包问题）
    const handIndicesSnapshot = [...handSelectedIndices];

    try {
      const pipeline = getRealtimeDataPipeline();
      const newRecords: DataRecord[] = [];
      let collectionCount = 0;
      const targetSamples = params.productCount * params.samplesPerProduct;

      // ===== 自适应采样：订阅传感器新帧事件，每帧只采集一次 =====
      const unsubscribe = pipeline.subscribeSensorFrame((snapshot) => {
        if (collectionCount >= targetSamples) return;
        
        const currentAdcValues = snapshot.adcValues;
        
        // 只有当同时有压力和传感器数据时才记录
        if (snapshot.forceN !== null && currentAdcValues && currentAdcValues.length > 0) {
          let adcValues: number[];
          if (showHandLayout && handIndicesSnapshot.length > 0) {
            // 手掌布局模式：按数组编号取值（编号从1开始，数组索引从0开始）
            adcValues = handIndicesSnapshot.map(idx => currentAdcValues![idx - 1] ?? 0);
          } else {
            // 普通矩阵模式：按行列坐标取值
            adcValues = selectedSensors.map(sensor => 
              currentAdcValues![sensor.row * matrixCols + sensor.col] ?? 0
            );
          }
          const adcSum = adcValues.reduce((a, b) => a + b, 0);
          
          const record: DataRecord = {
            id: `record-${collectionCount}`,
            timestamp: snapshot.timestamp || Date.now(),
            time: new Date(snapshot.timestamp || Date.now()).toLocaleTimeString(),
            pressure: snapshot.forceN || 0,
            adcValues: adcValues,
            adcSum: adcSum,
            adcSumHex: '0x' + adcSum.toString(16).toUpperCase(),
            testMode: 'consistency',
            sampleIndex: collectionCount,
            productIndex: Math.floor(collectionCount / params.samplesPerProduct),
          };
          newRecords.push(record);
          collectionCount++;
          setRecords([...newRecords]); // 实时更新显示
        }

        // 采集足够的数据后停止
        if (collectionCount >= targetSamples) {
          unsubscribe();
          
          // 评估一致性
          const testResult = evaluateConsistency(
            newRecords,
            params.forceMin,
            params.forceMax,
            params.checkPoints,
            params.threshold
          );
          setResult(testResult);
          setIsRunning(false);
          toast.success(`一致性检测完成，自适应采集 ${collectionCount} 个数据点`);
        }
      });

      // 设置超时，防止无限采集
      setTimeout(() => {
        unsubscribe();
        if (collectionCount < targetSamples) {
          setIsRunning(false);
          toast.warning(`采集超时，仅采集 ${collectionCount} 个数据点`);
        }
      }, 60000); // 60秒超时
    } catch (error) {
      toast.error('检测过程中出错');
      console.error(error);
      setIsRunning(false);
    }
  }, [selectedSensors, params, matrixCols, showHandLayout, handSelectedIndices]);

  const handleReset = useCallback(async () => {
    // 向压力计发送 CMD_RESET 归零指令
    if (isForceConnected && sendForceCommand) {
      await sendForceCommand(new Uint8Array([0x23, 0x55, 0x00, 0x0A]));
    }
    setRecords([]);
    setResult(null);
  }, [isForceConnected, sendForceCommand]);

  const handleExport = useCallback(() => {
    if (records.length === 0) {
      toast.error('没有数据可导出');
      return;
    }
    try {
      exportToCSV(records, 'consistency-test');
      toast.success('数据已导出');
    } catch (error) {
      toast.error('导出失败');
    }
  }, [records]);

  // CSV 多文件上传管理（最多20个）
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
          testMode: 'consistency',
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
          testMode: (testMode as DataRecord['testMode']) || 'consistency',
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
          testMode: 'consistency',
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
    // 只保留从开始到峰值点（含）的数据
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

  // 构建图表系列：实时采集 + 上传文件
  const chartSeries: DataSeries[] = [
    ...(records.length > 0 ? [{
      id: 'realtime',
      name: '实时采集',
      records,
      color: SERIES_COLORS[0],
      visible: true,
    }] : []),
    ...uploadedSeries,
  ];

  return (
    <div className="flex gap-3 p-3" style={{ minHeight: '100%' }}>
      {/* 左侧：传感器矩阵（放大展示） + 数据采集控制 */}
      <div className="flex flex-col gap-3" style={{ width: '520px', flexShrink: 0 }}>
        {/* 传感器矩阵 - 放大区域 */}
        <div className="rounded" style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', flexShrink: 0, padding: '10px', overflowX: 'auto' }}>
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
          {showHandLayout && handSide ? (
            /* 手形矩阵（LH/RH 专用） */
            <HandMatrix
              side={handSide}
              adcValues={latestAdcValues}
              showIndex={true}
              selectedIndices={handSelectedIndices}
              onToggleSelect={handleHandToggleSelect}
            />
          ) : (
            /* 通用矩阵 */
            <SensorMatrix
              rows={matrixRows}
              cols={matrixCols}
              sensors={sensors}
              onSelectionChange={setSensors}
              onResize={handleMatrixResize}
            />
          )}
        </div>

        {/* 操作按钮：全选/取消 + 导出 + 重置 */}
        <div className="flex gap-2">
          {showHandLayout && handSide && (
            <button
              onClick={() => {
                const allIndices = getHandIndices(handSide);
                const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                if (allSelected) {
                  setHandSelectedIndices(new Set());
                } else {
                  setHandSelectedIndices(new Set(allIndices));
                }
              }}
              disabled={isRunning}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-mono transition-all disabled:opacity-50"
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
          )}
          <button
            onClick={handleExport}
            disabled={isRunning || records.length === 0}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-mono transition-all disabled:opacity-40"
            style={{
              background: 'oklch(0.72 0.20 145 / 0.15)',
              border: '1px solid oklch(0.72 0.20 145 / 0.3)',
              color: 'oklch(0.72 0.20 145)',
            }}
            title="导出CSV"
          >
            <Download size={12} />
            导出数据
          </button>
          <button
            onClick={handleReset}
            disabled={isRunning}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-mono transition-all disabled:opacity-50"
            style={{
              background: 'oklch(0.22 0.03 265)',
              border: '1px solid oklch(0.30 0.03 265)',
              color: 'oklch(0.60 0.02 240)',
            }}
          >
            <RefreshCw size={12} />
            重置
          </button>
        </div>

        {/* 检测结果 */}
        <TestResultCard
          result={result}
          title="一致性判定"
          description={`判断方法A：平滑曲线${params.forceMin}N到${params.forceMax}N范围内，选取${params.checkPoints}个同隔一致的数值，判断误差范围是否在±${params.threshold}%范围内`}
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
          handSelectedIndices={showHandLayout ? handSelectedIndices : undefined}
        />
      </div>

      {/* 右侧：图表区域 */}
      <div className="flex-1 flex flex-col min-w-0 p-3 gap-3">
        {/* 工具说明条 */}
        <div
          className="flex items-center gap-3 px-3 py-1.5 rounded text-xs font-mono"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}
        >
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'oklch(0.70 0.18 200)', flexShrink: 0 }} />
            <span style={{ color: 'oklch(0.70 0.18 200)' }}>手动垂直下压机</span>
            <span style={{ color: 'oklch(0.40 0.02 240)' }}>——人工下压检测一致性</span>
          </div>
          <div className="w-px h-3" style={{ background: 'oklch(0.28 0.03 265)' }} />
          <span style={{ color: 'oklch(0.50 0.02 240)' }}>检测方法A：高频采样力学数据 + 多个压力传感点ADC求和</span>
          <div className="ml-auto flex items-center gap-2">
            <span style={{ color: 'oklch(0.45 0.02 240)' }}>{showHandLayout ? handSelectedIndices.size : selectedSensors.length} 个传感器点已选</span>
            <span style={{ color: 'oklch(0.35 0.02 240)' }}>|</span>
            <span style={{ color: 'oklch(0.45 0.02 240)' }}>矩阵 {matrixRows}×{matrixCols}</span>
          </div>
        </div>

        {/* 综合视图标题 */}
        <div className="flex items-center gap-1">
          <span className="px-3 py-1 rounded text-xs font-mono"
            style={{
              background: 'oklch(0.58 0.22 265 / 0.2)',
              border: '1px solid oklch(0.58 0.22 265 / 0.5)',
              color: 'oklch(0.70 0.18 200)',
            }}
          >
            综合视图
          </span>
          <div className="ml-auto text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)' }}>
            判定方法A：{params.forceMin}N-{params.forceMax}N，{params.checkPoints}个检查点，误差阈值±{params.threshold}%
          </div>
        </div>

        {/* 图表内容：压力数据可视化 + 压力 & ADC 综合曲线 */}
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          {/* 压力数据可视化 */}
          <div className="rounded" style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', padding: '12px', height: '220px' }}>
            <PressureChart showControls={false} />
          </div>

          {/* 压力 & ADC Sum 综合曲线 */}
          <div className="flex-1 min-h-0 flex flex-col">
            {/* 曲线标题栏 + 上传按钮 */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono" style={{ color: 'oklch(0.70 0.18 200)' }}>
                压力 & ADC Sum 综合曲线
              </span>
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
              <div className="ml-auto flex items-center gap-2">
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

            {/* 文件列表 - checkbox 控制显示/隐藏 */}
            {uploadedSeries.length > 0 && (
              <div
                className="flex flex-wrap gap-x-3 gap-y-1 px-2 py-1.5 mb-1 rounded overflow-y-auto"
                style={{ background: 'oklch(0.15 0.02 265)', border: '1px solid oklch(0.22 0.03 265)', maxHeight: '100px' }}
              >
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

            <div style={{ minHeight: '500px' }}>
              <DataChart
                series={chartSeries}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
