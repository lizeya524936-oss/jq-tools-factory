/**
 * ConsistencyPage - 一致性检测页面
 * 检测方法A：手动垂直下压机，多个产品，剔除偏差较大数据，求均值曲线
 * 判断：forceMin-forceMax范围内，5个间隔一致数据点，误差范围±threshold%（可定义）
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import SensorMatrix from '@/components/SensorMatrix';
import DataChart from '@/components/DataChart';
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
import { RefreshCw, Download } from 'lucide-react';

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
  const { latestSensorMatrix, latestAdcValues, latestRawFrame, isForceConnected, isSensorConnected, latestForceN, sendForceCommand } = useSerialData();

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
    if (selectedSensors.length === 0) {
      toast.error('请先选择至少一个传感器点');
      return;
    }

    setIsRunning(true);
    setRecords([]);
    setResult(null);

    try {
      const pipeline = getRealtimeDataPipeline();
      const newRecords: DataRecord[] = [];
      let collectionCount = 0;
      const targetSamples = params.productCount * params.samplesPerProduct;

      // 实时采集传感器数据
      const sensorStream = getSensorDataStreamV2();
      const collectionInterval = setInterval(() => {
        const snapshot = pipeline.getCurrentSnapshot();
        
        // 优先从SensorDataStreamV2全局单例获取（零延迟，不受闭包影响）
        let currentAdcValues: number[] | null = sensorStream.getLatestAdcValues();
        // 备用：从 pipeline 获取
        if (!currentAdcValues || currentAdcValues.length === 0) {
          currentAdcValues = snapshot.adcValues;
        }
        
        // 只有当同时有压力和传感器数据时才记录
        if (snapshot.forceN !== null && currentAdcValues && currentAdcValues.length > 0) {
          const adcValues = selectedSensors.map(sensor => 
            currentAdcValues![sensor.row * matrixCols + sensor.col] ?? 0
          );
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
          clearInterval(collectionInterval);
          
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
          toast.success(`一致性检测完成，采集 ${collectionCount} 个数据点`);
        }
      }, 10); // 每10ms采集一次

      // 设置超时，防止无限采集
      setTimeout(() => {
        clearInterval(collectionInterval);
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
  }, [selectedSensors, params, matrixCols]);

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

  return (
    <div className="flex gap-3 h-full p-3">
      {/* 左侧：传感器矩阵（放大展示） + 数据采集控制 */}
      <div className="flex flex-col gap-3 overflow-y-auto" style={{ width: '520px', flexShrink: 0 }}>
        {/* 传感器矩阵 - 放大区域 */}
        <div className="rounded" style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', flexShrink: 0 }}>
          <SensorMatrix
            rows={matrixRows}
            cols={matrixCols}
            sensors={sensors}
            onSelectionChange={setSensors}
            onResize={handleMatrixResize}
          />
        </div>

        {/* 操作按钮：导出 + 重置 */}
        <div className="flex gap-2">
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
            <span style={{ color: 'oklch(0.45 0.02 240)' }}>{selectedSensors.length} 个传感器点已选</span>
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

        {/* 图表内容：压力 & ADC 综合曲线 + 压力数据可视化 */}
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          {/* 压力 & ADC Sum 综合曲线 */}
          <div className="flex-1 min-h-0">
            <DataChart
              records={records}
              title="压力 & ADC Sum 综合曲线"
              showBrush={records.length > 50}
              referenceLines={[
                { value: params.forceMin, axis: 'left', label: `${params.forceMin}N` },
                { value: params.forceMax, axis: 'left', label: `${params.forceMax}N` },
              ]}
            />
          </div>

          {/* 压力数据可视化 */}
          <div className="rounded" style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', padding: '12px', height: '220px' }}>
            <PressureChart showControls={false} />
          </div>
        </div>
      </div>
    </div>
  );
}
