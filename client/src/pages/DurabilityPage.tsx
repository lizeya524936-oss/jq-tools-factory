/**
 * DurabilityPage - 耐久性检测页面
 * 机器人灵巧手套，反复抓握特定物体N次，查看ADC求和数据
 * 验证全部传感感点的有效性和灵敏度是否变化，阈值±threshold%（可定义）
 *
 * v1.5.8 改动：
 * - 删除灵巧手控制面板（OmniHandControl）
 * - 集成 HandMatrix（LH/RH 时自动切换手形矩阵，与一致性页面同步）
 * - 添加 handSelectedIndices 选点状态，支持全选/全部取消
 * - 修复 handleStart 选点检查，HandMatrix 模式使用 handSelectedIndices
 */
import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import SensorMatrix from '@/components/SensorMatrix';
import TestResultCard from '@/components/TestResultCard';
import ParameterPanel from '@/components/ParameterPanel';
import DataTable from '@/components/DataTable';
import SerialMonitor from '@/components/SerialMonitor';
import HandMatrix, { getHandIndices } from '@/components/HandMatrix';
import type { HandSide } from '@/components/HandMatrix';
import { useSerialData } from './Home';
import {
  SensorPoint,
  DataRecord,
  generateSensorMatrix,
  generateDurabilityData,
  evaluateDurability,
  TestResult,
  exportToCSV,
} from '@/lib/sensorData';
import { RefreshCw, Download } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
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

