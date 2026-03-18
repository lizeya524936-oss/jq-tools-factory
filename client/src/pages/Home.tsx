/**
 * Home - 主页面
 * JQ Tools Factory 产品出厂检测工具 v1.4
 * 设计风格：精密科学仪器，深色主题，IBM Plex字体
 *
 * 设备连接（第四版需求）：
 * - 串口1：力学检测设备（CL2-500N-MH01），波特率可自定义
 * - 串口2：被测传感器产品（织物触觉传感器），波特率可自定义
 * - 使用 Web Serial API 实现真实硬件连接
 */
import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import Sidebar, { TabType } from '@/components/Sidebar';
import TestPage from './TestPage';
import ConsistencyPage from './ConsistencyPage';
import RepeatabilityPage from './RepeatabilityPage';
import DurabilityPage from './DurabilityPage';
import DataLogPage from './DataLogPage';
import AboutPage from './AboutPage';
import SerialConnectPanel from '@/components/SerialConnectPanel';
import { useSerialPort, isWebSerialSupported } from '@/hooks/useSerialPort';
import { getRealtimeDataPipeline } from '@/lib/realtimeDataPipeline';
import { Activity } from 'lucide-react';
import { toast } from 'sonner';
import { APP_VERSION } from '@/version';

// 全局串口数据上下文，供子页面消费
export interface SerialDataContext {
  latestForceN: number | null;
  /** 二维矩阵 matrixData[row][col] = 0~255，帧头AA 55 03 09解析后的精确坐标映射 */
  latestSensorMatrix: number[][] | null;
  /** 一维展开（行优先），兼容旧接口 */
  latestAdcValues: number[] | null;
  latestRawFrame: string | null;     // 原始串口帧字符串
  isForceConnected: boolean;
  isSensorConnected: boolean;
  /** 传感器设备类型，如 'LH'/'RH'/'LF'/'RF'/'WB'，未识别时为 null */
  sensorDeviceType: string | null;
  latestAdcValuesRef?: React.MutableRefObject<number[] | null>; // Ref 中的最新数据
  /** 向力学仪器发送命令（如 CMD_RESET 归零指令） */
  sendForceCommand?: (data: Uint8Array) => Promise<boolean>;
}

export const SerialCtx = createContext<SerialDataContext>({
  latestForceN: null,
  latestSensorMatrix: null,
  latestAdcValues: null,
  latestRawFrame: null,
  isForceConnected: false,
  isSensorConnected: false,
  sensorDeviceType: null,
  sendForceCommand: async () => false,
});

export function useSerialData() {
  return useContext(SerialCtx);
}

