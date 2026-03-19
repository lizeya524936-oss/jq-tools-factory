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
import { RefreshCw, Download, Upload, Play, Square, Trash2, Plus, GripVertical, ChevronUp, ChevronDown, Hand, AlertCircle, Power, Zap } from 'lucide-react';
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
  const { latestSensorMatrix, latestAdcValues, latestRawFrame, isForceConnected, isSensorConnected, latestForceN, sendForceCommand, sensorDeviceType, forceDeviceMode, sensorMatrixSize } = useSerialData();

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
    if (sensorMatrixSize && sensorMatrixSize !== matrixRows) {
      handleMatrixResize(sensorMatrixSize, sensorMatrixSize);
    }
  }, [sensorMatrixSize]);  // eslint-disable-line react-hooks/exhaustive-deps

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
    const hasSelection = handSide ? handSelectedIndices.size > 0 : selectedSensors.length > 0;
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
          borderRight: '1px solid oklch(0.22 0.03 265)',
          flexShrink: 0,
        }}
      >
        {/* 传感器矩阵 */}
        <div className="rounded" style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', flexShrink: 0, padding: '10px', overflowX: 'auto' }}>
          {handSide ? (
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
          {handSide && (
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
                return allIndices.every(i => handSelectedIndices.has(i)) ? '全部取消' : '全选';
              })()}
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={isRunning || records.length === 0}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-mono transition-all disabled:opacity-40"
            style={{ background: 'oklch(0.72 0.20 145 / 0.15)', border: '1px solid oklch(0.72 0.20 145 / 0.3)', color: 'oklch(0.72 0.20 145)' }}
          >
            <Download size={12} /> 导出数据
          </button>
          <button
            onClick={handleReset}
            disabled={isRunning}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-mono transition-all disabled:opacity-50"
            style={{ background: 'oklch(0.22 0.03 265)', border: '1px solid oklch(0.30 0.03 265)', color: 'oklch(0.60 0.02 240)' }}
          >
            <RefreshCw size={12} /> 重置
          </button>
        </div>

        <ParameterPanel params={params} onChange={setParams} mode="durability" />

        {isRunning && (
          <div style={{ flexShrink: 0 }}>
            <div className="flex justify-between text-xs font-mono mb-1" style={{ color: 'oklch(0.50 0.02 240)' }}>
              <span>抓握进度</span><span>{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'oklch(0.22 0.03 265)' }}>
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, background: 'oklch(0.58 0.22 265)' }} />
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
          handSelectedIndices={handSide ? handSelectedIndices : undefined}
        />
      </div>

      {/* ═══ 右侧：灵巧手控制面板 ═══ */}
      <div className="flex-1 flex flex-col min-w-0 p-3 gap-3" style={{ flexShrink: 0, position: 'sticky', top: 0, alignSelf: 'flex-start', maxHeight: '100%', overflowY: 'auto' }}>
        {/* 标题栏 + 使能按钮 */}
        <div
          className="flex items-center justify-between px-3 py-2 rounded"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', flexShrink: 0 }}
        >
          <div className="flex items-center gap-2">
            <Hand size={14} style={{ color: 'oklch(0.75 0.15 180)' }} />
            <span className="text-xs font-mono font-semibold" style={{ color: 'oklch(0.75 0.15 180)' }}>
              灵巧手控制
            </span>
            {omniConnected ? (
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: omniEnabled ? 'oklch(0.75 0.18 150)' : 'oklch(0.65 0.22 60)' }} />
                <span style={{ color: 'oklch(0.55 0.02 240)', fontSize: '9px', fontFamily: "'IBM Plex Mono', monospace" }}>
                  {omniEnabled ? '已连接 · 已使能' : '已连接 · 已失能'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'oklch(0.40 0.02 240)' }} />
                <span style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px', fontFamily: "'IBM Plex Mono', monospace" }}>
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
                background: omniEnabled ? 'oklch(0.65 0.22 25 / 0.12)' : 'oklch(0.75 0.15 180 / 0.12)',
                border: `1px solid ${omniEnabled ? 'oklch(0.65 0.22 25 / 0.3)' : 'oklch(0.75 0.15 180 / 0.3)'}`,
                color: omniEnabled ? 'oklch(0.65 0.22 25)' : 'oklch(0.75 0.15 180)',
                fontSize: '10px',
              }}
            >
              <Power size={10} /> {omniEnabled ? '失能' : '使能'}
            </button>
          ) : (
            <span className="text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px' }}>
              通过右上角“选择检测设备”连接
            </span>
          )}
        </div>

        {/* 未连接提示 */}
        {!omniConnected && (
          <div className="flex items-start gap-2 px-3 py-2 rounded text-xs" style={{ background: 'oklch(0.58 0.22 265 / 0.08)', border: '1px solid oklch(0.58 0.22 265 / 0.2)', flexShrink: 0 }}>
            <AlertCircle size={12} style={{ color: 'oklch(0.58 0.22 265)', flexShrink: 0, marginTop: '1px' }} />
            <span style={{ color: 'oklch(0.65 0.05 265)', fontSize: '10px' }}>
              请在右上角“选择检测设备”中选择“机械手”并连接，连接成功后将自动发送使能命令
            </span>
          </div>
        )}

        {/* 上传 JSON + 动作列表 */}
        <div
          className="rounded p-3"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', flexShrink: 0 }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono font-semibold" style={{ color: 'oklch(0.65 0.02 240)' }}>
              动作库 {jsonFileName && <span style={{ color: 'oklch(0.50 0.02 240)', fontWeight: 'normal' }}>({jsonFileName})</span>}
            </span>
            <button
              onClick={handleLoadJSON}
              disabled={isTesting}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors disabled:opacity-40"
              style={{ background: 'oklch(0.22 0.03 265)', border: '1px solid oklch(0.30 0.03 265)', color: 'oklch(0.60 0.02 240)', fontSize: '10px' }}
            >
              <Upload size={10} /> 上传 JSON
            </button>
          </div>

          {availableActions.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-xs font-mono" style={{ color: 'oklch(0.40 0.02 240)', border: '1px dashed oklch(0.28 0.03 265)', borderRadius: '6px' }}>
              请上传灵巧手动作 JSON 文件
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {availableActions.map((action, idx) => (
                <button
                  key={`${action.name}-${idx}`}
                  className="group flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-mono transition-all"
                  style={{
                    background: 'oklch(0.22 0.03 265)',
                    border: '1px solid oklch(0.30 0.03 265)',
                    color: 'oklch(0.70 0.02 240)',
                  }}
                  title={`点击添加到循环序列 | 双击手动执行\n轴位置: ${action.positions.join(', ')}`}
                  onClick={() => addToSequence(action)}
                  onDoubleClick={(e) => { e.preventDefault(); handleManualAction(action); }}
                >
                  <Plus size={10} style={{ color: 'oklch(0.50 0.15 180)', opacity: 0.6 }} />
                  {action.name}
                </button>
              ))}
            </div>
          )}
          {availableActions.length > 0 && (
            <div className="mt-1.5 text-xs font-mono" style={{ color: 'oklch(0.40 0.02 240)', fontSize: '9px' }}>
              单击添加到循环序列
            </div>
          )}

          {/* 快捷执行按钮 */}
          {availableActions.length > 0 && (
            <div className="mt-2 pt-2" style={{ borderTop: '1px solid oklch(0.25 0.03 265)' }}>
              <div className="text-xs font-mono mb-1.5" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px' }}>
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
                      background: omniConnected && omniEnabled ? 'oklch(0.75 0.15 180 / 0.10)' : 'oklch(0.20 0.025 265)',
                      border: `1px solid ${omniConnected && omniEnabled ? 'oklch(0.75 0.15 180 / 0.25)' : 'oklch(0.28 0.03 265)'}`,
                      color: omniConnected && omniEnabled ? 'oklch(0.75 0.15 180)' : 'oklch(0.45 0.02 240)',
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
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', flexShrink: 0 }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono font-semibold" style={{ color: 'oklch(0.65 0.02 240)' }}>
              循环序列 <span style={{ color: 'oklch(0.50 0.02 240)', fontWeight: 'normal' }}>({sequenceActions.length} 个动作)</span>
            </span>
            {sequenceActions.length > 0 && (
              <button
                onClick={clearSequence}
                disabled={isTesting}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono transition-colors disabled:opacity-40"
                style={{ background: 'oklch(0.65 0.22 25 / 0.1)', border: '1px solid oklch(0.65 0.22 25 / 0.2)', color: 'oklch(0.65 0.22 25)', fontSize: '9px' }}
              >
                <Trash2 size={9} /> 清空
              </button>
            )}
          </div>

          {sequenceActions.length === 0 ? (
            <div
              className="flex items-center justify-center py-8 text-xs font-mono"
              style={{
                color: 'oklch(0.40 0.02 240)',
                border: '2px dashed oklch(0.28 0.03 265)',
                borderRadius: '8px',
                background: 'oklch(0.14 0.02 265)',
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
                      ? 'oklch(0.75 0.15 180 / 0.15)'
                      : 'oklch(0.20 0.025 265)',
                    border: `1px solid ${currentActionName === action.name && isTesting ? 'oklch(0.75 0.15 180 / 0.3)' : 'oklch(0.28 0.03 265)'}`,
                  }}
                >
                  <GripVertical size={10} style={{ color: 'oklch(0.35 0.02 240)', flexShrink: 0 }} />
                  <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px', width: '16px', textAlign: 'center', flexShrink: 0 }}>
                    {idx + 1}
                  </span>
                  <span
                    className="flex-1 text-xs font-mono font-medium"
                    style={{
                      color: currentActionName === action.name && isTesting
                        ? 'oklch(0.75 0.15 180)'
                        : 'oklch(0.70 0.02 240)',
                    }}
                  >
                    {action.name}
                  </span>
                  <div className="flex items-center gap-0.5" style={{ flexShrink: 0 }}>
                    <button
                      onClick={() => moveInSequence(idx, 'up')}
                      disabled={idx === 0 || isTesting}
                      className="p-0.5 rounded transition-colors disabled:opacity-20"
                      style={{ color: 'oklch(0.50 0.02 240)' }}
                    >
                      <ChevronUp size={10} />
                    </button>
                    <button
                      onClick={() => moveInSequence(idx, 'down')}
                      disabled={idx === sequenceActions.length - 1 || isTesting}
                      className="p-0.5 rounded transition-colors disabled:opacity-20"
                      style={{ color: 'oklch(0.50 0.02 240)' }}
                    >
                      <ChevronDown size={10} />
                    </button>
                    <button
                      onClick={() => removeFromSequence(idx)}
                      disabled={isTesting}
                      className="p-0.5 rounded transition-colors disabled:opacity-20"
                      style={{ color: 'oklch(0.65 0.22 25)' }}
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {sequenceActions.length > 0 && (
            <div className="mt-2 text-xs font-mono" style={{ color: 'oklch(0.40 0.02 240)', fontSize: '9px' }}>
              执行顺序: {sequenceActions.map(a => a.name).join(' → ')} (循环)
            </div>
          )}
        </div>

        {/* 循环参数 */}
        <div
          className="rounded p-3"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', flexShrink: 0 }}
        >
          <div className="text-xs font-mono font-semibold mb-2" style={{ color: 'oklch(0.65 0.02 240)' }}>
            循环参数
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono mb-1" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '10px' }}>
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
                style={{ background: 'oklch(0.12 0.025 265)', border: '1px solid oklch(0.28 0.03 265)', color: 'oklch(0.82 0.01 220)', fontSize: '11px' }}
              />
            </div>
            <div>
              <label className="block text-xs font-mono mb-1" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '10px' }}>
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
                style={{ background: 'oklch(0.12 0.025 265)', border: '1px solid oklch(0.28 0.03 265)', color: 'oklch(0.82 0.01 220)', fontSize: '11px' }}
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
                background: omniConnected && sequenceActions.length > 0 ? 'oklch(0.75 0.15 180 / 0.15)' : 'oklch(0.20 0.025 265)',
                border: `1px solid ${omniConnected && sequenceActions.length > 0 ? 'oklch(0.75 0.15 180 / 0.3)' : 'oklch(0.28 0.03 265)'}`,
                color: omniConnected && sequenceActions.length > 0 ? 'oklch(0.75 0.15 180)' : 'oklch(0.45 0.02 240)',
              }}
            >
              <Play size={12} /> 开始循环 ({totalCycles} 次)
            </button>
          ) : (
            <button
              onClick={handleStopTest}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded text-xs font-mono font-semibold transition-colors"
              style={{ background: 'oklch(0.65 0.22 25 / 0.15)', border: '1px solid oklch(0.65 0.22 25 / 0.3)', color: 'oklch(0.65 0.22 25)' }}
            >
              <Square size={12} /> 停止测试
            </button>
          )}
        </div>

        {/* 进度条 */}
        {(isTesting || currentCycle > 0) && (
          <div style={{ flexShrink: 0 }}>
            <div className="flex justify-between text-xs font-mono mb-1" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '10px' }}>
              <span>{isTesting ? `正在执行: ${currentActionName || '...'}` : '已完成'}</span>
              <span>{currentCycle} / {totalCycles}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'oklch(0.20 0.025 265)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${testProgress}%`, background: isTesting ? 'oklch(0.75 0.15 180)' : 'oklch(0.75 0.18 150)' }}
              />
            </div>
          </div>
        )}

        {/* 日志面板 */}
        <div
          className="flex-1 min-h-0 rounded overflow-hidden flex flex-col"
          style={{ background: 'oklch(0.12 0.02 265)', border: '1px solid oklch(0.22 0.03 265)' }}
        >
          <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: '1px solid oklch(0.22 0.03 265)', flexShrink: 0 }}>
            <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '10px' }}>
              运行日志 ({logMessages.length})
            </span>
            <button
              onClick={() => { setLogMessages([]); setCurrentCycle(0); }}
              disabled={isTesting}
              className="text-xs font-mono px-1.5 py-0.5 rounded transition-colors disabled:opacity-30"
              style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px' }}
            >
              清除
            </button>
          </div>
          <div
            className="flex-1 overflow-y-auto px-3 py-2 font-mono"
            style={{ fontSize: '9px', lineHeight: '1.7' }}
          >
            {logMessages.length === 0 ? (
              <div style={{ color: 'oklch(0.35 0.02 240)' }}>等待操作...</div>
            ) : (
              logMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    color: msg.includes('失败') || msg.includes('错误') || msg.includes('异常')
                      ? 'oklch(0.65 0.22 25)'
                      : msg.includes('成功') || msg.includes('完成')
                      ? 'oklch(0.75 0.18 150)'
                      : 'oklch(0.50 0.02 240)',
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
