/**
 * DurabilityPage - 耐久性检测页面
 * 
 * v1.5.9 改动：
 * - 右侧从"趋势/概览/表格"改为灵巧手控制面板
 *   - 上传 JSON 动作文件，解析并展示动作列表
 *   - 可将动作添加到循环方框中编排执行序列
 *   - 设置循环次数和动作间隔
 *   - 连接灵巧手、执行循环、停止
 * - 左侧保留传感器矩阵（HandMatrix / SensorMatrix）+ 数据采集
 * - 修复左侧滚动问题
 * - 删除旧的趋势/概览/表格视图
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import SensorMatrix from '@/components/SensorMatrix';
import TestResultCard from '@/components/TestResultCard';
import ParameterPanel from '@/components/ParameterPanel';
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
import { RefreshCw, Download, Upload, Play, Square, Trash2, Plus, GripVertical, ChevronUp, ChevronDown, Hand, AlertCircle, Power, Zap, Grid3x3 } from 'lucide-react';
import { buildSetPositionsPacket, buildEnablePacket, buildDisablePacket, OMNI_DEVICE_ID } from '@/lib/omniHandProtocol';
import defaultActionsData from '@/lib/defaultActions.json';

interface HandAction {
  name: string;
  positions: number[]; // 10 个轴的位置 (0-4096)
}

// 解析JSON动作数据为HandAction数组
function parseActionsFromJSON(data: Array<Record<string, unknown>>): HandAction[] {
  return data.map((item) => {
    const positions: number[] = [];
    for (let i = 1; i <= 10; i++) {
      positions.push(typeof item[`pos_axis_${i}`] === 'number' ? (item[`pos_axis_${i}`] as number) : 0);
    }
    return { name: String(item.name || 'unknown'), positions };
  });
}

// 默认动作库
const DEFAULT_ACTIONS = parseActionsFromJSON(defaultActionsData as Array<Record<string, unknown>>);

// ===== 默认参数 =====
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
  // ─── 传感器矩阵状态 ───
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
  const [progress, setProgress] = useState(0);

  const selectedSensors = sensors.filter(s => s.selected);
  const { latestSensorMatrix, latestAdcValues, latestRawFrame, isForceConnected, isSensorConnected, latestForceN, sendForceCommand, sensorDeviceType, forceDeviceMode, sensorMatrixSize, sensorMatrixCols, sensorFps, forceFps } = useSerialData();

  // ─── HandMatrix 选点状态 ───
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
      if (next.has(arrayIndex)) next.delete(arrayIndex);
      else next.add(arrayIndex);
      return next;
    });
  }, []);

  const handSide: HandSide | null = (sensorDeviceType === 'LH' || sensorDeviceType === 'RH') ? sensorDeviceType : null;

  // ===== 手掌布局/矩阵显示切换 =====
  const [useHandLayout, setUseHandLayout] = useState(() => {
    const saved = localStorage.getItem('durabilityPage_useHandLayout');
    return saved !== null ? saved === 'true' : true; // 耐久性页面默认手掌布局
  });
  const toggleHandLayout = useCallback(() => {
    setUseHandLayout(prev => {
      const next = !prev;
      localStorage.setItem('durabilityPage_useHandLayout', String(next));
      return next;
    });
  }, []);
  const showHandLayout = handSide !== null && useHandLayout;

  useEffect(() => {
    if (handSide && (matrixRows !== 16 || matrixCols !== 16)) {
      handleMatrixResize(16, 16);
    }
  }, [handSide]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // 当传感器协议变化时，自动切换矩阵尺寸
  useEffect(() => {
    if (sensorMatrixSize && (sensorMatrixSize !== matrixRows || (sensorMatrixCols ?? sensorMatrixSize) !== matrixCols)) {
      handleMatrixResize(sensorMatrixSize, sensorMatrixCols ?? sensorMatrixSize);
    }
  }, [sensorMatrixSize, sensorMatrixCols]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 灵巧手控制状态 ───
  const [availableActions, setAvailableActions] = useState<HandAction[]>(DEFAULT_ACTIONS);
  const [sequenceActions, setSequenceActions] = useState<HandAction[]>([]);
  const [totalCycles, setTotalCycles] = useState(100);
  const [intervalMs, setIntervalMs] = useState(2000);
  const [isTesting, setIsTesting] = useState(false);
  const [currentCycle, setCurrentCycle] = useState(0);
  const [currentActionName, setCurrentActionName] = useState('');
  const [logMessages, setLogMessages] = useState<string[]>([]);
  const [jsonFileName, setJsonFileName] = useState('okandreleasehold.json');
  const [omniEnabled, setOmniEnabled] = useState(false);

  const testAbortRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // 灵巧手连接状态：完全依赖右上角“选择检测设备”的机械手模式
  const omniConnected = isForceConnected && forceDeviceMode === 'robot';

  // 自动滚动日志到底部
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logMessages]);

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogMessages(prev => {
      const next = [...prev, `[${time}] ${msg}`];
      return next.length > 100 ? next.slice(-100) : next;
    });
  }, []);

  const sendOmniPacket = useCallback(async (packet: Uint8Array): Promise<boolean> => {
    if (!sendForceCommand) {
      addLog('发送失败: 请先通过右上角“选择检测设备”连接机械手');
      return false;
    }
    try {
      return await sendForceCommand(packet);
    } catch (e) {
      addLog(`发送失败: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }, [addLog, sendForceCommand]);

  // 上传 JSON 动作文件
  const handleLoadJSON = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text) as Array<Record<string, unknown>>;
        const actions = parseActionsFromJSON(data);
        setAvailableActions(actions);
        setJsonFileName(file.name);
        addLog(`已加载动作文件: ${file.name} (${actions.length} 个动作: ${actions.map(a => a.name).join(', ')})`);
        toast.success(`已加载 ${actions.length} 个动作`);
      } catch (err) {
        toast.error(`JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`);
        addLog(`JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    input.click();
  }, [addLog]);

  // 添加动作到循环序列
  const addToSequence = useCallback((action: HandAction) => {
    setSequenceActions(prev => [...prev, action]);
  }, []);

  // 从循环序列中移除
  const removeFromSequence = useCallback((index: number) => {
    setSequenceActions(prev => prev.filter((_, i) => i !== index));
  }, []);

  // 上移/下移序列中的动作
  const moveInSequence = useCallback((index: number, direction: 'up' | 'down') => {
    setSequenceActions(prev => {
      const next = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }, []);

  // 清空序列
  const clearSequence = useCallback(() => {
    setSequenceActions([]);
  }, []);

  // 执行单个动作
  const executeAction = useCallback(async (action: HandAction): Promise<boolean> => {
    setCurrentActionName(action.name);
    const pkt = buildSetPositionsPacket(OMNI_DEVICE_ID, action.positions);
    return await sendOmniPacket(pkt);
  }, [sendOmniPacket]);

  // 可中断延迟
  const delay = useCallback((ms: number): Promise<void> => {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      const checkAbort = setInterval(() => {
        if (testAbortRef.current) {
          clearTimeout(timer);
          clearInterval(checkAbort);
          resolve();
        }
      }, 100);
      setTimeout(() => clearInterval(checkAbort), ms + 100);
    });
  }, []);

  // 开始循环测试
  const handleStartTest = useCallback(async () => {
    if (!omniConnected) {
      toast.error('请先通过右上角“选择检测设备”连接机械手');
      return;
    }
    if (sequenceActions.length === 0) {
      toast.error('请先添加动作到循环序列');
      return;
    }

    testAbortRef.current = false;
    setIsTesting(true);
    setCurrentCycle(0);
    setCurrentActionName('');
    addLog(`开始循环测试: ${totalCycles} 次, 间隔 ${intervalMs}ms, 序列: ${sequenceActions.map(a => a.name).join(' → ')}`);

    try {
      for (let i = 0; i < totalCycles; i++) {
        if (testAbortRef.current) {
          addLog(`测试已在第 ${i} 次循环时停止`);
          break;
        }
        setCurrentCycle(i + 1);

        // 依次执行序列中的每个动作
        for (let j = 0; j < sequenceActions.length; j++) {
          if (testAbortRef.current) break;
          const action = sequenceActions[j];
          const sent = await executeAction(action);
          if (sent) {
            // 只在每10次或首次/末次打印详细日志
            if (i === 0 || (i + 1) % 10 === 0 || i === totalCycles - 1) {
              // 不打印每个动作，减少日志量
            }
          }
          await delay(intervalMs);
        }

        if ((i + 1) % 10 === 0 || i === totalCycles - 1 || i === 0) {
          addLog(`已完成 ${i + 1}/${totalCycles} 次循环`);
        }
      }

      if (!testAbortRef.current) {
        addLog(`循环测试完成: 共 ${totalCycles} 次`);
        toast.success(`灵巧手循环测试完成 (${totalCycles} 次)`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`测试异常: ${msg}`);
      toast.error(`测试异常: ${msg}`);
    } finally {
      setIsTesting(false);
      setCurrentActionName('');
    }
  }, [omniConnected, sequenceActions, totalCycles, intervalMs, addLog, executeAction, delay]);

  // 停止测试
  const handleStopTest = useCallback(() => {
    testAbortRef.current = true;
    addLog('正在停止测试...');
  }, [addLog]);

  // 手动执行单个动作
  const handleManualAction = useCallback(async (action: HandAction) => {
    if (!omniConnected) {
      toast.error('请先通过右上角“选择检测设备”连接机械手');
      return;
    }
    const sent = await executeAction(action);
    if (sent) addLog(`手动执行: ${action.name}`);
  }, [omniConnected, executeAction, addLog]);

  // ─── 传感器采集相关 ───
  const handleStart = useCallback(async () => {
    const hasSelection = showHandLayout ? handSelectedIndices.size > 0 : selectedSensors.length > 0;
    if (!hasSelection) {
      toast.error('请先选择至少一个传感器点');
      return;
    }
    setIsRunning(true);
    setResult(null);
    setProgress(0);
    toast.info(`开始耐久性检测，共 ${params.durabilityCount} 次抓握...`);
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
  }, [selectedSensors, params, showHandLayout, handSelectedIndices]);

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

  // 使能/失能切换
  const handleToggleEnable = useCallback(async () => {
    if (!sendForceCommand || !omniConnected) {
      toast.error('请先连接灵巧手');
      return;
    }
    if (omniEnabled) {
      // 当前已使能，发送失能命令
      const pkt = buildDisablePacket(OMNI_DEVICE_ID);
      const sent = await sendForceCommand(pkt);
      if (sent) {
        setOmniEnabled(false);
        addLog('灵巧手已失能');
        toast.info('灵巧手已失能');
      }
    } else {
      // 当前已失能，发送使能命令
      const pkt = buildEnablePacket(OMNI_DEVICE_ID);
      const sent = await sendForceCommand(pkt);
      if (sent) {
        setOmniEnabled(true);
        addLog('灵巧手已使能');
        toast.success('灵巧手已使能');
      }
    }
  }, [sendForceCommand, omniConnected, omniEnabled, addLog]);

  // 监听连接状态变化，记录日志并同步使能状态
  const prevOmniConnectedRef = useRef(false);
  useEffect(() => {
    if (omniConnected && !prevOmniConnectedRef.current) {
      addLog('灵巧手已通过右上角连接并使能');
      setOmniEnabled(true); // 连接时Home.tsx已自动发送使能命令
    } else if (!omniConnected && prevOmniConnectedRef.current) {
      addLog('灵巧手已断开');
      setOmniEnabled(false);
    }
    prevOmniConnectedRef.current = omniConnected;
  }, [omniConnected, addLog]);

  // 清理
  useEffect(() => {
    return () => { testAbortRef.current = true; };
  }, []);

  const testProgress = totalCycles > 0 ? (currentCycle / totalCycles) * 100 : 0;

  return (
    <div className="flex gap-0 items-start" style={{ height: '100%', overflowY: 'auto' }}>
      {/* ═══ 左侧：传感器矩阵 + 数据采集 ═══ */}
      <div
        className="flex flex-col gap-3 p-3"
        style={{
          width: '520px',
          minWidth: '280px',
          borderRight: '1px solid var(--jk-s4)',
          flexShrink: 0,
        }}
      >
        {/* 传感器矩阵 */}
        <div className="rounded" style={{ background: 'var(--jk-s2)', border: '1px solid var(--jk-line-1)', flexShrink: 0, padding: '10px', overflowX: 'auto' }}>
          {/* 手掌布局/矩阵显示切换开关 */}
          {handSide && (
            <div className="flex items-center gap-1 mb-3 p-1 rounded-lg" style={{ background: 'var(--jk-sunken)', border: '1px solid var(--jk-line-1)' }}>
              <button
                onClick={() => { if (!useHandLayout) toggleHandLayout(); }}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-mono font-medium transition-all"
                style={{
                  background: useHandLayout ? 'color-mix(in srgb, var(--jk-primary) 25%, transparent)' : 'transparent',
                  border: useHandLayout ? '1px solid color-mix(in srgb, var(--jk-primary) 50%, transparent)' : '1px solid transparent',
                  color: useHandLayout ? 'var(--jk-primary)' : 'var(--jk-text-low)',
                }}
              >
                <Hand size={16} />
                <span>手掌布局</span>
              </button>
              <button
                onClick={() => { if (useHandLayout) toggleHandLayout(); }}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-mono font-medium transition-all"
                style={{
                  background: !useHandLayout ? 'color-mix(in srgb, var(--jk-ok) 25%, transparent)' : 'transparent',
                  border: !useHandLayout ? '1px solid color-mix(in srgb, var(--jk-ok) 50%, transparent)' : '1px solid transparent',
                  color: !useHandLayout ? 'var(--jk-ok)' : 'var(--jk-text-low)',
                }}
              >
                <Grid3x3 size={16} />
                <span>矩阵显示</span>
              </button>
            </div>
          )}
          {showHandLayout && handSide ? (
            <HandMatrix
              side={handSide}
              adcValues={latestAdcValues}
              showIndex={true}
              selectedIndices={handSelectedIndices}
              onToggleSelect={handleHandToggleSelect}
            />
          ) : (
            <SensorMatrix
              sensors={sensors}
              rows={matrixRows}
              cols={matrixCols}
              onSelectionChange={setSensors}
              onResize={handleMatrixResize}
            />
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2" style={{ flexShrink: 0 }}>
          {showHandLayout && handSide && (
            <button
              onClick={() => {
                const allIndices = getHandIndices(handSide);
                const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                if (allSelected) setHandSelectedIndices(new Set());
                else setHandSelectedIndices(new Set(allIndices));
              }}
              disabled={isRunning}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-mono transition-all disabled:opacity-50"
              style={{
                background: (() => {
                  const allIndices = getHandIndices(handSide);
                  const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                  return allSelected ? 'color-mix(in srgb, var(--jk-danger) 30%, transparent)' : 'color-mix(in srgb, var(--jk-primary) 30%, transparent)';
                })(),
                border: (() => {
                  const allIndices = getHandIndices(handSide);
                  const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                  return allSelected ? '1px solid color-mix(in srgb, var(--jk-danger) 50%, transparent)' : '1px solid color-mix(in srgb, var(--jk-primary) 50%, transparent)';
                })(),
                color: (() => {
                  const allIndices = getHandIndices(handSide);
                  const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                  return allSelected ? 'var(--jk-danger)' : 'var(--jk-primary)';
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
            style={{ background: 'color-mix(in srgb, var(--jk-ok) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--jk-ok) 30%, transparent)', color: 'var(--jk-ok)' }}
          >
            <Download size={12} /> 导出数据
          </button>
          <button
            onClick={handleReset}
            disabled={isRunning}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-mono transition-all disabled:opacity-50"
            style={{ background: 'var(--jk-s4)', border: '1px solid var(--jk-line-3)', color: 'var(--jk-text-high)' }}
          >
            <RefreshCw size={12} /> 重置
          </button>
        </div>

        <ParameterPanel params={params} onChange={setParams} mode="durability" />

        {isRunning && (
          <div style={{ flexShrink: 0 }}>
            <div className="flex justify-between text-xs font-mono mb-1" style={{ color: 'var(--jk-text-mid)' }}>
              <span>抓握进度</span><span>{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--jk-s4)' }}>
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, background: 'var(--jk-primary)' }} />
            </div>
          </div>
        )}

        <TestResultCard
          result={result}
          title="耐久性判定"
          description={`反复抓握${params.durabilityCount.toLocaleString()}次，验证传感点灵敏度变化，阈值±${params.threshold}%`}
          isRunning={isRunning}
        />

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
          onStartRecording={() => {
            if (isForceConnected && sendForceCommand) {
              sendForceCommand(new Uint8Array([0x23, 0x55, 0x00, 0x0A]));
            }
          }}
        />
      </div>

      {/* ═══ 右侧：灵巧手控制面板 ═══ */}
      <div className="flex-1 flex flex-col min-w-0 p-3 gap-3" style={{ flexShrink: 0, position: 'sticky', top: 0, alignSelf: 'flex-start', maxHeight: '100%', overflowY: 'auto' }}>
        {/* 标题栏 + 使能按钮 */}
        <div
          className="flex items-center justify-between px-3 py-2 rounded"
          style={{ background: 'var(--jk-s2)', border: '1px solid var(--jk-line-1)', flexShrink: 0 }}
        >
          <div className="flex items-center gap-2">
            <Hand size={14} style={{ color: 'var(--jk-accent-2)' }} />
            <span className="text-xs font-mono font-semibold" style={{ color: 'var(--jk-accent-2)' }}>
              灵巧手控制
            </span>
            {omniConnected ? (
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: omniEnabled ? 'var(--jk-ok)' : 'oklch(0.65 0.22 60)' }} />
                <span style={{ color: 'var(--jk-text-body)', fontSize: '9px', fontFamily: "'IBM Plex Mono', monospace" }}>
                  {omniEnabled ? '已连接 · 已使能' : '已连接 · 已失能'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--jk-text-dim)' }} />
                <span style={{ color: 'var(--jk-text-low)', fontSize: '9px', fontFamily: "'IBM Plex Mono', monospace" }}>
                  未连接
                </span>
              </div>
            )}
          </div>
          {omniConnected ? (
            <button
              onClick={handleToggleEnable}
              disabled={isTesting}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-mono transition-colors disabled:opacity-40"
              style={{
                background: omniEnabled ? 'color-mix(in srgb, var(--jk-danger) 12%, transparent)' : 'color-mix(in srgb, var(--jk-accent-2) 12%, transparent)',
                border: `1px solid ${omniEnabled ? 'color-mix(in srgb, var(--jk-danger) 30%, transparent)' : 'color-mix(in srgb, var(--jk-accent-2) 30%, transparent)'}`,
                color: omniEnabled ? 'var(--jk-danger)' : 'var(--jk-accent-2)',
                fontSize: '10px',
              }}
            >
              <Power size={10} /> {omniEnabled ? '失能' : '使能'}
            </button>
          ) : (
            <span className="text-xs font-mono" style={{ color: 'var(--jk-text-low)', fontSize: '9px' }}>
              通过右上角“选择检测设备”连接
            </span>
          )}
        </div>

        {/* 未连接提示 */}
        {!omniConnected && (
          <div className="flex items-start gap-2 px-3 py-2 rounded text-xs" style={{ background: 'color-mix(in srgb, var(--jk-primary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--jk-primary) 20%, transparent)', flexShrink: 0 }}>
            <AlertCircle size={12} style={{ color: 'var(--jk-primary)', flexShrink: 0, marginTop: '1px' }} />
            <span style={{ color: 'var(--jk-line-4)', fontSize: '10px' }}>
              请在右上角“选择检测设备”中选择“机械手”并连接，连接成功后将自动发送使能命令
            </span>
          </div>
        )}

        {/* 上传 JSON + 动作列表 */}
        <div
          className="rounded p-3"
          style={{ background: 'var(--jk-s2)', border: '1px solid var(--jk-line-1)', flexShrink: 0 }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono font-semibold" style={{ color: 'var(--jk-text-high)' }}>
              动作库 {jsonFileName && <span style={{ color: 'var(--jk-text-mid)', fontWeight: 'normal' }}>({jsonFileName})</span>}
            </span>
            <button
              onClick={handleLoadJSON}
              disabled={isTesting}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors disabled:opacity-40"
              style={{ background: 'var(--jk-s4)', border: '1px solid var(--jk-line-3)', color: 'var(--jk-text-high)', fontSize: '10px' }}
            >
              <Upload size={10} /> 上传 JSON
            </button>
          </div>

          {availableActions.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-xs font-mono" style={{ color: 'var(--jk-text-dim)', border: '1px dashed var(--jk-line-2)', borderRadius: '6px' }}>
              请上传灵巧手动作 JSON 文件
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {availableActions.map((action, idx) => (
                <button
                  key={`${action.name}-${idx}`}
                  className="group flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-mono transition-all"
                  style={{
                    background: 'var(--jk-s4)',
                    border: '1px solid var(--jk-line-3)',
                    color: 'var(--jk-text-strong)',
                  }}
                  title={`点击添加到循环序列 | 双击手动执行\n轴位置: ${action.positions.join(', ')}`}
                  onClick={() => addToSequence(action)}
                  onDoubleClick={(e) => { e.preventDefault(); handleManualAction(action); }}
                >
                  <Plus size={10} style={{ color: 'var(--jk-accent-2)', opacity: 0.6 }} />
                  {action.name}
                </button>
              ))}
            </div>
          )}
          {availableActions.length > 0 && (
            <div className="mt-1.5 text-xs font-mono" style={{ color: 'var(--jk-text-dim)', fontSize: '9px' }}>
              单击添加到循环序列
            </div>
          )}

          {/* 快捷执行按钮 */}
          {availableActions.length > 0 && (
            <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--jk-line-1)' }}>
              <div className="text-xs font-mono mb-1.5" style={{ color: 'var(--jk-text-mid)', fontSize: '9px' }}>
                快捷执行
              </div>
              <div className="flex flex-wrap gap-1.5">
                {availableActions.map((action, idx) => (
                  <button
                    key={`exec-${action.name}-${idx}`}
                    onClick={() => handleManualAction(action)}
                    disabled={!omniConnected || !omniEnabled || isTesting}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-mono font-medium transition-all disabled:opacity-30"
                    style={{
                      background: omniConnected && omniEnabled ? 'color-mix(in srgb, var(--jk-accent-2) 10%, transparent)' : 'var(--jk-s3)',
                      border: `1px solid ${omniConnected && omniEnabled ? 'color-mix(in srgb, var(--jk-accent-2) 25%, transparent)' : 'var(--jk-line-2)'}`,
                      color: omniConnected && omniEnabled ? 'var(--jk-accent-2)' : 'var(--jk-text-low)',
                    }}
                    title={`点击立即执行: ${action.name}\n轴位置: ${action.positions.join(', ')}`}
                  >
                    <Zap size={10} />
                    {action.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 循环序列方框 */}
        <div
          className="rounded p-3"
          style={{ background: 'var(--jk-s2)', border: '1px solid var(--jk-line-1)', flexShrink: 0 }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono font-semibold" style={{ color: 'var(--jk-text-high)' }}>
              循环序列 <span style={{ color: 'var(--jk-text-mid)', fontWeight: 'normal' }}>({sequenceActions.length} 个动作)</span>
            </span>
            {sequenceActions.length > 0 && (
              <button
                onClick={clearSequence}
                disabled={isTesting}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono transition-colors disabled:opacity-40"
                style={{ background: 'color-mix(in srgb, var(--jk-danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--jk-danger) 20%, transparent)', color: 'var(--jk-danger)', fontSize: '9px' }}
              >
                <Trash2 size={9} /> 清空
              </button>
            )}
          </div>

          {sequenceActions.length === 0 ? (
            <div
              className="flex items-center justify-center py-8 text-xs font-mono"
              style={{
                color: 'var(--jk-text-dim)',
                border: '2px dashed var(--jk-line-2)',
                borderRadius: '8px',
                background: 'var(--jk-sunken)',
              }}
            >
              从上方动作库中点击动作添加到此处
            </div>
          ) : (
            <div className="space-y-1">
              {sequenceActions.map((action, idx) => (
                <div
                  key={`seq-${idx}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded transition-all"
                  style={{
                    background: currentActionName === action.name && isTesting
                      ? 'color-mix(in srgb, var(--jk-accent-2) 15%, transparent)'
                      : 'var(--jk-s3)',
                    border: `1px solid ${currentActionName === action.name && isTesting ? 'color-mix(in srgb, var(--jk-accent-2) 30%, transparent)' : 'var(--jk-line-2)'}`,
                  }}
                >
                  <GripVertical size={10} style={{ color: 'var(--jk-text-dim)', flexShrink: 0 }} />
                  <span className="text-xs font-mono" style={{ color: 'var(--jk-text-mid)', fontSize: '9px', width: '16px', textAlign: 'center', flexShrink: 0 }}>
                    {idx + 1}
                  </span>
                  <span
                    className="flex-1 text-xs font-mono font-medium"
                    style={{
                      color: currentActionName === action.name && isTesting
                        ? 'var(--jk-accent-2)'
                        : 'var(--jk-text-strong)',
                    }}
                  >
                    {action.name}
                  </span>
                  <div className="flex items-center gap-0.5" style={{ flexShrink: 0 }}>
                    <button
                      onClick={() => moveInSequence(idx, 'up')}
                      disabled={idx === 0 || isTesting}
                      className="p-0.5 rounded transition-colors disabled:opacity-20"
                      style={{ color: 'var(--jk-text-mid)' }}
                    >
                      <ChevronUp size={10} />
                    </button>
                    <button
                      onClick={() => moveInSequence(idx, 'down')}
                      disabled={idx === sequenceActions.length - 1 || isTesting}
                      className="p-0.5 rounded transition-colors disabled:opacity-20"
                      style={{ color: 'var(--jk-text-mid)' }}
                    >
                      <ChevronDown size={10} />
                    </button>
                    <button
                      onClick={() => removeFromSequence(idx)}
                      disabled={isTesting}
                      className="p-0.5 rounded transition-colors disabled:opacity-20"
                      style={{ color: 'var(--jk-danger)' }}
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {sequenceActions.length > 0 && (
            <div className="mt-2 text-xs font-mono" style={{ color: 'var(--jk-text-dim)', fontSize: '9px' }}>
              执行顺序: {sequenceActions.map(a => a.name).join(' → ')} (循环)
            </div>
          )}
        </div>

        {/* 循环参数 */}
        <div
          className="rounded p-3"
          style={{ background: 'var(--jk-s2)', border: '1px solid var(--jk-line-1)', flexShrink: 0 }}
        >
          <div className="text-xs font-mono font-semibold mb-2" style={{ color: 'var(--jk-text-high)' }}>
            循环参数
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono mb-1" style={{ color: 'var(--jk-text-mid)', fontSize: '10px' }}>
                循环次数
              </label>
              <input
                type="number"
                min={1}
                max={100000}
                value={totalCycles}
                onChange={(e) => setTotalCycles(Math.max(1, parseInt(e.target.value) || 1))}
                disabled={isTesting}
                className="w-full px-2.5 py-1.5 rounded text-xs font-mono disabled:opacity-40"
                style={{ background: 'var(--jk-bg)', border: '1px solid var(--jk-line-2)', color: 'var(--jk-ink)', fontSize: '11px' }}
              />
            </div>
            <div>
              <label className="block text-xs font-mono mb-1" style={{ color: 'var(--jk-text-mid)', fontSize: '10px' }}>
                动作间隔 (ms)
              </label>
              <input
                type="number"
                min={200}
                max={10000}
                step={100}
                value={intervalMs}
                onChange={(e) => setIntervalMs(Math.max(200, parseInt(e.target.value) || 2000))}
                disabled={isTesting}
                className="w-full px-2.5 py-1.5 rounded text-xs font-mono disabled:opacity-40"
                style={{ background: 'var(--jk-bg)', border: '1px solid var(--jk-line-2)', color: 'var(--jk-ink)', fontSize: '11px' }}
              />
            </div>
          </div>
        </div>

        {/* 开始/停止按钮 */}
        <div className="flex gap-2" style={{ flexShrink: 0 }}>
          {!isTesting ? (
            <button
              onClick={handleStartTest}
              disabled={!omniConnected || sequenceActions.length === 0}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded text-xs font-mono font-semibold transition-colors disabled:opacity-30"
              style={{
                background: omniConnected && sequenceActions.length > 0 ? 'color-mix(in srgb, var(--jk-accent-2) 15%, transparent)' : 'var(--jk-s3)',
                border: `1px solid ${omniConnected && sequenceActions.length > 0 ? 'color-mix(in srgb, var(--jk-accent-2) 30%, transparent)' : 'var(--jk-line-2)'}`,
                color: omniConnected && sequenceActions.length > 0 ? 'var(--jk-accent-2)' : 'var(--jk-text-low)',
              }}
            >
              <Play size={12} /> 开始循环 ({totalCycles} 次)
            </button>
          ) : (
            <button
              onClick={handleStopTest}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded text-xs font-mono font-semibold transition-colors"
              style={{ background: 'color-mix(in srgb, var(--jk-danger) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--jk-danger) 30%, transparent)', color: 'var(--jk-danger)' }}
            >
              <Square size={12} /> 停止测试
            </button>
          )}
        </div>

        {/* 进度条 */}
        {(isTesting || currentCycle > 0) && (
          <div style={{ flexShrink: 0 }}>
            <div className="flex justify-between text-xs font-mono mb-1" style={{ color: 'var(--jk-text-mid)', fontSize: '10px' }}>
              <span>{isTesting ? `正在执行: ${currentActionName || '...'}` : '已完成'}</span>
              <span>{currentCycle} / {totalCycles}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--jk-s3)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${testProgress}%`, background: isTesting ? 'var(--jk-accent-2)' : 'var(--jk-ok)' }}
              />
            </div>
          </div>
        )}

        {/* 日志面板 */}
        <div
          className="flex-1 min-h-0 rounded overflow-hidden flex flex-col"
          style={{ background: 'var(--jk-bg)', border: '1px solid var(--jk-s4)' }}
        >
          <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: '1px solid var(--jk-s4)', flexShrink: 0 }}>
            <span className="text-xs font-mono" style={{ color: 'var(--jk-text-mid)', fontSize: '10px' }}>
              运行日志 ({logMessages.length})
            </span>
            <button
              onClick={() => { setLogMessages([]); setCurrentCycle(0); }}
              disabled={isTesting}
              className="text-xs font-mono px-1.5 py-0.5 rounded transition-colors disabled:opacity-30"
              style={{ color: 'var(--jk-text-mid)', fontSize: '9px' }}
            >
              清除
            </button>
          </div>
          <div
            className="flex-1 overflow-y-auto px-3 py-2 font-mono"
            style={{ fontSize: '9px', lineHeight: '1.7' }}
          >
            {logMessages.length === 0 ? (
              <div style={{ color: 'var(--jk-text-dim)' }}>等待操作...</div>
            ) : (
              logMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    color: msg.includes('失败') || msg.includes('错误') || msg.includes('异常')
                      ? 'var(--jk-danger)'
                      : msg.includes('成功') || msg.includes('完成')
                      ? 'var(--jk-ok)'
                      : 'var(--jk-text-mid)',
                  }}
                >
                  {msg}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
