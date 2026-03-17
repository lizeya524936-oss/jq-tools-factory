/**
 * PressureChart - 压力数据实时图表组件
 * 数据来源：从 RealtimeDataPipeline 全局单例读取最新压力值
 * 采集模式：连接后启动定时轮询（50ms），持续采集并绘制最近200个数据点
 *           无论压力值是否变化，都会持续写入新数据点
 * 绘制方式：Recharts ComposedChart + Area + Line
 * 颜色方案：橙黄主题 + 深色背景
 *
 * 性能优化：50ms 定时器写入 Ref 缓冲区，200ms 定时器批量刷新 UI
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
const POLL_INTERVAL = 50;    // 数据采集轮询间隔（ms）
const UI_REFRESH_INTERVAL = 200; // UI 刷新间隔（ms）

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
  const { isForceConnected } = useSerialData();

  const [pressureData, setPressureData] = useState<ChartDataPoint[]>([]);
  const [errorMsg] = useState('');

  // 统计信息
  const [totalDataPoints, setTotalDataPoints] = useState(0);
  const [collectionRate, setCollectionRate] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [latestPressure, setLatestPressure] = useState<number | null>(null);

  // 内部统计 Ref
  const dataPointCountRef = useRef(0);
  const collectionStartTimeRef = useRef<number | null>(null);

  // 数据缓冲区：采集定时器写入此 Ref，UI 刷新定时器批量读取
  const pendingPointsRef = useRef<ChartDataPoint[]>([]);

  // 采集定时器 Ref
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ===== 核心：连接后启动持续采集定时器 =====
  useEffect(() => {
    if (isForceConnected) {
      // 初始化采集开始时间
      if (collectionStartTimeRef.current === null) {
        collectionStartTimeRef.current = Date.now();
      }

      const pipeline = getRealtimeDataPipeline();

      // 启动 50ms 轮询定时器：持续从全局单例读取最新压力值
      pollTimerRef.current = setInterval(() => {
        const force = pipeline.getLatestForce();
        const value = force ?? 0; // 如果没有数据，使用 0

        dataPointCountRef.current += 1;

        pendingPointsRef.current.push({
          index: 0, // 后续 UI 刷新时重新编号
          pressure: value,
          time: new Date().toLocaleTimeString('zh-CN'),
        });
      }, POLL_INTERVAL);
    } else {
      // 断开连接：停止采集
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isForceConnected]);

  // ===== 200ms UI 批量刷新定时器 =====
  useEffect(() => {
    const timer = setInterval(() => {
      // 1. 刷新图表数据
      const pending = pendingPointsRef.current;
      if (pending.length > 0) {
        pendingPointsRef.current = [];

        // 更新最新压力值显示
        const lastPoint = pending[pending.length - 1];
        setLatestPressure(lastPoint.pressure);

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
    }, UI_REFRESH_INTERVAL);

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
    setLatestPressure(null);
  }, [isForceConnected]);

  const hasData = pressureData.length > 0;

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
          {latestPressure !== null && (
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
