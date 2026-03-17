/**
 * OmniHandControl - 智元灵巧手控制面板
 * 
 * 通信协议：
 * - 波特率: 460800
 * - 帧格式: 0xEE 0xAA + ID(2B) + Len(1B) + CMD(1B) + DATA(NB) + CRC16(2B)
 * - CRC16: CCITT (poly=0x1021, init=0x0000)，校验范围从帧头到数据段结束
 * - 使能: CMD=0x01, DATA=0x01
 * - 失能: CMD=0x01, DATA=0x00
 * - 设置全轴位置: CMD=0x08, DATA=10×uint16(小端)
 * 
 * 设计风格：精密科学仪器，深色主题，IBM Plex 字体
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Usb, Play, Square, Hand, RotateCcw, Upload, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

// ===== 动作预设（来自 okandreleasehold.json）=====
interface HandAction {
  name: string;
  positions: number[]; // 10 个轴的位置 (0-4096)
}

const PRESET_ACTIONS: HandAction[] = [
  {
    name: 'hold',
    positions: [3191, 4095, 452, 133, 0, 0, 2340, 0, 3430, 0],
  },
  {
    name: 'release2',
    positions: [2074, 3404, 3111, 3085, 3749, 3749, 3297, 3882, 1915, 3909],
  },
  {
    name: 'ok',
    positions: [2978, 1356, 931, 3457, 2446, 3537, 3297, 3882, 1915, 3909],
  },
  {
    name: 'release',
    positions: [2686, 1968, 3111, 3537, 3776, 3802, 3300, 3909, 3085, 4095],
  },
];

// ===== CRC16-CCITT 计算 =====
function crc16CCITT(data: Uint8Array): number {
  let crc = 0x0000;
  const poly = 0x1021;
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i] << 8);
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ poly) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc & 0xFFFF;
}

// ===== 构建通信数据包 =====
function buildPacket(deviceId: number, cmd: number, data: Uint8Array = new Uint8Array(0)): Uint8Array {
  // 帧头 (小端模式) 0xAAEE -> EE AA
  const header = new Uint8Array([0xEE, 0xAA]);
  
  // 设备ID (2字节, 小端)
  const idBytes = new Uint8Array(2);
  idBytes[0] = deviceId & 0xFF;
  idBytes[1] = (deviceId >> 8) & 0xFF;
  
  // 数据段 = CMD + DATA
  const dataSegment = new Uint8Array(1 + data.length);
  dataSegment[0] = cmd;
  dataSegment.set(data, 1);
  
  // 数据长度
  const dataLength = dataSegment.length;
  
  // 待校验数据 = 帧头 + ID + 长度 + 数据段
  const crcInput = new Uint8Array(header.length + idBytes.length + 1 + dataSegment.length);
  let offset = 0;
  crcInput.set(header, offset); offset += header.length;
  crcInput.set(idBytes, offset); offset += idBytes.length;
  crcInput[offset] = dataLength; offset += 1;
  crcInput.set(dataSegment, offset);
  
  // 计算 CRC
  const crc = crc16CCITT(crcInput);
  const crcBytes = new Uint8Array(2);
  crcBytes[0] = crc & 0xFF;        // 小端
  crcBytes[1] = (crc >> 8) & 0xFF;
  
  // 完整数据包
  const packet = new Uint8Array(crcInput.length + 2);
  packet.set(crcInput, 0);
  packet.set(crcBytes, crcInput.length);
  
  return packet;
}

// ===== 构建使能命令 =====
function buildEnablePacket(deviceId: number): Uint8Array {
  return buildPacket(deviceId, 0x01, new Uint8Array([0x01]));
}

// ===== 构建失能命令 =====
function buildDisablePacket(deviceId: number): Uint8Array {
  return buildPacket(deviceId, 0x01, new Uint8Array([0x00]));
}

// ===== 构建设置全轴位置命令 =====
function buildSetPositionsPacket(deviceId: number, positions: number[]): Uint8Array {
  // CMD=0x08, DATA=10×uint16(小端)
  const data = new Uint8Array(20); // 10 × 2 bytes
  for (let i = 0; i < 10; i++) {
    const pos = Math.max(0, Math.min(4096, positions[i] || 0));
    data[i * 2] = pos & 0xFF;
    data[i * 2 + 1] = (pos >> 8) & 0xFF;
  }
  return buildPacket(deviceId, 0x08, data);
}

// ===== 组件 Props =====
export interface OmniHandTestConfig {
  cycleCount: number;
  intervalMs: number;
  holdAction: string;
  releaseAction: string;
}

interface OmniHandControlProps {
  onTestStart?: (config: OmniHandTestConfig) => void;
  onTestStop?: () => void;
  onCycleComplete?: (currentCycle: number, totalCycles: number) => void;
  isTestRunning?: boolean;
}

export default function OmniHandControl({
  onTestStart,
  onTestStop,
  onCycleComplete,
}: OmniHandControlProps) {
  // 串口状态
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // 测试状态
  const [isTesting, setIsTesting] = useState(false);
  const [currentCycle, setCurrentCycle] = useState(0);
  const [totalCycles, setTotalCycles] = useState(100);
  const [intervalMs, setIntervalMs] = useState(2000);
  const [currentAction, setCurrentAction] = useState<string>('');
  const [logMessages, setLogMessages] = useState<string[]>([]);
  
  // 自定义动作 JSON
  const [customActions, setCustomActions] = useState<HandAction[] | null>(null);
  
  // Refs
  const portRef = useRef<SerialPort | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const testAbortRef = useRef(false);
  const deviceId = 1;
  
  // 日志
  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogMessages(prev => {
      const next = [...prev, `[${time}] ${msg}`];
      return next.length > 50 ? next.slice(-50) : next;
    });
  }, []);
  
  // 发送数据包
  const sendPacket = useCallback(async (packet: Uint8Array): Promise<boolean> => {
    if (!writerRef.current) return false;
    try {
      await writerRef.current.write(packet);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`发送失败: ${msg}`);
      return false;
    }
  }, [addLog]);
  
  // 读取响应（带超时）
  const readResponse = useCallback(async (timeoutMs: number = 500): Promise<Uint8Array | null> => {
    if (!readerRef.current) return null;
    try {
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
      const readPromise = readerRef.current.read().then(({ value }) => value || null);
      return await Promise.race([readPromise, timeoutPromise]);
    } catch {
      return null;
    }
  }, []);
  
  // 连接机械手
  const handleConnect = useCallback(async () => {
    if (!('serial' in navigator)) {
      setErrorMsg('浏览器不支持 Web Serial API');
      return;
    }
    
    setIsConnecting(true);
    setErrorMsg('');
    addLog('正在选择串口设备...');
    
    try {
      const port = await navigator.serial.requestPort();
      await port.open({
        baudRate: 460800,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      });
      
      portRef.current = port;
      writerRef.current = port.writable!.getWriter();
      readerRef.current = port.readable!.getReader();
      
      addLog('串口已连接 (460800 baud)');
      
      // 发送使能命令
      addLog('发送使能命令...');
      const enablePkt = buildEnablePacket(deviceId);
      const sent = await sendPacket(enablePkt);
      if (sent) {
        const resp = await readResponse(1000);
        if (resp && resp.length >= 7) {
          addLog(`使能成功 (响应: ${Array.from(resp).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')})`);
        } else {
          addLog('使能命令已发送（未收到明确响应，继续操作）');
        }
      }
      
      setIsConnected(true);
      toast.success('机械手已连接并使能');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`连接失败: ${msg}`);
      addLog(`连接失败: ${msg}`);
    } finally {
      setIsConnecting(false);
    }
  }, [addLog, sendPacket, readResponse]);
  
  // 断开连接
  const handleDisconnect = useCallback(async () => {
    try {
      // 发送失能命令
      if (writerRef.current) {
        addLog('发送失能命令...');
        const disablePkt = buildDisablePacket(deviceId);
        await sendPacket(disablePkt);
        await new Promise(r => setTimeout(r, 200));
      }
      
      if (readerRef.current) {
        await readerRef.current.cancel().catch(() => {});
        readerRef.current = null;
      }
      if (writerRef.current) {
        await writerRef.current.close().catch(() => {});
        writerRef.current = null;
      }
      if (portRef.current) {
        await portRef.current.close().catch(() => {});
        portRef.current = null;
      }
      
      setIsConnected(false);
      addLog('已断开连接');
      toast.info('机械手已断开');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`断开失败: ${msg}`);
    }
  }, [addLog, sendPacket]);
  
  // 执行单个动作
  const executeAction = useCallback(async (actionName: string): Promise<boolean> => {
    const actions = customActions || PRESET_ACTIONS;
    const action = actions.find(a => a.name === actionName);
    if (!action) {
      addLog(`未知动作: ${actionName}`);
      return false;
    }
    
    setCurrentAction(actionName);
    const pkt = buildSetPositionsPacket(deviceId, action.positions);
    const sent = await sendPacket(pkt);
    if (sent) {
      addLog(`执行动作: ${actionName}`);
    }
    return sent;
  }, [customActions, addLog, sendPacket]);
  
  // 延迟函数（可中断）
  const delay = useCallback((ms: number): Promise<void> => {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      // 检查是否需要中断
      const checkAbort = setInterval(() => {
        if (testAbortRef.current) {
          clearTimeout(timer);
          clearInterval(checkAbort);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkAbort);
      }, ms + 100);
    });
  }, []);
  
  // 开始循环测试
  const handleStartTest = useCallback(async () => {
    if (!isConnected) {
      toast.error('请先连接机械手');
      return;
    }
    
    testAbortRef.current = false;
    setIsTesting(true);
    setCurrentCycle(0);
    setCurrentAction('');
    
    const config: OmniHandTestConfig = {
      cycleCount: totalCycles,
      intervalMs,
      holdAction: 'hold',
      releaseAction: 'release2',
    };
    onTestStart?.(config);
    addLog(`开始循环测试: ${totalCycles} 次, 间隔 ${intervalMs}ms`);
    
    try {
      for (let i = 0; i < totalCycles; i++) {
        if (testAbortRef.current) {
          addLog(`测试已在第 ${i} 次循环时停止`);
          break;
        }
        
        setCurrentCycle(i + 1);
        
        // hold
        await executeAction('hold');
        await delay(intervalMs);
        if (testAbortRef.current) break;
        
        // release2
        await executeAction('release2');
        await delay(intervalMs);
        
        onCycleComplete?.(i + 1, totalCycles);
        
        if ((i + 1) % 10 === 0 || i === totalCycles - 1) {
          addLog(`已完成 ${i + 1}/${totalCycles} 次循环`);
        }
      }
      
      if (!testAbortRef.current) {
        addLog(`循环测试完成: 共 ${totalCycles} 次`);
        toast.success(`机械手循环测试完成 (${totalCycles} 次)`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`测试异常: ${msg}`);
      toast.error(`测试异常: ${msg}`);
    } finally {
      setIsTesting(false);
      setCurrentAction('');
      onTestStop?.();
    }
  }, [isConnected, totalCycles, intervalMs, onTestStart, onTestStop, onCycleComplete, addLog, executeAction, delay]);
  
  // 停止测试
  const handleStopTest = useCallback(() => {
    testAbortRef.current = true;
    addLog('正在停止测试...');
  }, [addLog]);
  
  // 手动执行单个动作
  const handleManualAction = useCallback(async (actionName: string) => {
    if (!isConnected) {
      toast.error('请先连接机械手');
      return;
    }
    await executeAction(actionName);
  }, [isConnected, executeAction]);
  
  // 加载自定义 JSON
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
        
        const actions: HandAction[] = data.map((item) => {
          const positions: number[] = [];
          for (let i = 1; i <= 10; i++) {
            const key = `pos_axis_${i}`;
            positions.push(typeof item[key] === 'number' ? (item[key] as number) : 0);
          }
          return { name: String(item.name || 'unknown'), positions };
        });
        
        setCustomActions(actions);
        addLog(`已加载自定义动作: ${actions.map(a => a.name).join(', ')}`);
        toast.success(`已加载 ${actions.length} 个自定义动作`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`JSON 解析失败: ${msg}`);
        addLog(`JSON 解析失败: ${msg}`);
      }
    };
    input.click();
  }, [addLog]);
  
  // 清理
  useEffect(() => {
    return () => {
      testAbortRef.current = true;
    };
  }, []);
  
  const progress = totalCycles > 0 ? (currentCycle / totalCycles) * 100 : 0;
  const availableActions = customActions || PRESET_ACTIONS;
  
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'oklch(0.15 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid oklch(0.22 0.03 265)' }}>
        <div className="flex items-center gap-2">
          <Hand size={14} style={{ color: 'oklch(0.75 0.15 180)' }} />
          <span className="text-xs font-mono font-semibold" style={{ color: 'oklch(0.75 0.15 180)' }}>
            灵巧手控制
          </span>
          {isConnected && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'oklch(0.75 0.18 150)' }} />
              <span style={{ color: 'oklch(0.55 0.02 240)', fontSize: '9px', fontFamily: "'IBM Plex Mono', monospace" }}>
                已连接
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* 加载 JSON */}
          <button
            onClick={handleLoadJSON}
            disabled={isTesting}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors disabled:opacity-40"
            style={{
              background: 'oklch(0.20 0.025 265)',
              border: '1px solid oklch(0.28 0.03 265)',
              color: 'oklch(0.60 0.02 240)',
              fontSize: '9px',
            }}
            title="加载自定义动作 JSON 文件"
          >
            <Upload size={10} />
            <span>JSON</span>
          </button>
          {/* 连接/断开 */}
          {isConnected ? (
            <button
              onClick={handleDisconnect}
              disabled={isTesting}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors disabled:opacity-40"
              style={{
                background: 'oklch(0.65 0.22 25 / 0.12)',
                border: '1px solid oklch(0.65 0.22 25 / 0.3)',
                color: 'oklch(0.65 0.22 25)',
                fontSize: '9px',
              }}
            >
              <Usb size={10} />
              <span>断开</span>
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={isConnecting}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors disabled:opacity-40"
              style={{
                background: 'oklch(0.75 0.15 180 / 0.12)',
                border: '1px solid oklch(0.75 0.15 180 / 0.3)',
                color: 'oklch(0.75 0.15 180)',
                fontSize: '9px',
              }}
            >
              <Usb size={10} />
              <span>{isConnecting ? '连接中...' : '连接 (460800)'}</span>
            </button>
          )}
        </div>
      </div>
      
      {/* 错误提示 */}
      {errorMsg && (
        <div className="flex items-start gap-2 px-4 py-2 text-xs" style={{ background: 'oklch(0.65 0.22 25 / 0.08)' }}>
          <AlertCircle size={12} style={{ color: 'oklch(0.65 0.22 25)', flexShrink: 0, marginTop: '1px' }} />
          <span style={{ color: 'oklch(0.65 0.22 25)', fontSize: '10px' }}>{errorMsg}</span>
        </div>
      )}
      
      <div className="px-4 py-3 space-y-3">
        {/* 循环参数 */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-mono mb-1" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px' }}>
              循环次数
            </label>
            <input
              type="number"
              min={1}
              max={100000}
              value={totalCycles}
              onChange={(e) => setTotalCycles(Math.max(1, parseInt(e.target.value) || 1))}
              disabled={isTesting}
              className="w-full px-2 py-1.5 rounded text-xs font-mono disabled:opacity-40"
              style={{
                background: 'oklch(0.12 0.025 265)',
                border: '1px solid oklch(0.28 0.03 265)',
                color: 'oklch(0.82 0.01 220)',
                fontSize: '11px',
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-mono mb-1" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px' }}>
              动作间隔 (ms)
            </label>
            <input
              type="number"
              min={500}
              max={10000}
              step={100}
              value={intervalMs}
              onChange={(e) => setIntervalMs(Math.max(500, parseInt(e.target.value) || 2000))}
              disabled={isTesting}
              className="w-full px-2 py-1.5 rounded text-xs font-mono disabled:opacity-40"
              style={{
                background: 'oklch(0.12 0.025 265)',
                border: '1px solid oklch(0.28 0.03 265)',
                color: 'oklch(0.82 0.01 220)',
                fontSize: '11px',
              }}
            />
          </div>
        </div>
        
        {/* 手动动作按钮 */}
        <div>
          <div className="text-xs font-mono mb-1.5" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px' }}>
            手动执行 {customActions ? '(自定义)' : '(预设)'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {availableActions.map((action) => (
              <button
                key={action.name}
                onClick={() => handleManualAction(action.name)}
                disabled={!isConnected || isTesting}
                className="px-2.5 py-1 rounded text-xs font-mono transition-colors disabled:opacity-30"
                style={{
                  background: currentAction === action.name
                    ? 'oklch(0.75 0.15 180 / 0.2)'
                    : 'oklch(0.20 0.025 265)',
                  border: `1px solid ${currentAction === action.name ? 'oklch(0.75 0.15 180 / 0.4)' : 'oklch(0.28 0.03 265)'}`,
                  color: currentAction === action.name
                    ? 'oklch(0.75 0.15 180)'
                    : 'oklch(0.60 0.02 240)',
                  fontSize: '10px',
                }}
              >
                {action.name}
              </button>
            ))}
          </div>
        </div>
        
        {/* 开始/停止按钮 */}
        <div className="flex gap-2">
          {!isTesting ? (
            <button
              onClick={handleStartTest}
              disabled={!isConnected}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-mono font-semibold transition-colors disabled:opacity-30"
              style={{
                background: isConnected ? 'oklch(0.75 0.15 180 / 0.15)' : 'oklch(0.20 0.025 265)',
                border: `1px solid ${isConnected ? 'oklch(0.75 0.15 180 / 0.3)' : 'oklch(0.28 0.03 265)'}`,
                color: isConnected ? 'oklch(0.75 0.15 180)' : 'oklch(0.45 0.02 240)',
              }}
            >
              <Play size={12} />
              <span>开始循环 ({totalCycles} 次)</span>
            </button>
          ) : (
            <button
              onClick={handleStopTest}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-mono font-semibold transition-colors"
              style={{
                background: 'oklch(0.65 0.22 25 / 0.15)',
                border: '1px solid oklch(0.65 0.22 25 / 0.3)',
                color: 'oklch(0.65 0.22 25)',
              }}
            >
              <Square size={12} />
              <span>停止测试</span>
            </button>
          )}
          <button
            onClick={() => { setLogMessages([]); setCurrentCycle(0); }}
            disabled={isTesting}
            className="px-3 py-2 rounded text-xs font-mono transition-colors disabled:opacity-30"
            style={{
              background: 'oklch(0.20 0.025 265)',
              border: '1px solid oklch(0.28 0.03 265)',
              color: 'oklch(0.60 0.02 240)',
            }}
            title="清除日志"
          >
            <RotateCcw size={12} />
          </button>
        </div>
        
        {/* 进度条 */}
        {(isTesting || currentCycle > 0) && (
          <div>
            <div className="flex justify-between text-xs font-mono mb-1" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px' }}>
              <span>
                {isTesting ? `正在执行: ${currentAction || '...'}` : '已完成'}
              </span>
              <span>{currentCycle} / {totalCycles}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'oklch(0.20 0.025 265)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progress}%`,
                  background: isTesting
                    ? 'oklch(0.75 0.15 180)'
                    : 'oklch(0.75 0.18 150)',
                }}
              />
            </div>
          </div>
        )}
        
        {/* 日志面板 */}
        {logMessages.length > 0 && (
          <div
            className="rounded overflow-y-auto font-mono"
            style={{
              background: 'oklch(0.10 0.02 265)',
              border: '1px solid oklch(0.22 0.03 265)',
              maxHeight: '120px',
              fontSize: '9px',
              padding: '6px 8px',
            }}
          >
            {logMessages.map((msg, i) => (
              <div
                key={i}
                style={{
                  color: msg.includes('失败') || msg.includes('错误') || msg.includes('异常')
                    ? 'oklch(0.65 0.22 25)'
                    : msg.includes('成功') || msg.includes('完成')
                    ? 'oklch(0.75 0.18 150)'
                    : 'oklch(0.50 0.02 240)',
                  lineHeight: '1.6',
                }}
              >
                {msg}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
