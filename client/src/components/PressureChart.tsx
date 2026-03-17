/**
 * PressureChart - 压力数据实时图表组件
 * 使用 Web Serial API 和 SerialDriver 实现低频采集压力计的数据采集和可视化
 * 绘制方式：采用一致性页面的绿化曲线方式（Recharts ComposedChart + Area + Line）
 * 颜色方案：橙黄主题 + 深色背景，与整体软件风格协调
 * 
 * 性能优化：数据回调只写入 Ref 缓冲区（零 React 开销），
 * UI 通过 200ms 定时器批量刷新，避免高频 setState 阻塞主线程
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { RotateCcw, Usb, AlertCircle } from 'lucide-react';
import { getSerialDriver, PressureData } from '@/lib/serialDriver';
import { getRealtimeDataPipeline } from '@/lib/realtimeDataPipeline';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
} from 'recharts';

interface ChartDataPoint {
  index: number;
  pressure: number;
  time: string;
}

const MAX_CHART_POINTS = 200;

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0]?.payload as ChartDataPoint;
    return (
      <div
        className="rounded p-2.5"
        style={{
          background: 'oklch(0.17 0.025 265)',
          border: '1px solid oklch(0.35 0.04 265)',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: '11px',
          boxShadow: '0 4px 12px oklch(0 0 0 / 0.4)',
        }}
      >
        <div style={{ color: 'oklch(0.55 0.02 240)', marginBottom: '4px', fontSize: '10px' }}>
          样本 #{data?.index} · {data?.time}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: 'oklch(0.75 0.18 55)' }}>压力:</span>
            <span style={{ color: 'oklch(0.75 0.18 55)', fontWeight: 600 }}>{data?.pressure.toFixed(2)} N</span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

interface PressureChartProps {
  showControls?: boolean;
}

export default function PressureChart({ showControls = true }: PressureChartProps) {
  const serialDriver = getSerialDriver();
  const [pressureData, setPressureData] = useState<ChartDataPoint[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  
  // 统计信息状态
  const [collectionStartTime, setCollectionStartTime] = useState<number | null>(null);
  const [totalDataPoints, setTotalDataPoints] = useState(0);
  const [collectionRate, setCollectionRate] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);

  // ===== 性能优化核心：数据缓冲区 =====
  // 串口回调只写入这些 Ref（零 React 开销），不触发任何 setState
  const pendingPointsRef = useRef<ChartDataPoint[]>([]);

  // 初始化全局SerialDriver的回调
  useEffect(() => {
    // 设置数据回调 - 只写入 Ref，不调用任何 setState
    serialDriver.setDataCallback((data: PressureData) => {
      // globalDataPointCount 和 globalCollectionStartTime 已在 SerialDriver.onData 中自动更新
      // 同时写入 RealtimeDataPipeline 全局单例（供采集逻辑读取）
      getRealtimeDataPipeline().updateForceData(data.value);
      
      // 只写入缓冲区 Ref，不触发 React 重渲染
      pendingPointsRef.current.push({
        index: 0, // 后续批量更新时重新计算
        pressure: data.value,
        time: new Date().toLocaleTimeString('zh-CN'),
      });
    });

    // 设置错误回调
    serialDriver.setErrorCallback((error: string) => {
      setErrorMsg(error);
      setIsConnected(false);
      setIsConnecting(false);
    });

    // 设置状态回调
    serialDriver.setStatusCallback((status: string) => {
      setStatusMsg(status);
    });

    // 更新连接状态（组件挂载时从全局单例恢复）
    const connected = serialDriver.getIsConnected();
    setIsConnected(connected);
    
    // 如果已连接，从全局单例恢复统计数据（解决切换页面后数据丢失的 bug）
    if (connected) {
      const globalCount = serialDriver.getGlobalDataPointCount();
      const globalStartTime = serialDriver.getGlobalCollectionStartTime();
      setTotalDataPoints(globalCount);
      setCollectionStartTime(globalStartTime);
      if (globalStartTime && globalCount > 0) {
        const elapsed = (Date.now() - globalStartTime) / 1000;
        setCollectionRate(Math.round((globalCount / elapsed) * 10) / 10);
        setElapsedTime(Math.floor(elapsed));
      }
    }
  }, [serialDriver]);

  // ===== UI 批量刷新定时器：每 200ms 将缓冲区数据刷入 React State =====
  useEffect(() => {
    const timer = setInterval(() => {
      // 1. 刷新图表数据
      const pending = pendingPointsRef.current;
      if (pending.length > 0) {
        pendingPointsRef.current = []; // 清空缓冲区
        
        setPressureData(prev => {
          const combined = [...prev, ...pending];
          // 只保留最新的 MAX_CHART_POINTS 个点
          const truncated = combined.length > MAX_CHART_POINTS 
            ? combined.slice(-MAX_CHART_POINTS) 
            : combined;
          // 重新计算 index
          return truncated.map((item, idx) => ({ ...item, index: idx + 1 }));
        });
      }
      
      // 2. 从全局单例读取统计信息（不依赖局部 Ref，切换页面后仍能正确显示）
      const globalCount = serialDriver.getGlobalDataPointCount();
      const globalStartTime = serialDriver.getGlobalCollectionStartTime();
      
      if (globalCount > 0) {
        setTotalDataPoints(globalCount);
      }
      
      if (globalStartTime && globalCount > 0) {
        const elapsed = (Date.now() - globalStartTime) / 1000;
        setCollectionRate(Math.round((globalCount / elapsed) * 10) / 10);
        setElapsedTime(Math.floor(elapsed));
      }
    }, 200); // 200ms = 5fps UI 刷新，足够流畅且不阻塞主线程
    
    return () => clearInterval(timer);
  }, [serialDriver]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    setErrorMsg('');
    
    const success = await serialDriver.connect({ baudRate: 19200 });
    
    if (success) {
      setIsConnected(true);
      setPressureData([]);
      pendingPointsRef.current = [];
      // 全局统计数据已在 serialDriver.connect() 内部重置，无需在此重置
      setCollectionStartTime(serialDriver.getGlobalCollectionStartTime());
      setTotalDataPoints(0);
      setCollectionRate(0);
      setElapsedTime(0);
    }
    
    setIsConnecting(false);
  }, [serialDriver]);

  const handleDisconnect = useCallback(async () => {
    await serialDriver.disconnect();
    setIsConnected(false);
    setStatusMsg('');
    setCollectionStartTime(null);
  }, [serialDriver]);

  const handleReset = useCallback(async () => {
    await serialDriver.reset();
    // 重置全局统计数据（包括全局单例中的计数）
    serialDriver.resetGlobalStats();
    setPressureData([]);
    pendingPointsRef.current = [];
    const newStartTime = serialDriver.getGlobalCollectionStartTime();
    setCollectionStartTime(newStartTime);
    setTotalDataPoints(0);
    setCollectionRate(0);
    setElapsedTime(0);
  }, [serialDriver]);

  const isSupported = 'serial' in navigator;

  // 监听全局连接状态变化
  useEffect(() => {
    const checkConnectionStatus = () => {
      setIsConnected(serialDriver.getIsConnected());
    };
    
    const interval = setInterval(checkConnectionStatus, 1000);
    return () => clearInterval(interval);
  }, [serialDriver]);

  const hasData = pressureData.length > 0;
  
  // 格式化时间显示
  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  return (
    <div className="flex flex-col h-full gap-2">
      {/* 统计信息面板 */}
      {isConnected && hasData && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded p-2" style={{ background: 'oklch(0.20 0.025 265)', border: '1px solid oklch(0.28 0.03 265)' }}>
            <div style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px', marginBottom: '2px', fontFamily: "'IBM Plex Mono', monospace" }}>
              采集速率
            </div>
            <div style={{ color: 'oklch(0.75 0.18 55)', fontSize: '13px', fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
              {collectionRate} Hz
            </div>
          </div>
          
          <div className="rounded p-2" style={{ background: 'oklch(0.20 0.025 265)', border: '1px solid oklch(0.28 0.03 265)' }}>
            <div style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px', marginBottom: '2px', fontFamily: "'IBM Plex Mono', monospace" }}>
              数据点数
            </div>
            <div style={{ color: 'oklch(0.75 0.18 55)', fontSize: '13px', fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
              {totalDataPoints}
            </div>
          </div>
          
          <div className="rounded p-2" style={{ background: 'oklch(0.20 0.025 265)', border: '1px solid oklch(0.28 0.03 265)' }}>
            <div style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px', marginBottom: '2px', fontFamily: "'IBM Plex Mono', monospace" }}>
              采集时长
            </div>
            <div style={{ color: 'oklch(0.75 0.18 55)', fontSize: '13px', fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
              {formatTime(elapsedTime)}
            </div>
          </div>
        </div>
      )}
      
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-medium" style={{ color: 'oklch(0.75 0.18 55)' }}>
            压力数据可视化
          </span>
          {isConnected && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'oklch(0.75 0.18 55)' }} />
              <span style={{ color: 'oklch(0.75 0.18 55)', fontSize: '8px', fontFamily: "'IBM Plex Mono', monospace" }}>
                实时采集中
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(hasData || isConnected) && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors"
              style={{
                background: 'oklch(0.20 0.025 265)',
                border: '1px solid oklch(0.28 0.03 265)',
                color: 'oklch(0.60 0.02 240)',
                fontSize: '9px',
              }}
              title="重置图表数据和统计信息"
            >
              <RotateCcw size={10} />
              <span>重置</span>
            </button>
          )}

        </div>
      </div>

      {/* 错误提示 */}
      {errorMsg && (
        <div
          className="flex items-start gap-2 p-2 rounded text-xs"
          style={{ background: 'oklch(0.65 0.22 25 / 0.1)', border: '1px solid oklch(0.65 0.22 25 / 0.3)' }}
        >
          <AlertCircle size={12} style={{ color: 'oklch(0.65 0.22 25)', flexShrink: 0, marginTop: '1px' }} />
          <span style={{ color: 'oklch(0.65 0.22 25)' }}>{errorMsg}</span>
        </div>
      )}

      {/* 图表容器 */}
      {!hasData ? (
        <div className="flex-1 flex items-center justify-center rounded" style={{ background: 'oklch(0.15 0.025 265)', border: '1px dashed oklch(0.25 0.03 265)' }}>
          <div className="text-center">
            <div className="text-sm font-mono mb-1" style={{ color: 'oklch(0.45 0.02 240)' }}>
              {!isSupported ? '浏览器不支持 Web Serial API' : isConnecting ? '连接中...' : '等待数据'}
            </div>
            <div className="text-xs font-mono" style={{ color: 'oklch(0.35 0.02 240)' }}>
              {!isSupported ? '请使用 Chrome 89+ 或 Edge 89+' : isConnecting ? '正在连接设备...' : '请在右上角连接检测设备后开始采集'}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 rounded" style={{ background: 'oklch(0.14 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={pressureData} margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
              <defs>
                <linearGradient id="pressureGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.75 0.18 55)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="oklch(0.75 0.18 55)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="oklch(0.25 0.03 265)"
                strokeOpacity={0.6}
              />
              <XAxis
                dataKey="index"
                type="number"
                tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                label={{
                  value: '采样点',
                  position: 'insideBottom',
                  offset: -5,
                  fill: 'oklch(0.75 0.18 55)',
                  fontSize: 10,
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                label={{
                  value: '压力值 (N)',
                  angle: -90,
                  position: 'insideLeft',
                  fill: 'oklch(0.75 0.18 55)',
                  fontSize: 10,
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{
                  fontSize: '11px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: 'oklch(0.60 0.02 240)',
                  paddingTop: '10px',
                }}
                verticalAlign="top"
                height={36}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="pressure"
                name="压力值 (N)"
                stroke="oklch(0.75 0.18 55)"
                fill="url(#pressureGradient)"
                strokeWidth={2}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="pressure"
                name="压力值 (N)"
                stroke="oklch(0.75 0.18 55)"
                strokeWidth={2}
                dot={{ r: 2, fill: 'oklch(0.75 0.18 55)' }}
                activeDot={{ r: 5, fill: 'oklch(0.75 0.18 55)', stroke: 'oklch(0.85 0.10 55)', strokeWidth: 2 }}
                legendType="none"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 统计信息 */}
      {hasData && (
        <div className="grid grid-cols-3 gap-2 text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
          <div className="rounded p-2" style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}>
            <div style={{ color: 'oklch(0.45 0.02 240)', fontSize: '8px' }}>最大值</div>
            <div style={{ color: 'oklch(0.75 0.18 55)', fontSize: '12px', fontWeight: 600, marginTop: '2px' }}>
              {Math.max(...pressureData.map(d => d.pressure)).toFixed(2)} N
            </div>
          </div>
          <div className="rounded p-2" style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}>
            <div style={{ color: 'oklch(0.45 0.02 240)', fontSize: '8px' }}>平均值</div>
            <div style={{ color: 'oklch(0.70 0.18 200)', fontSize: '12px', fontWeight: 600, marginTop: '2px' }}>
              {(pressureData.reduce((a, b) => a + b.pressure, 0) / pressureData.length).toFixed(2)} N
            </div>
          </div>
          <div className="rounded p-2" style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}>
            <div style={{ color: 'oklch(0.45 0.02 240)', fontSize: '8px' }}>采样点</div>
            <div style={{ color: 'oklch(0.82 0.01 220)', fontSize: '12px', fontWeight: 600, marginTop: '2px' }}>
              {pressureData.length}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
