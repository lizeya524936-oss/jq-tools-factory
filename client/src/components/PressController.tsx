/**
 * PressController - Arduino 下压机串口控制组件
 *
 * 通过 COM 口连接 Arduino (9600 baud)，发送 "1" 触发下压，
 * 两次下压之间至少间隔 10s（防止重复发送）。
 */

import { useState, useEffect } from 'react';
import { Play, Square, Zap } from 'lucide-react';

/** 模块级 writer ref + 连接状态，供外部直接发送下压指令 */
let gPressWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
let gPressConnected = false;

export function getPressWriter() { return gPressWriter; }
export function isPressConnected() { return gPressConnected; }

/** 连接 Arduino (9600 baud)，返回是否成功 */
export async function connectArduino(): Promise<boolean> {
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    const writer = port.writable?.getWriter() ?? null;
    if (writer) {
      gPressWriter = writer;
      gPressConnected = true;
      notifyListeners();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** 断开 Arduino */
export async function disconnectArduino(): Promise<void> {
  try {
    gPressWriter?.close();
    gPressWriter = null;
    gPressConnected = false;
    notifyListeners();
  } catch {}
}

// 监听器列表
const listeners = new Set<() => void>();
export function onPressStateChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function notifyListeners() { listeners.forEach(fn => fn()); }

export interface PressConfig {
  pressesPerCollection: number;   // 每次采集前下压次数
  collectionsPerCycle: number;    // 采集次数
  cycles: number;                 // 循环次数
}

interface PressControllerProps {
  config: PressConfig;
  onConfigChange: (config: PressConfig) => void;
  onCycleTick: (cycleIndex: number, collectionIndex: number, pressIndex: number) => void;
  onCollectionTrigger: () => Promise<void>;  // 触发一次数据采集
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
}

export default function PressController({
  config, onConfigChange,
  isRunning, onStart, onStop,
}: PressControllerProps) {
  const [arduinoConnected, setArduinoConnected] = useState(isPressConnected());

  useEffect(() => {
    return onPressStateChange(() => setArduinoConnected(isPressConnected()));
  }, []);

  const updateConfig = (key: keyof PressConfig, val: number) => {
    onConfigChange({ ...config, [key]: Math.max(1, val) });
  };

  const handleStart = () => onStart();
  const handleStop = () => onStop();

  const totalPresses = config.pressesPerCollection * config.cycles;
  const totalCollections = config.cycles;

  return (
    <div
      className="rounded p-3 flex flex-col gap-2"
      style={{
        background: 'oklch(0.15 0.02 265)',
        border: '1px solid oklch(0.25 0.03 265)',
      }}
    >
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <Zap size={12} style={{ color: 'oklch(0.80 0.18 55)' }} />
        <span className="text-xs font-mono font-medium" style={{ color: 'oklch(0.80 0.18 55)' }}>
          下压机控制
        </span>
      </div>

      {/* Arduino 连接状态 */}
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: arduinoConnected ? 'oklch(0.72 0.20 145)' : 'oklch(0.40 0.02 240)' }} />
        <span className="text-xs font-mono" style={{ color: arduinoConnected ? 'oklch(0.72 0.20 145)' : 'oklch(0.50 0.02 240)' }}>
          {arduinoConnected ? '下压机已连接' : '下压机未连接'}
        </span>
      </div>

      {/* 参数设置 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)' }}>下压次数 / 采集</span>
          <input
            type="number"
            min={1}
            value={config.pressesPerCollection}
            onChange={e => updateConfig('pressesPerCollection', parseInt(e.target.value) || 1)}
            disabled={isRunning}
            className="w-16 px-1.5 py-0.5 rounded text-xs font-mono text-right outline-none"
            style={{
              background: 'oklch(0.20 0.025 265)',
              border: '1px solid oklch(0.28 0.03 265)',
              color: 'oklch(0.70 0.02 240)',
            }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)' }}>循环次数</span>
          <input
            type="number"
            min={1}
            value={config.cycles}
            onChange={e => updateConfig('cycles', parseInt(e.target.value) || 1)}
            disabled={isRunning}
            className="w-16 px-1.5 py-0.5 rounded text-xs font-mono text-right outline-none"
            style={{
              background: 'oklch(0.20 0.025 265)',
              border: '1px solid oklch(0.28 0.03 265)',
              color: 'oklch(0.70 0.02 240)',
            }}
          />
        </div>
      </div>

      {/* 统计信息 */}
      <div className="flex gap-3 text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '10px' }}>
        <span>总下压: {totalPresses}</span>
        <span>总采集: {totalCollections}</span>
      </div>

      {/* 开始/停止 */}
      <div className="flex gap-2">
        <button
          onClick={handleStart}
          disabled={isRunning || !arduinoConnected}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded text-xs font-mono font-bold transition-opacity"
          style={{
            background: (isRunning || !arduinoConnected) ? 'oklch(0.25 0.03 265)' : 'oklch(0.72 0.20 145 / 0.85)',
            color: (isRunning || !arduinoConnected) ? 'oklch(0.40 0.02 240)' : '#0a0e1a',
            opacity: (isRunning || !arduinoConnected) ? 0.5 : 1,
            cursor: (isRunning || !arduinoConnected) ? 'not-allowed' : 'pointer',
          }}
        >
          <Play size={10} />
          开始
        </button>
        <button
          onClick={handleStop}
          disabled={!isRunning}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded text-xs font-mono font-bold transition-opacity"
          style={{
            background: !isRunning ? 'oklch(0.25 0.03 265)' : 'oklch(0.65 0.22 25 / 0.85)',
            color: !isRunning ? 'oklch(0.40 0.02 240)' : '#fff',
            opacity: !isRunning ? 0.5 : 1,
            cursor: !isRunning ? 'not-allowed' : 'pointer',
          }}
        >
          <Square size={10} />
          停止
        </button>
      </div>
    </div>
  );
}
