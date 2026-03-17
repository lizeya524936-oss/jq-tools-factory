/**
 * PressureChart - 压力数据实时图表组件
 * 数据来源：从 SerialCtx（Context）读取 latestForceN，由 Home.tsx 的 useSerialPort 提供
 * 绘制方式：Recharts ComposedChart + Area + Line
 * 颜色方案：橙黄主题 + 深色背景
 *
 * 性能优化：新数据通过 useEffect 写入 Ref 缓冲区，
 * UI 通过 200ms 定时器批量刷新，避免高频 setState 阻塞主线程
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { RotateCcw, AlertCircle } from 'lucide-react';
import { useSerialData } from '@/pages/Home';
import { getRealtimeDataPipeline } from '@/lib/realtimeDataPipeline';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${m.toString().padStart(2, '0')}m${s.toString().padStart(2, '0')}s`;
  if (m > 0) return `${m}m${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

export default function PressureChart() {
  // 从全局 Context 读取压力数据和连接状态（由 Home.tsx 的 useSerialPort 驱动）
  const { latestForceN, isForceConnected } = useSerialData();

  const [pressureData, setPressureData] = useState<ChartDataPoint[]>([]);
  const [errorMsg] = useState('');

  // 统计信息
  const [totalDataPoints, setTotalDataPoints] = useState(0);
  const [collectionRate, setCollectionRate] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);

  // 内部统计 Ref（不触发 React 重渲染）
  const dataPointCountRef = useRef(0);
  const collectionStartTimeRef = useRef<number | null>(null);

  // 数据缓冲区：新数据先写入此 Ref，200ms 定时器批量刷入 State
  const pendingPointsRef = useRef<ChartDataPoint[]>([]);

  // 监听 latestForceN 变化，写入缓冲区（不触发图表重渲染）
  useEffect(() => {
    if (latestForceN === null || !isForceConnected) return;

    // 初始化采集开始时间
    if (collectionStartTimeRef.current === null) {
      collectionStartTimeRef.current = Date.now();
    }

    dataPointCountRef.current += 1;

    // 同步写入全局单例（供采集逻辑读取）
    getRealtimeDataPipeline().updateForceData(latestForceN);

    // 写入缓冲区，等待批量刷新
    pendingPointsRef.current.push({
      index: 0,
      pressure: latestForceN,
      time: new Date().toLocaleTimeString('zh-CN'),
    });
  }, [latestForceN, isForceConnected]);

  // 连接断开时重置采集开始时间
  useEffect(() => {
    if (!isForceConnected) {
      collectionStartTimeRef.current = null;
    }
  }, [isForceConnected]);

  // ===== 200ms 批量刷新定时器 =====
  useEffect(() => {
    const timer = setInterval(() => {
      // 1. 刷新图表数据
      const pending = pendingPointsRef.current;
      if (pending.length > 0) {
        pendingPointsRef.current = [];
        setPressureData(prev => {
          const combined = [...prev, ...pending];
          const truncated = combined.length > MAX_CHART_POINTS
            ? combined.slice(-MAX_CHART_POINTS)
            : combined;
          return truncated.map((item, idx) => ({ ...item, index: idx + 1 }));
        });
      }

      // 2. 刷新统计信息
      const count = dataPointCountRef.current;
      const startTime = collectionStartTimeRef.current;
      if (count > 0) {
        setTotalDataPoints(count);
      }
      if (startTime && count > 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        setCollectionRate(Math.round((count / elapsed) * 10) / 10);
        setElapsedTime(Math.floor(elapsed));
      }
    }, 200);

    return () => clearInterval(timer);
  }, []);

  // 重置图表数据和统计
  const handleReset = useCallback(() => {
    setPressureData([]);
    pendingPointsRef.current = [];
    dataPointCountRef.current = 0;
    collectionStartTimeRef.current = isForceConnected ? Date.now() : null;
    setTotalDataPoints(0);
    setCollectionRate(0);
    setElapsedTime(0);
  }, [isForceConnected]);

  const hasData = pressureData.length > 0;
  const latestPressure = pressureData.length > 0 ? pressureData[pressureData.length - 1].pressure : null;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* 统计信息卡片 */}
      {(hasData || isForceConnected) && (
        <div className="grid grid-cols-3 gap-2 flex-shrink-0">
          <div className="rounded p-2" style={{ background: 'oklch(0.20 0.025 265)', border: '1px solid oklch(0.28 0.03 265)' }}>
            <div style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px', marginBottom: '2px', fontFamily: "'IBM Plex Mono', monospace" }}>
              采集速率
            </div>
            <div style={{ color: 'oklch(0.70 0.18 200)', fontSize: '13px', fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
              {collectionRate} <span style={{ fontSize: '9px' }}>Hz</span>
            </div>
          </div>

          <div className="rounded p-2" style={{ background: 'oklch(0.20 0.025 265)', border: '1px solid oklch(0.28 0.03 265)' }}>
            <div style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px', marginBottom: '2px', fontFamily: "'IBM Plex Mono', monospace" }}>
              数据点数
            </div>
            <div style={{ color: 'oklch(0.72 0.20 145)', fontSize: '13px', fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
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
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-medium" style={{ color: 'oklch(0.75 0.18 55)' }}>
            压力数据可视化
          </span>
          {isForceConnected && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'oklch(0.75 0.18 55)' }} />
              <span style={{ color: 'oklch(0.75 0.18 55)', fontSize: '8px', fontFamily: "'IBM Plex Mono', monospace" }}>
                实时采集中
              </span>
            </div>
          )}
          {isForceConnected && latestPressure !== null && (
            <span style={{ color: 'oklch(0.75 0.18 55)', fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>
              {latestPressure.toFixed(2)} N
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(hasData || isForceConnected) && (
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
          className="flex items-start gap-2 p-2 rounded text-xs flex-shrink-0"
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
              {isForceConnected ? '等待数据...' : '等待数据'}
            </div>
            <div className="text-xs font-mono" style={{ color: 'oklch(0.35 0.02 240)' }}>
              {isForceConnected ? '已连接，正在接收压力数据' : '请在右上角连接检测设备后开始采集'}
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
                domain={['dataMin', 'dataMax']}
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
              <Area
                type="monotone"
                dataKey="pressure"
                fill="url(#pressureGradient)"
                stroke="none"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="pressure"
                stroke="oklch(0.75 0.18 55)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                name="压力 (N)"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