export default function DurabilityPage() {
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
  const [activeView, setActiveView] = useState<'trend' | 'overview' | 'table'>('trend');
  const [progress, setProgress] = useState(0);

  const selectedSensors = sensors.filter(s => s.selected);
  const { latestSensorMatrix, latestAdcValues, latestRawFrame, isForceConnected, isSensorConnected, latestForceN, sendForceCommand, sensorDeviceType } = useSerialData();

  // ─── HandMatrix 选点状态（与一致性页面共享 localStorage key） ───
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

  // LH/RH 时自动切换为 16×16 矩阵
  const handSide: HandSide | null = (sensorDeviceType === 'LH' || sensorDeviceType === 'RH') ? sensorDeviceType : null;

  useEffect(() => {
    if (handSide && (matrixRows !== 16 || matrixCols !== 16)) {
      handleMatrixResize(16, 16);
    }
  }, [handSide]);  // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleMatrixResize = useCallback((rows: number, cols: number) => {
    setMatrixRows(rows);
    setMatrixCols(cols);
    setSensors(generateSensorMatrix(rows, cols));
    localStorage.setItem('matrixRows', rows.toString());
    localStorage.setItem('matrixCols', cols.toString());
    setRecords([]);
    setResult(null);
  }, []);

  const handleStart = useCallback(async () => {
    // 检查是否有选点：HandMatrix 模式用 handSelectedIndices，普通模式用 selectedSensors
    const hasSelection = handSide
      ? handSelectedIndices.size > 0
      : selectedSensors.length > 0;

    if (!hasSelection) {
      toast.error('请先选择至少一个传感器点');
      return;
    }
    setIsRunning(true);
    setResult(null);
    setProgress(0);
    toast.info(`开始耐久性检测，共 ${params.durabilityCount} 次抓握...`);

    // 模拟进度
    for (let i = 0; i <= 100; i += 10) {
      await new Promise(r => setTimeout(r, 150));
      setProgress(i);
    }

    const data = generateDurabilityData(selectedSensors, params.durabilityCount);
    setRecords(data);

    const testResult = evaluateDurability(data, params.threshold);
    setResult(testResult);
    setIsRunning(false);
    setProgress(100);

    if (testResult.passed === true) {
      toast.success(`耐久性检测通过！ADC衰减 ${(testResult.maxError ?? 0).toFixed(2)}%`);
    } else {
      toast.error(`耐久性检测未通过，ADC衰减 ${(testResult.maxError ?? 0).toFixed(2)}% 超出阈值 ±${params.threshold}%`);
    }
  }, [selectedSensors, params, handSide, handSelectedIndices]);

  const handleReset = async () => {
    if (isForceConnected && sendForceCommand) {
      await sendForceCommand(new Uint8Array([0x23, 0x55, 0x00, 0x0A]));
    }
    setRecords([]);
    setResult(null);
    setProgress(0);
    toast.info('数据已重置');
  };

  const handleExport = () => {
    if (records.length === 0) {
      toast.error('暂无数据可导出');
      return;
    }
    exportToCSV(records, `durability_${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`已导出 ${records.length} 条数据`);
  };

  // 趋势图数据（采样抽取，最多200点）
  const trendData = (() => {
    if (records.length === 0) return [];
    const step = Math.max(1, Math.floor(records.length / 200));
    return records.filter((_, i) => i % step === 0).map(r => ({
      cycle: r.sampleIndex + 1,
      adcSum: r.adcSum,
      pressure: r.pressure,
    }));
  })();

  // 初始均值（用于参考线）
  const initialMean = (() => {
    if (records.length < 5) return null;
    const first = records.slice(0, Math.ceil(records.length * 0.1));
    return Math.round(first.reduce((a, r) => a + r.adcSum, 0) / first.length);
  })();

  return (
    <div className="flex h-full gap-0">
      {/* 左侧 */}
      <div
        className="flex flex-col gap-3 p-3 overflow-y-auto"
        style={{
          width: '520px',
          minWidth: '280px',
          borderRight: '1px solid oklch(0.22 0.03 265)',
        }}
      >
        {/* 传感器矩阵 */}
        <div className="rounded" style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', flexShrink: 0, padding: '10px', overflowX: 'auto' }}>
          {handSide ? (
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
              sensors={sensors}
              rows={matrixRows}
              cols={matrixCols}
              onSelectionChange={setSensors}
              onResize={handleMatrixResize}
            />
          )}
        </div>

        {/* 操作按钮：全选/取消 + 导出 + 重置 */}
        <div className="flex gap-2">
          {handSide && (
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
                  if (!handSide) return 'oklch(0.22 0.03 265)';
                  const allIndices = getHandIndices(handSide);
                  const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                  return allSelected ? 'oklch(0.35 0.15 30 / 0.3)' : 'oklch(0.30 0.15 250 / 0.3)';
                })(),
                border: (() => {
                  if (!handSide) return '1px solid oklch(0.30 0.03 265)';
                  const allIndices = getHandIndices(handSide);
                  const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                  return allSelected ? '1px solid oklch(0.50 0.15 30 / 0.5)' : '1px solid oklch(0.50 0.15 250 / 0.5)';
                })(),
                color: (() => {
                  if (!handSide) return 'oklch(0.60 0.02 240)';
                  const allIndices = getHandIndices(handSide);
                  const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                  return allSelected ? 'oklch(0.70 0.15 30)' : 'oklch(0.70 0.15 250)';
                })(),
              }}
            >
              {(() => {
                if (!handSide) return '全选';
                const allIndices = getHandIndices(handSide);
                const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                return allSelected ? '全部取消' : '全选';
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

        <ParameterPanel params={params} onChange={setParams} mode="durability" />

        {/* 进度条 */}
        {isRunning && (
          <div>
            <div className="flex justify-between text-xs font-mono mb-1" style={{ color: 'oklch(0.50 0.02 240)' }}>
              <span>抓握进度</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'oklch(0.22 0.03 265)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%`, background: 'oklch(0.58 0.22 265)' }}
              />
            </div>
          </div>
        )}

        <TestResultCard
          result={result}
          title="耐久性判定"
          description={`定制一对机器人灵巧手套，反复抓握一个特定物体${params.durabilityCount.toLocaleString()}次，查看ADC求和数据，验证全部传感点的有效性和灵敏度是否变化，阈值±${params.threshold}%`}
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
          handSelectedIndices={handSide ? handSelectedIndices : undefined}
        />

        {/* 传感器有效性统计 */}
        {records.length > 0 && (
          <div
            className="rounded p-3"
            style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}
          >
            <div className="text-xs font-mono mb-2" style={{ color: 'oklch(0.55 0.02 240)' }}>
              传感器有效性
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: '有效传感器', value: `${handSide ? handSelectedIndices.size : selectedSensors.length}/${handSide ? getHandIndices(handSide).length : sensors.length}`, color: 'oklch(0.72 0.20 145)' },
                { label: '总抓握次数', value: `${params.durabilityCount}`, color: 'oklch(0.70 0.18 200)' },
                { label: '数据记录', value: `${records.length}`, color: 'oklch(0.75 0.18 55)' },
                {
                  label: '灵敏度变化',
                  value: result ? `${(result.maxError ?? 0).toFixed(1)}%` : '--',
                  color: result?.passed ? 'oklch(0.72 0.20 145)' : 'oklch(0.65 0.22 25)',
                },
              ].map(s => (
                <div key={s.label}>
                  <div className="text-xs font-mono" style={{ fontSize: '9px', color: 'oklch(0.45 0.02 240)' }}>{s.label}</div>
                  <div className="text-sm font-mono font-medium" style={{ color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>
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
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'oklch(0.65 0.22 25)', flexShrink: 0 }} />
            <span style={{ color: 'oklch(0.45 0.02 240)' }}>耐久性检测：机械手反复抓握产品，采集压力和传感器数据，评估灵敏度变化</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span style={{ color: 'oklch(0.45 0.02 240)' }}>{handSide ? handSelectedIndices.size : selectedSensors.length} 个传感器点已选</span>
          </div>
        </div>

        {/* 视图切换 */}
        <div className="flex gap-2">
          {['trend', 'overview', 'table'].map(view => (
            <button
              key={view}
              onClick={() => setActiveView(view as 'trend' | 'overview' | 'table')}
              className="px-2 py-1 rounded text-xs font-mono transition-colors"
              style={{
                background: activeView === view ? 'oklch(0.58 0.22 265)' : 'oklch(0.22 0.03 265)',
                color: activeView === view ? 'white' : 'oklch(0.45 0.02 240)',
                border: `1px solid ${activeView === view ? 'oklch(0.58 0.22 265 / 0.5)' : 'oklch(0.30 0.03 265)'}`,
              }}
            >
              {view === 'trend' ? '趋势' : view === 'overview' ? '概览' : '表格'}
            </button>
          ))}
        </div>

        {/* 趋势图 */}
        {activeView === 'trend' && (
          <div className="flex-1 min-h-0 rounded p-3" style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorAdc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="oklch(0.72 0.20 145)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="oklch(0.72 0.20 145)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.03 265)" />
                  <XAxis dataKey="cycle" stroke="oklch(0.45 0.02 240)" style={{ fontSize: '12px' }} />
                  <YAxis stroke="oklch(0.45 0.02 240)" style={{ fontSize: '12px' }} />
                  <Tooltip
                    contentStyle={{ background: 'oklch(0.22 0.03 265)', border: '1px solid oklch(0.30 0.03 265)', borderRadius: '4px' }}
                    labelStyle={{ color: 'oklch(0.45 0.02 240)' }}
                  />
                  {initialMean && <ReferenceLine y={initialMean} stroke="oklch(0.75 0.18 55)" strokeDasharray="5 5" label="初始均值" />}
                  <Area type="monotone" dataKey="adcSum" stroke="oklch(0.72 0.20 145)" fillOpacity={1} fill="url(#colorAdc)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-xs" style={{ color: 'oklch(0.45 0.02 240)' }}>
                暂无数据
              </div>
            )}
          </div>
        )}

        {/* 概览 */}
        {activeView === 'overview' && (
          <div className="flex-1 min-h-0 rounded p-3 overflow-y-auto" style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}>
            {result ? (
              <div className="space-y-3">
                <div>
                  <div className="text-xs font-mono mb-1" style={{ color: 'oklch(0.45 0.02 240)' }}>测试结果</div>
                  <div className="text-lg font-mono font-bold" style={{ color: result.passed ? 'oklch(0.72 0.20 145)' : 'oklch(0.65 0.22 25)' }}>
                    {result.passed ? '通过' : '未通过'}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-mono mb-1" style={{ color: 'oklch(0.45 0.02 240)' }}>最大误差</div>
                  <div className="text-sm font-mono" style={{ color: 'oklch(0.75 0.18 55)' }}>
                    {(result.maxError ?? 0).toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs font-mono mb-1" style={{ color: 'oklch(0.45 0.02 240)' }}>阈值</div>
                  <div className="text-sm font-mono" style={{ color: 'oklch(0.70 0.18 200)' }}>
                    ±{params.threshold}%
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-xs" style={{ color: 'oklch(0.45 0.02 240)' }}>
                暂无测试结果
              </div>
            )}
          </div>
        )}

        {/* 表格 */}
        {activeView === 'table' && (
          <div className="flex-1 min-h-0 rounded overflow-hidden" style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}>
            {records.length > 0 ? (
              <DataTable
                records={records.slice(0, 100)}
                maxRows={100}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-xs" style={{ color: 'oklch(0.45 0.02 240)' }}>
                暂无数据
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
