/**
 * RepeatabilityPage - 重复性检测页面
 * 检测方法B：PLC可编程垂直下压机，间隔1分钟采样，两类数据误差范围±threshold%（可定义）
 */
import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import SensorMatrix from '@/components/SensorMatrix';
import DataChart from '@/components/DataChart';
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
import { Play, RefreshCw, Download } from 'lucide-react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

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
  const { latestSensorMatrix, latestAdcValues, latestRawFrame, isForceConnected, isSensorConnected, latestForceN, sendForceCommand, sensorMatrixSize } = useSerialData();

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

  const scatterData = records.map(r => ({ x: r.pressure, y: r.adcSum }));

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
          <span style={{ color: 'oklch(0.50 0.02 240)' }}>检测方法B：对传感器特定区域按照“检测方法B”测试，并进行逻辑判定</span>
          <div className="w-px h-3" style={{ background: 'oklch(0.28 0.03 265)' }} />
          <span style={{ color: 'oklch(0.55 0.02 240)' }}>同隔{params.repeatInterval}分钟取一次压力数值和ADC求和，共{params.repeatCount}次</span>
          <div className="ml-auto flex items-center gap-2">
            <span style={{ color: 'oklch(0.45 0.02 240)' }}>{selectedSensors.length} 个传感器点已选</span>
            <span style={{ color: 'oklch(0.35 0.02 240)' }}>|</span>
            <span style={{ color: 'oklch(0.45 0.02 240)' }}>矩阵 {matrixRows}×{matrixCols}</span>
          </div>
        </div>

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
          <div className="ml-auto text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)' }}>
            检测方法B | PLC可编程垂直下压机 | 矩阵 {matrixRows}×{matrixCols}
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {activeView === 'timeline' && (
            <DataChart
              records={records}
              title={`重复性 - 时间序列（间隔${params.repeatInterval}分钟采样）`}
              showBrush={records.length > 20}
            />
          )}

          {activeView === 'scatter' && (
            <div
              className="p-3 h-full flex flex-col rounded"
              style={{ background: 'oklch(0.15 0.025 265)', border: '1px solid oklch(0.22 0.03 265)' }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono" style={{ color: 'oklch(0.70 0.18 200)' }}>
                  压力 vs ADC Sum 散点图
                </span>
                <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)' }}>
                  {records.length} 个数据点
                </span>
              </div>
              {records.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-sm font-mono" style={{ color: 'oklch(0.45 0.02 240)' }}>暂无数据</div>
                </div>
              ) : (
                <div className="flex-1" style={{ minHeight: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 5, right: 15, left: 5, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.03 265)" strokeOpacity={0.5} />
                      <XAxis
                        dataKey="x"
                        name="压力"
                        unit=" N"
                        tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                        axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                        tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                        label={{ value: '压力 (N)', position: 'insideBottom', offset: -10, fill: 'oklch(0.50 0.02 240)', fontSize: 10 }}
                      />
                      <YAxis
                        dataKey="y"
                        name="ADC Sum"
                        tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                        axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                        tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                        label={{ value: 'ADC Sum', angle: -90, position: 'insideLeft', fill: 'oklch(0.70 0.18 200)', fontSize: 10 }}
                      />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3', stroke: 'oklch(0.40 0.03 265)' }}
                        contentStyle={{
                          background: 'oklch(0.17 0.025 265)',
                          border: '1px solid oklch(0.35 0.04 265)',
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: '11px',
                          color: 'oklch(0.85 0.01 220)',
                        }}
                      />
                      <Scatter data={scatterData} fill="oklch(0.70 0.18 200)" fillOpacity={0.7} r={3} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {activeView === 'table' && (
            <DataTable records={records} onClear={handleReset} />
          )}
        </div>
      </div>
    </div>
  );
}
