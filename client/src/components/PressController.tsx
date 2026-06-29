/**
 * PressController - Arduino 下压机串口控制组件
 *
 * 通过 COM 口连接 Arduino (9600 baud)，发送 "1" 触发下压，
 * 两次下压之间至少间隔 10s（防止重复发送）。
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Play, Square, Usb, Zap } from 'lucide-react';

/** 模块级 writer ref，供外部直接发送下压指令 */
let gPressWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
export function getPressWriter() { return gPressWriter; }

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
  const [arduinoConnected, setArduinoConnected] = useState(false);
  const [arduinoConnecting, setArduinoConnecting] = useState(false);
  const [statusText, setStatusText] = useState('');
  const portRef = useRef<SerialPort | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);

  const isWebSerial = typeof navigator !== 'undefined' && 'serial' in navigator;

  const connectArduino = useCallback(async () => {
    setArduinoConnecting(true);
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      portRef.current = port;
      const writer = port.writable?.getWriter() ?? null;
      writerRef.current = writer;
      gPressWriter = writer;
      setArduinoConnected(true);
      setStatusText('Arduino 已连接 (9600 baud)');
    } catch (e) {
      setStatusText('连接失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setArduinoConnecting(false);
    }
  }, []);

  const disconnectArduino = useCallback(async () => {
    try {
      writerRef.current?.close();
      writerRef.current = null;
      gPressWriter = null;
      await portRef.current?.close();
      portRef.current = null;
    } catch {}
    setArduinoConnected(false);
    setStatusText('Arduino 已断开');
  }, []);

  const sendPress = useCallback(async (): Promise<boolean> => {
    if (!writerRef.current) return false;
    try {
      await writerRef.current.write(new TextEncoder().encode('1'));
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleStart = useCallback(() => {
    onStart();
  }, [onStart]);

  const handleStop = useCallback(() => {
    onStop();
  }, [onStop]);

  const updateConfig = (key: keyof PressConfig, val: number) => {
    onConfigChange({ ...config, [key]: Math.max(1, val) });
  };

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

      {/* Arduino 连接 */}
      {!arduinoConnected ? (
        <button
          onClick={connectArduino}
          disabled={arduinoConnecting || !isWebSerial}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono transition-opacity hover:opacity-80"
          style={{
            background: 'oklch(0.25 0.03 265)',
            border: '1px solid oklch(0.30 0.03 265)',
            color: isWebSerial ? 'oklch(0.65 0.02 240)' : 'oklch(0.40 0.02 240)',
          }}
        >
          <Usb size={10} />
          {arduinoConnecting ? '连接中...' : '连接 Arduino (9600)'}
        </button>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'oklch(0.72 0.20 145)' }} />
            <span className="text-xs font-mono" style={{ color: 'oklch(0.72 0.20 145)' }}>Arduino 已连接</span>
          </div>
          <button
            onClick={disconnectArduino}
            className="text-xs font-mono px-1.5 py-0.5 rounded"
            style={{
              background: 'oklch(0.65 0.22 25 / 0.15)',
              color: 'oklch(0.65 0.22 25)',
              fontSize: '9px',
            }}
          >
            断开
          </button>
        </div>
      )}

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

      {/* 状态 */}
      {statusText && (
        <div className="text-xs font-mono" style={{ color: 'oklch(0.42 0.02 240)', fontSize: '10px' }}>
          {statusText}
        </div>
      )}

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