const tabTitles: Record<TabType, { title: string; subtitle: string }> = {
  test: {
    title: '测试页',
    subtitle: '设备连接状态 · 传感器数据实时监控 · 力学仪器数据显示',
  },
  consistency: {
    title: '一致性检测',
    subtitle: '手动垂直下压机 · 检测方法A · 多产品均值曲线 · 误差阈值可定义',
  },
  repeatability: {
    title: '重复性检测',
    subtitle: 'PLC可编程垂直下压机 · 检测方法B · 间隔采样 · 误差阈值可定义',
  },
  durability: {
    title: '耐久性检测',
    subtitle: '机器人灵巧手套 · 反复抓握特定物体 · 验证ADC有效性和灵敏度变化',
  },
  data: {
    title: '数据记录',
    subtitle: 'CSV格式导出 · Time, Pressure, ADC Value, ADC Sum',
  },
  about: {
    title: '关于',
    subtitle: 'JQ Tools Factory v1.4 · 矩侨工业产品出厂检测工具',
  },
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>('consistency');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [latestForceN, setLatestForceN] = useState<number | null>(null);
  const [latestSensorMatrix, setLatestSensorMatrix] = useState<number[][] | null>(null);
  const [latestAdcValues, setLatestAdcValues] = useState<number[] | null>(null);
  const [latestRawFrame, setLatestRawFrame] = useState<string | null>(null);
  const [sensorDeviceType, setSensorDeviceType] = useState<string | null>(null);
  
  // 使用 Ref 来存储最新的传感器数据，避免不必要的重新渲染
  const latestAdcValuesRef = useRef<number[] | null>(null);
  
  // 节流定时器：将高频数据更新批量合并为低频 UI 更新
  // 这是解决主线程阻塞的核心：高频数据只写入全局单例（零开销），UI每100ms批量更新一次
  const uiUpdateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingForceRef = useRef<number | null>(null);
  const pendingMatrixRef = useRef<number[][] | null>(null);
  const pendingAdcRef = useRef<number[] | null>(null);
  const pendingRawRef = useRef<string | null>(null);
  const hasPendingUpdate = useRef(false);

  // 实时时钟
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  
  // UI 批量更新定时器：每100ms检查一次是否有待更新的数据
  useEffect(() => {
    uiUpdateTimerRef.current = setInterval(() => {
      if (!hasPendingUpdate.current) return;
      hasPendingUpdate.current = false;
      
      // 批量更新所有 React State（React 18 会自动批量处理）
      if (pendingForceRef.current !== null) {
        setLatestForceN(pendingForceRef.current);
      }
      if (pendingMatrixRef.current !== null) {
        setLatestSensorMatrix(pendingMatrixRef.current);
      }
      if (pendingAdcRef.current !== null) {
        setLatestAdcValues(pendingAdcRef.current);
      }
      if (pendingRawRef.current !== null) {
        setLatestRawFrame(pendingRawRef.current);
        pendingRawRef.current = null;
      }
    }, 100); // 100ms UI刷新率，人眼无感知，但大幅减少主线程占用
    
    return () => {
      if (uiUpdateTimerRef.current) {
        clearInterval(uiUpdateTimerRef.current);
      }
    };
  }, []);

  // 力学仪器串口
  const forceSerial = useSerialPort({
    role: 'force',
    onForceData: useCallback((n: number) => {
      // 立即写入全局单例（零开销，采集时直接读取）
      getRealtimeDataPipeline().updateForceData(n);
      // 暂存到 Ref，等待批量 UI 更新（不触发 React 重渲染）
      pendingForceRef.current = n;
      hasPendingUpdate.current = true;
    }, []),
  });

  // 传感器串口
  const sensorSerial = useSerialPort({
    role: 'sensor',
    onDeviceType: useCallback((deviceType: string, _deviceId: number) => {
      setSensorDeviceType(deviceType);
    }, []),
    onData: useCallback((raw: string) => {
      // 暂存到 Ref，等待批量 UI 更新
      pendingRawRef.current = raw.trim();
      hasPendingUpdate.current = true;
    }, []),
    onSensorMatrix: useCallback((matrix: number[][], _rows: number, _cols: number) => {
      // 立即写入全局单例（零开销，采集时直接读取）
      getRealtimeDataPipeline().updateSensorData(matrix);
      const flatValues = matrix.flat();
      latestAdcValuesRef.current = flatValues;
      // 暂存到 Ref，等待批量 UI 更新（不触发 React 重渲染）
      pendingMatrixRef.current = matrix;
      pendingAdcRef.current = flatValues;
      hasPendingUpdate.current = true;
    }, []),
    onSensorData: useCallback((values: number[]) => {
      // 立即写入全局单例
      getRealtimeDataPipeline().updateAdcData(values);
      latestAdcValuesRef.current = values;
      pendingAdcRef.current = values;
      hasPendingUpdate.current = true;
    }, [])
  });

  const handleForceConnect = useCallback(async (baudRate: number) => {
    const ok = await forceSerial.connect(baudRate);
    if (ok) toast.success(`力学仪器已连接，波特率 ${baudRate.toLocaleString()}`);
    return ok;
  }, [forceSerial]);

  const handleSensorConnect = useCallback(async (baudRate: number) => {
    const ok = await sensorSerial.connect(baudRate);
    if (ok) toast.success(`传感器已连接，波特率 ${baudRate.toLocaleString()}`);
    return ok;
  }, [sensorSerial]);

  // 传感器断开时清除设备类型
  const handleSensorDisconnect = useCallback(async () => {
    await sensorSerial.disconnect();
    setSensorDeviceType(null);
  }, [sensorSerial]);

  const isForceConnected = forceSerial.state.status === 'connected';
  const isSensorConnected = sensorSerial.state.status === 'connected';
  const bothConnected = isForceConnected && isSensorConnected;
  const anyConnected = isForceConnected || isSensorConnected;
  const webSerialSupported = isWebSerialSupported();

  const current = tabTitles[activeTab];
  
  // 使用 Ref 中的数据，或者使用 State 中的数据
  const effectiveAdcValues = latestAdcValuesRef.current || latestAdcValues;

  return (
    <SerialCtx.Provider value={{ latestForceN, latestSensorMatrix, latestAdcValues: effectiveAdcValues, latestRawFrame, isForceConnected, isSensorConnected, sensorDeviceType, latestAdcValuesRef, sendForceCommand: forceSerial.sendCommand }}>
      <div
        className="flex flex-col h-screen overflow-hidden"
        style={{ background: 'oklch(0.13 0.02 265)', fontFamily: "'IBM Plex Sans', sans-serif" }}
      >
        {/* 顶部标题栏 */}
        <header
          className="flex items-center justify-between px-4 flex-shrink-0"
          style={{
            background: 'oklch(0.15 0.025 265)',
            borderBottom: '1px solid oklch(0.22 0.03 265)',
            height: '48px',
          }}
        >
          {/* 左侧：品牌 + 页面标题 */}
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-2 pr-3"
              style={{ borderRight: '1px solid oklch(0.22 0.03 265)' }}
            >
              <div
                className="w-6 h-6 rounded flex items-center justify-center"
                style={{
                  background: 'oklch(0.58 0.22 265 / 0.2)',
                  border: '1px solid oklch(0.58 0.22 265 / 0.4)',
                }}
              >
                <Activity size={12} style={{ color: 'oklch(0.70 0.18 200)' }} />
              </div>
              <span
                className="text-xs font-mono font-semibold"
                style={{ color: 'oklch(0.75 0.01 220)', letterSpacing: '0.05em' }}
              >
                JQ TOOLS FACTORY
              </span>
            </div>
            <div>
              <h1
                className="text-sm font-semibold leading-tight"
                style={{ color: 'oklch(0.92 0.01 220)' }}
              >
                {current.title}
              </h1>
              <p
                className="leading-tight font-mono"
                style={{ color: 'oklch(0.48 0.02 240)', fontSize: '10px' }}
              >
                {current.subtitle}
              </p>
            </div>
          </div>

          {/* 右侧：两个串口连接面板 */}
          <div className="flex items-center gap-2">
            {/* 力学仪器串口 */}
            <SerialConnectPanel
              role="force"
              state={forceSerial.state}
              onConnect={handleForceConnect}
              onDisconnect={forceSerial.disconnect}
            />

            {/* 分隔 */}
            <div className="w-px h-4" style={{ background: 'oklch(0.25 0.03 265)' }} />

            {/* 传感器串口 */}
            <SerialConnectPanel
              role="sensor"
              state={sensorSerial.state}
              onConnect={handleSensorConnect}
              onDisconnect={handleSensorDisconnect}
              deviceType={sensorDeviceType}
            />

            {/* 分隔 */}
            <div className="w-px h-4" style={{ background: 'oklch(0.25 0.03 265)' }} />

            {/* 实时数据预览 */}
            {(isForceConnected || isSensorConnected) && (
              <>
                <div className="flex items-center gap-2 px-2">
                  {isForceConnected && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '10px' }}>F:</span>
                      <span className="text-xs font-mono font-medium" style={{ color: 'oklch(0.70 0.18 200)', fontSize: '10px' }}>
                        {latestForceN !== null ? `${latestForceN.toFixed(2)}N` : '--'}
                      </span>
                    </div>
                  )}
                  {isSensorConnected && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '10px' }}>ADC:</span>
                      <span className="text-xs font-mono font-medium" style={{ color: 'oklch(0.72 0.20 145)', fontSize: '10px', minWidth: '40px', textAlign: 'right' }}>
                        {latestAdcValues !== null
                          ? String(latestAdcValues.reduce((a, b) => a + b, 0)).padStart(5, ' ')
                          : '    --'}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* 连接状态指示 */}
            <div className="flex items-center gap-1.5">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: bothConnected
                    ? 'oklch(0.72 0.20 145)'
                    : anyConnected
                    ? 'oklch(0.75 0.18 55)'
                    : webSerialSupported
                    ? 'oklch(0.40 0.02 240)'
                    : 'oklch(0.65 0.22 25)',
                  boxShadow: bothConnected ? '0 0 6px oklch(0.72 0.20 145 / 0.6)' : 'none',
                }}
              />
              <span
                className="text-xs font-mono"
                style={{
                  color: bothConnected
                    ? 'oklch(0.72 0.20 145)'
                    : anyConnected
                    ? 'oklch(0.75 0.18 55)'
                    : webSerialSupported
                    ? 'oklch(0.40 0.02 240)'
                    : 'oklch(0.65 0.22 25)',
                  fontSize: '10px',
                }}
              >
                {bothConnected
                  ? '就绪'
                  : anyConnected
                  ? '部分连接'
                  : webSerialSupported
                  ? '模拟模式'
                  : '不支持串口'}
              </span>
            </div>

            {/* 分隔 */}
            <div className="w-px h-4" style={{ background: 'oklch(0.25 0.03 265)' }} />

            {/* 时钟 */}
            <span className="text-xs font-mono" style={{ color: 'oklch(0.42 0.02 240)', fontSize: '10px' }}>
              {currentTime.toLocaleTimeString('zh-CN', { hour12: false })}
            </span>
          </div>
        </header>

        {/* 主体区域 */}
        <div className="flex flex-1 min-h-0">
          <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
          <main className="flex-1 min-w-0 overflow-auto">
            {activeTab === 'test' && <TestPage />}
            {activeTab === 'consistency' && <ConsistencyPage />}
            {activeTab === 'repeatability' && <RepeatabilityPage />}
            {activeTab === 'durability' && <DurabilityPage />}
            {activeTab === 'data' && <DataLogPage />}
            {activeTab === 'about' && <AboutPage />}
          </main>
        </div>

        {/* 底部状态栏 */}
        <footer
          className="flex items-center justify-between px-4 flex-shrink-0"
          style={{
            height: '24px',
            background: 'oklch(0.12 0.02 265)',
            borderTop: '1px solid oklch(0.20 0.025 265)',
          }}
        >
          <div className="flex items-center gap-3">
            <span style={{ color: 'oklch(0.40 0.02 240)', fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" }}>
              JQ Tools Factory {APP_VERSION}
            </span>
            <span style={{ color: 'oklch(0.28 0.02 240)', fontSize: '10px' }}>|</span>
            <span style={{ color: 'oklch(0.38 0.02 240)', fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" }}>
              矩侨工业 · 织物触觉传感器检测平台
            </span>
            {!webSerialSupported && (
              <>
                <span style={{ color: 'oklch(0.28 0.02 240)', fontSize: '10px' }}>|</span>
                <span style={{ color: 'oklch(0.65 0.22 25)', fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" }}>
                  ⚠ 请使用 Chrome/Edge 89+ 以启用串口连接
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span style={{ color: 'oklch(0.38 0.02 240)', fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" }}>
              力学: {isForceConnected ? `${forceSerial.state.portInfo} @ ${forceSerial.state.baudRate}` : '未连接'}
            </span>
            <span style={{ color: 'oklch(0.28 0.02 240)', fontSize: '10px' }}>|</span>
            <span style={{ color: 'oklch(0.38 0.02 240)', fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" }}>
              传感器: {isSensorConnected ? `${sensorSerial.state.portInfo} @ ${sensorSerial.state.baudRate}${sensorDeviceType ? ` · ${sensorDeviceType}` : ''}` : '未连接'}
            </span>
            <span style={{ color: 'oklch(0.28 0.02 240)', fontSize: '10px' }}>|</span>
            <span style={{ color: 'oklch(0.38 0.02 240)', fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" }}>
              {currentTime.toLocaleString('zh-CN', { hour12: false })}
            </span>
          </div>
        </footer>
      </div>
    </SerialCtx.Provider>
  );
}
