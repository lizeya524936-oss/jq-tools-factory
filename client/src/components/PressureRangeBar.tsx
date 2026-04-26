/**
 * PressureRangeBar — 共享的压力范围控制栏
 * 
 * 滑块 + 输入框 + 快捷按钮 + Max 按钮
 * 被 DataChart 和 ConsistencyAnalysis 共同使用，双向联动
 */
import { useState, useCallback, useMemo, memo } from 'react';

/** 快捷压力范围选项 (N) */
const QUICK_PRESETS = [50, 100, 200, 500];

interface PressureRangeBarProps {
  /** 当前最大压力值 */
  pressureMax: number;
  /** 压力值变更回调 */
  onPressureMaxChange: (val: number) => void;
  /** 数据中的最大压力值（决定滑块上限） */
  dataMaxPressure?: number;
  /** 是否显示分析点数提示 */
  showPointCount?: number;
  /** 紧凑模式（用于 DataChart 内嵌） */
  compact?: boolean;
}

function PressureRangeBarInner({
  pressureMax,
  onPressureMaxChange,
  dataMaxPressure = 100,
  showPointCount,
  compact = false,
}: PressureRangeBarProps) {
  const [inputValue, setInputValue] = useState<string>(String(pressureMax));

  // 滑块的上限
  const sliderMax = useMemo(() => {
    return Math.max(dataMaxPressure, 100);
  }, [dataMaxPressure]);

  // 同步外部变化到输入框
  useMemo(() => {
    setInputValue(String(pressureMax));
  }, [pressureMax]);

  // 处理滑块变化
  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    onPressureMaxChange(val);
  }, [onPressureMaxChange]);

  // 处理输入框变化
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  }, []);

  // 处理输入框确认（回车或失焦）
  const handleInputConfirm = useCallback(() => {
    const val = parseFloat(inputValue);
    if (!isNaN(val) && val > 0) {
      const clamped = Math.min(Math.max(val, 5), sliderMax);
      onPressureMaxChange(clamped);
      setInputValue(String(clamped));
    } else {
      setInputValue(String(pressureMax));
    }
  }, [inputValue, pressureMax, sliderMax, onPressureMaxChange]);

  // 快捷按钮
  const handlePreset = useCallback((val: number) => {
    const clamped = Math.min(val, sliderMax);
    onPressureMaxChange(clamped);
  }, [sliderMax, onPressureMaxChange]);

  return (
    <div
      className={`flex items-center gap-3 ${compact ? 'px-2 py-1.5' : 'px-3 py-2.5'} rounded`}
      style={{
        background: 'oklch(0.14 0.02 265)',
        border: '1px solid oklch(0.22 0.03 265)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-xs font-mono font-medium flex-shrink-0" style={{ color: 'oklch(0.55 0.02 240)', fontSize: compact ? '9px' : '11px' }}>
        压力范围
      </span>

      {/* 滑块 */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-xs font-mono flex-shrink-0" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '10px' }}>0</span>
        <input
          type="range"
          min={5}
          max={sliderMax}
          step={sliderMax <= 100 ? 5 : sliderMax <= 500 ? 10 : 50}
          value={pressureMax}
          onChange={handleSliderChange}
          className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, oklch(0.58 0.18 200) 0%, oklch(0.58 0.18 200) ${(pressureMax / sliderMax) * 100}%, oklch(0.25 0.02 240) ${(pressureMax / sliderMax) * 100}%, oklch(0.25 0.02 240) 100%)`,
            accentColor: 'oklch(0.58 0.18 200)',
          }}
        />
        <span className="text-xs font-mono flex-shrink-0" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '10px' }}>{sliderMax}N</span>
      </div>

      {/* 输入框 */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputConfirm}
          onKeyDown={(e) => { if (e.key === 'Enter') handleInputConfirm(); }}
          className="w-16 px-2 py-1 rounded text-xs font-mono text-center"
          style={{
            background: 'oklch(0.20 0.025 265)',
            border: '1px solid oklch(0.30 0.03 265)',
            color: 'oklch(0.80 0.02 240)',
            outline: 'none',
            fontSize: '10px',
          }}
        />
        <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '10px' }}>N</span>
      </div>

      {/* 分隔线 */}
      <div className="w-px h-5 flex-shrink-0" style={{ background: 'oklch(0.25 0.03 265)' }} />

      {/* 快捷按钮 */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {QUICK_PRESETS.filter(p => p <= sliderMax).map(preset => (
          <button
            key={preset}
            onClick={() => handlePreset(preset)}
            className="px-2 py-0.5 rounded text-xs font-mono transition-colors"
            style={{
              background: pressureMax === preset ? 'oklch(0.58 0.18 200 / 0.25)' : 'oklch(0.20 0.02 265)',
              border: `1px solid ${pressureMax === preset ? 'oklch(0.58 0.18 200 / 0.5)' : 'oklch(0.28 0.03 265)'}`,
              color: pressureMax === preset ? 'oklch(0.75 0.15 200)' : 'oklch(0.55 0.02 240)',
              cursor: 'pointer',
              fontSize: '10px',
            }}
          >
            {preset}N
          </button>
        ))}
        {/* 数据最大值按钮 */}
        {dataMaxPressure > 100 && !QUICK_PRESETS.includes(dataMaxPressure) && (
          <button
            onClick={() => handlePreset(dataMaxPressure)}
            className="px-2 py-0.5 rounded text-xs font-mono transition-colors"
            style={{
              background: pressureMax === dataMaxPressure ? 'oklch(0.58 0.18 200 / 0.25)' : 'oklch(0.20 0.02 265)',
              border: `1px solid ${pressureMax === dataMaxPressure ? 'oklch(0.58 0.18 200 / 0.5)' : 'oklch(0.28 0.03 265)'}`,
              color: pressureMax === dataMaxPressure ? 'oklch(0.75 0.15 200)' : 'oklch(0.55 0.02 240)',
              cursor: 'pointer',
              fontSize: '10px',
            }}
          >
            Max {dataMaxPressure}N
          </button>
        )}
      </div>

      {/* 分析点数提示 */}
      {showPointCount !== undefined && (
        <>
          <div className="w-px h-5 flex-shrink-0" style={{ background: 'oklch(0.25 0.03 265)' }} />
          <span className="text-xs font-mono flex-shrink-0" style={{ color: 'oklch(0.40 0.02 240)', fontSize: '9px' }}>
            {showPointCount} 个分析点
          </span>
        </>
      )}
    </div>
  );
}

const PressureRangeBar = memo(PressureRangeBarInner);
export default PressureRangeBar;
