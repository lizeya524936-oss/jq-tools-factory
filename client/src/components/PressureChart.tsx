/**
 * PressureChart - 压力数据实时图表组件
 *
 * 数据采集架构（v1.3.7）：
 *   与 v1.3.1 的 SerialDriver.setDataCallback 等效的直接回调模式：
 *   串口 200Hz → useSerialPort.onForceData → pipeline.updateForceData(n)
 *                → subscribeForce 回调 → 直接写入 pendingPointsRef 缓冲区（零丢失）
 *   UI 刷新：200ms 定时器批量将缓冲区数据刷入 React State，保持最近200个数据点
 *
 * 关键设计：
 *   - 使用 pipeline.subscribeForce() 专用通道，仅在 force 数据更新时触发
 *   - 回调直接接收 forceN 数值，不创建 snapshot 对象，零 GC 开销
 *   - 不受 sensor 数据更新干扰，不会写入重复数据
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
const UI_REFRESH_INTERVAL = 200;

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0]?.payload as ChartDataPoint;
    return (
      <div
        className="rounded p-2.5"
        style={{
          background: 'var(--jk-s2)',
          border: '1px solid var(--jk-line-4)',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: '11px',
          boxShadow: '0 4px 12px oklch(0 0 0 / 0.4)',
        }}
      >
        <div style={{ color: 'var(--jk-text-body)', marginBottom: '4px', fontSize: '10px' }}>
          样本 #{data?.index} · {data?.time}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <span style={{ color: 'var(--jk-warn)' }}>压力:</span>
            <span style={{ color: 'var(--jk-warn)', fontWeight: 600 }}>{data?.pressure.toFixed(2)} N</span>
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

export default function PressureChart({ showControls = true, externalData }: { showControls?: boolean; externalData?: ChartDataPoint[] }) {
  const { isForceConnected, sendForceCommand } = useSerialData();

  // CL2 压力计归零/重置命令
  const CL2_CMD_RESET = new Uint8Array([0x23, 0x55, 0x00, 0x0A]);

  const [pressureData, setPressureData] = useState<ChartDataPoint[]>([]);
  const [errorMsg] = useState('');

  // 统计信息
  const [totalDataPoints, setTotalDataPoints] = useState(0);
  const [collectionRate, setCollectionRate] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [latestPressure, setLatestPressure] = useState<number | null>(null);

  // 内部统计 Ref（不触发 React 重渲染）
  const dataPointCountRef = useRef(0);
  const collectionStartTimeRef = useRef<number | null>(null);

  // 数据缓冲区：subscribeForce 回调直接写入，UI 定时器批量读取
  const pendingPointsRef = useRef<ChartDataPoint[]>([]);

  // ===== 核心：通过 subscribeForce 专用通道直接接收每个压力数据点 =====
  // 与 v1.3.1 的 serialDriver.setDataCallback 完全等效
  useEffect(() => {
    const pipeline = getRealtimeDataPipeline();

    const unsubscribe = pipeline.subscribeForce((forceN: number) => {
      // 初始化采集开始时间
      if (collectionStartTimeRef.current === null) {
        collectionStartTimeRef.current = Date.now();
      }

      dataPointCountRef.current += 1;

      // 直接写入缓冲区（零开销，不触发 React 重渲染）
      pendingPointsRef.current.push({
        index: 0,
        pressure: forceN,
        time: new Date().toLocaleTimeString('zh-CN'),
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

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

  // 连接断开时重置采集开始时间
  useEffect(() => {
    if (!isForceConnected) {
      collectionStartTimeRef.current = null;
    }
  }, [isForceConnected]);

  // 重置图表数据和统计，同时向压力计发送 CMD_RESET 归零指令
  const handleReset = useCallback(async () => {
    // 向压力计发送归零指令
    if (isForceConnected && sendForceCommand) {
      const ok = await sendForceCommand(CL2_CMD_RESET);
      if (ok) {
        console.log('[PressureChart] CMD_RESET 归零指令已发送');
      }
    }
    // 重置界面数据
    setPressureData([]);
    pendingPointsRef.current = [];
    dataPointCountRef.current = 0;
    collectionStartTimeRef.current = isForceConnected ? Date.now() : null;
    setTotalDataPoints(0);
    setCollectionRate(0);
    setElapsedTime(0);
    setLatestPressure(null);
  }, [isForceConnected, sendForceCommand]);

  // 外部数据模式：传入采集区间数据时显示固定曲线（停止实时滚动）
  const isExternalMode = !!externalData && externalData.length > 0;
  const displayData = isExternalMode
    ? externalData!.map((p, idx) => ({ ...p, index: idx + 1 }))
    : pressureData;

  const hasData = displayData.length > 0;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* 统计信息卡片 */}
      {showControls && (hasData || isForceConnected) && (
        <div className="grid grid-cols-3 gap-2 flex-shrink-0">
          <div className="rounded p-2" style={{ background: 'var(--jk-s3)', border: '1px solid var(--jk-line-2)' }}>
            <div style={{ color: 'var(--jk-text-low)', fontSize: '9px', marginBottom: '2px', fontFamily: "'IBM Plex Mono', monospace" }}>
              采集速率
            </div>
            <div style={{ color: 'var(--jk-accent)', fontSize: '13px', fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
              {collectionRate} <span style={{ fontSize: '9px' }}>Hz</span>
            </div>
          </div>

          <div className="rounded p-2" style={{ background: 'var(--jk-s3)', border: '1px solid var(--jk-line-2)' }}>
            <div style={{ color: 'var(--jk-text-low)', fontSize: '9px', marginBottom: '2px', fontFamily: "'IBM Plex Mono', monospace" }}>
              数据点数
            </div>
            <div style={{ color: 'var(--jk-ok)', fontSize: '13px', fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
              {totalDataPoints}
            </div>
          </div>

          <div className="rounded p-2" style={{ background: 'var(--jk-s3)', border: '1px solid var(--jk-line-2)' }}>
            <div style={{ color: 'var(--jk-text-low)', fontSize: '9px', marginBottom: '2px', fontFamily: "'IBM Plex Mono', monospace" }}>
              采集时长
            </div>
            <div style={{ color: 'var(--jk-warn)', fontSize: '13px', fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
              {formatTime(elapsedTime)}
            </div>
          </div>
        </div>
      )}

      {/* 标题栏 */}
      {showControls && (
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-medium" style={{ color: 'var(--jk-warn)' }}>
            {isExternalMode ? '压力数据可视化 · 采集区间' : '压力数据可视化'}
          </span>
          {isExternalMode ? (
            <span style={{ color: 'var(--jk-text-body)', fontSize: '9px', fontFamily: "'IBM Plex Mono', monospace" }}>
              {displayData.length} 点
            </span>
          ) : isForceConnected ? (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--jk-warn)' }} />
              <span style={{ color: 'var(--jk-warn)', fontSize: '8px', fontFamily: "'IBM Plex Mono', monospace" }}>
                实时采集中
              </span>
            </div>
          ) : null}
          {(isExternalMode ? displayData[displayData.length - 1]?.pressure : latestPressure) !== null && (isExternalMode ? displayData.length > 0 : latestPressure !== null) && (
            <span style={{ color: 'var(--jk-warn)', fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>
              {(isExternalMode ? displayData[displayData.length - 1]?.pressure : latestPressure)!.toFixed(2)} N
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(hasData || isForceConnected) && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors"
              style={{
                background: 'var(--jk-s3)',
                border: '1px solid var(--jk-line-2)',
                color: 'var(--jk-text-high)',
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
      )}

      {/* 错误提示 */}
      {errorMsg && (
        <div
          className="flex items-start gap-2 p-2 rounded text-xs flex-shrink-0"
          style={{ background: 'color-mix(in srgb, var(--jk-danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--jk-danger) 30%, transparent)' }}
        >
          <AlertCircle size={12} style={{ color: 'var(--jk-danger)', flexShrink: 0, marginTop: '1px' }} />
          <span style={{ color: 'var(--jk-danger)' }}>{errorMsg}</span>
        </div>
      )}

      {/* 图表容器 */}
      {!hasData ? (
        <div className="flex-1 flex items-center justify-center rounded" style={{ background: 'var(--jk-s1)', border: '1px dashed var(--jk-line-1)' }}>
          <div className="text-center">
            <div className="text-sm font-mono mb-1" style={{ color: 'var(--jk-text-low)' }}>
              {isForceConnected ? '等待数据...' : '等待数据'}
            </div>
            <div className="text-xs font-mono" style={{ color: 'var(--jk-text-dim)' }}>
              {isForceConnected ? '已连接，正在接收压力数据' : '请在右上角连接检测设备后开始采集'}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 rounded" style={{ background: 'var(--jk-sunken)', border: '1px solid var(--jk-line-1)', minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={displayData} margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
              <defs>
                <linearGradient id="pressureGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--jk-warn)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--jk-warn)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--jk-line-1)"
                strokeOpacity={0.6}
              />
              <XAxis
                dataKey="index"
                type="number"
                domain={['dataMin', 'dataMax']}
                tick={{ fill: 'var(--jk-text-mid)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                axisLine={{ stroke: 'var(--jk-line-3)' }}
                tickLine={{ stroke: 'var(--jk-line-3)' }}
                label={{
                  value: '采样点',
                  position: 'insideBottom',
                  offset: -5,
                  fill: 'var(--jk-warn)',
                  fontSize: 10,
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              />
              <YAxis
                tick={{ fill: 'var(--jk-text-mid)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                axisLine={{ stroke: 'var(--jk-line-3)' }}
                tickLine={{ stroke: 'var(--jk-line-3)' }}
                label={{
                  value: '压力值 (N)',
                  angle: -90,
                  position: 'insideLeft',
                  fill: 'var(--jk-warn)',
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
                stroke="var(--jk-warn)"
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
