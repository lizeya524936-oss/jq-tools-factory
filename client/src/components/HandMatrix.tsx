/**
 * HandMatrix - 手形传感器矩阵可视化组件
 * 支持左手 (LH) 和右手 (RH) 两种布局
 *
 * 布局分三个区域（从上到下）：
 * 1. 指尖区域：5根手指各12个压力点，用红色区域框包裹
 * 2. 弯折区域：5个弯折传感器，彩色方块
 * 3. 手掌区域：手掌压力点，暗色背景
 *
 * v1.4.6 重新设计：紧凑布局，不显示ADC数值，分区清晰
 */
import { useMemo } from 'react';

export type HandSide = 'LH' | 'RH';

// ─────────────────────────────────────────────
// 数据定义
// ─────────────────────────────────────────────

/** 手指定义：名称、颜色、压力点编号（12个，4行×3列）、弯折编号 */
interface FingerDef {
  name: string;
  color: string;       // 弯折传感器颜色
  pressure: number[];  // 12个压力点编号，按左→右、上→下排列
  flex: number;        // 弯折传感器编号
}

const LH_FINGERS: FingerDef[] = [
  {
    name: '小拇指',
    color: '#7c3aed',
    pressure: [31, 30, 29, 15, 14, 13, 255, 254, 253, 239, 238, 237],
    flex: 222,
  },
  {
    name: '无名指',
    color: '#0891b2',
    pressure: [28, 27, 26, 12, 11, 10, 252, 251, 250, 236, 235, 234],
    flex: 219,
  },
  {
    name: '中指',
    color: '#6b7280',
    pressure: [25, 24, 23, 9, 8, 7, 249, 248, 247, 233, 232, 231],
    flex: 216,
  },
  {
    name: '食指',
    color: '#dc2626',
    pressure: [22, 21, 20, 6, 5, 4, 246, 245, 244, 230, 229, 228],
    flex: 213,
  },
  {
    name: '大拇指',
    color: '#16a34a',
    pressure: [19, 18, 17, 3, 2, 1, 243, 242, 241, 227, 226, 225],
    flex: 210,
  },
];

const RH_FINGERS: FingerDef[] = [
  {
    name: '大拇指',
    color: '#16a34a',
    pressure: [240, 239, 238, 256, 255, 254, 16, 15, 14, 32, 31, 30],
    flex: 47,
  },
  {
    name: '食指',
    color: '#dc2626',
    pressure: [237, 236, 235, 253, 252, 251, 13, 12, 11, 29, 28, 27],
    flex: 44,
  },
  {
    name: '中指',
    color: '#6b7280',
    pressure: [234, 233, 232, 250, 249, 248, 10, 9, 8, 26, 25, 24],
    flex: 41,
  },
  {
    name: '无名指',
    color: '#0891b2',
    pressure: [231, 230, 229, 247, 246, 245, 7, 6, 5, 23, 22, 21],
    flex: 38,
  },
  {
    name: '小拇指',
    color: '#7c3aed',
    pressure: [228, 227, 226, 244, 243, 242, 4, 3, 2, 20, 19, 18],
    flex: 35,
  },
];

// 左手手掌编号（按行排列）
const LH_PALM_ROWS: number[][] = [
  [207, 206, 205, 204, 203, 202, 201, 200, 199, 198, 197, 196],
  [191, 190, 189, 188, 187, 186, 185, 184, 183, 182, 181, 180, 179, 178, 177],
  [175, 174, 173, 172, 171, 170, 169, 168, 167, 166, 165, 164, 163, 162, 161],
  [159, 158, 157, 156, 155, 154, 153, 152, 151, 150, 149, 148, 147, 146, 145],
  [143, 142, 141, 140, 139, 138, 137, 136, 135, 134, 133, 132, 131, 130, 129],
];

// 右手手掌编号（按行排列）
const RH_PALM_ROWS: number[][] = [
  [61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50],
  [80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70, 69, 68, 67, 66],
  [96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82],
  [112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100, 99, 98],
  [128, 127, 126, 125, 124, 123, 122, 121, 120, 119, 118, 117, 116, 115, 114],
];

// ─────────────────────────────────────────────
// 颜色工具
// ─────────────────────────────────────────────

function adcToColor(adc: number): string {
  const v = Math.min(255, Math.max(0, adc));
  if (v === 0) return 'oklch(0.16 0.02 265)';
  if (v < 64) {
    const t = v / 64;
    return `oklch(${0.25 + t * 0.10} ${0.08 + t * 0.08} ${260})`;
  }
  if (v < 128) {
    const t = (v - 64) / 64;
    return `oklch(${0.35 + t * 0.15} ${0.16 + t * 0.04} ${260 - t * 80})`;
  }
  if (v < 192) {
    const t = (v - 128) / 64;
    return `oklch(${0.50 + t * 0.08} ${0.20} ${180 - t * 80})`;
  }
  const t = (v - 192) / 63;
  return `oklch(${0.58 - t * 0.05} ${0.22} ${100 - t * 75})`;
}

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────

export interface HandMatrixProps {
  side: HandSide;
  /** 原始 ADC 数组，索引 0 对应编号 1（adcValues[arrayIndex - 1]） */
  adcValues: number[] | null;
  /** 是否显示数组编号（默认 true） */
  showIndex?: boolean;
}

// ─────────────────────────────────────────────
// 子组件：单个压力点格子（紧凑，不显示数值）
// ─────────────────────────────────────────────

interface PressureDotProps {
  arrayIndex: number;
  adc: number;
  showIndex: boolean;
  size: number;
}

function PressureDot({ arrayIndex, adc, showIndex, size }: PressureDotProps) {
  const bg = adcToColor(adc);
  return (
    <div
      title={`#${arrayIndex}  ADC: ${adc}`}
      style={{
        width: size,
        height: size,
        background: bg,
        border: `1px solid oklch(0.35 0.08 25 / 0.6)`,
        borderRadius: 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        cursor: 'default',
        transition: 'background 0.12s',
      }}
    >
      {showIndex && (
        <span style={{
          fontSize: '6px',
          color: 'oklch(0.55 0.02 240)',
          lineHeight: 1,
          userSelect: 'none',
          pointerEvents: 'none',
        }}>
          {arrayIndex}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 子组件：单根手指区域（红色框 + 4行×3列）
// ─────────────────────────────────────────────

interface FingerBlockProps {
  finger: FingerDef;
  adcValues: number[] | null;
  showIndex: boolean;
  dotSize: number;
  gap: number;
}

function FingerBlock({ finger, adcValues, showIndex, dotSize, gap }: FingerBlockProps) {
  const getAdc = (idx: number) => (adcValues && idx >= 1 ? adcValues[idx - 1] ?? 0 : 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {/* 手指名称 */}
      <span style={{
        fontSize: '9px',
        color: 'oklch(0.65 0.02 240)',
        fontFamily: "'IBM Plex Mono', monospace",
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}>
        {finger.name}
      </span>

      {/* 红色压力区域框 */}
      <div style={{
        padding: '4px',
        background: 'oklch(0.65 0.22 25 / 0.08)',
        border: '1.5px solid oklch(0.65 0.22 25 / 0.55)',
        borderRadius: 5,
        display: 'flex',
        flexDirection: 'column',
        gap: gap,
      }}>
        {/* 4行 × 3列 */}
        {[0, 1, 2, 3].map(row => (
          <div key={row} style={{ display: 'flex', gap: gap }}>
            {[0, 1, 2].map(col => {
              const idx = finger.pressure[row * 3 + col];
              return (
                <PressureDot
                  key={col}
                  arrayIndex={idx}
                  adc={getAdc(idx)}
                  showIndex={showIndex}
                  size={dotSize}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────

export default function HandMatrix({ side, adcValues, showIndex = true }: HandMatrixProps) {
  const fingers = useMemo(() => (side === 'LH' ? LH_FINGERS : RH_FINGERS), [side]);
  const palmRows = useMemo(() => (side === 'LH' ? LH_PALM_ROWS : RH_PALM_ROWS), [side]);

  const getAdc = (idx: number) => (adcValues && idx >= 1 ? adcValues[idx - 1] ?? 0 : 0);

  const DOT = 18;    // 压力点格子尺寸 px
  const GAP = 2;     // 格子间距 px
  const PALM_DOT = 16; // 手掌格子尺寸 px

  return (
    <div style={{
      fontFamily: "'IBM Plex Mono', monospace",
      display: 'inline-flex',
      flexDirection: 'column',
      gap: 8,
      userSelect: 'none',
    }}>
      {/* ── 标题行 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: '11px',
          fontWeight: 700,
          color: side === 'LH' ? 'oklch(0.72 0.20 200)' : 'oklch(0.72 0.20 145)',
          letterSpacing: '0.06em',
        }}>
          {side === 'LH' ? '◀ LH  Left Hand' : 'RH  Right Hand ▶'}
        </span>
        <span style={{ fontSize: '9px', color: 'oklch(0.40 0.02 240)' }}>
          {showIndex ? '格内显示原始编号' : ''}
        </span>
      </div>

      {/* ── 区域1：指尖压力（5根手指并排） ── */}
      <div>
        <div style={{
          fontSize: '8px',
          color: 'oklch(0.65 0.22 25)',
          marginBottom: 4,
          letterSpacing: '0.04em',
          fontWeight: 600,
        }}>
          ▌ 指尖压力区
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          {fingers.map(finger => (
            <FingerBlock
              key={finger.name}
              finger={finger}
              adcValues={adcValues}
              showIndex={showIndex}
              dotSize={DOT}
              gap={GAP}
            />
          ))}
        </div>
      </div>

      {/* ── 区域2：弯折传感器 ── */}
      <div>
        <div style={{
          fontSize: '8px',
          color: 'oklch(0.70 0.18 55)',
          marginBottom: 4,
          letterSpacing: '0.04em',
          fontWeight: 600,
        }}>
          ▌ 弯折传感器
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {fingers.map(finger => {
            const adc = getAdc(finger.flex);
            const pct = Math.round(adc / 255 * 100);
            return (
              <div
                key={finger.name}
                title={`${finger.name}弯折 #${finger.flex}  ADC: ${adc}`}
                style={{
                  // 宽度与手指块对齐：3列格子 + 2间距 + 2×4px内边距
                  width: DOT * 3 + GAP * 2 + 8,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                  cursor: 'default',
                }}
              >
                {/* 彩色方块 */}
                <div style={{
                  width: DOT * 3 + GAP * 2,
                  height: DOT,
                  background: finger.color + '28',
                  border: `2px solid ${finger.color}`,
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  {/* 进度条背景 */}
                  <div style={{
                    position: 'absolute',
                    left: 0, top: 0, bottom: 0,
                    width: `${pct}%`,
                    background: finger.color + '40',
                    transition: 'width 0.15s',
                  }} />
                  {showIndex && (
                    <span style={{
                      position: 'relative',
                      fontSize: '7px',
                      color: finger.color,
                      fontWeight: 700,
                      zIndex: 1,
                    }}>
                      #{finger.flex}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '7px', color: 'oklch(0.45 0.02 240)' }}>
                  {finger.name.slice(-2)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 区域3：手掌 ── */}
      <div>
        <div style={{
          fontSize: '8px',
          color: 'oklch(0.60 0.06 265)',
          marginBottom: 4,
          letterSpacing: '0.04em',
          fontWeight: 600,
        }}>
          ▌ 手掌掌托区
        </div>
        <div style={{
          padding: '6px',
          background: 'oklch(0.20 0.03 265 / 0.6)',
          border: '1px solid oklch(0.35 0.05 265 / 0.6)',
          borderRadius: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: GAP,
          alignItems: 'flex-start',
        }}>
          {palmRows.map((row, ri) => (
            <div key={ri} style={{ display: 'flex', gap: GAP }}>
              {row.map(idx => {
                const adc = getAdc(idx);
                return (
                  <div
                    key={idx}
                    title={`#${idx}  ADC: ${adc}`}
                    style={{
                      width: PALM_DOT,
                      height: PALM_DOT,
                      background: adcToColor(adc),
                      border: '1px solid oklch(0.32 0.04 265 / 0.7)',
                      borderRadius: 2,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'default',
                      transition: 'background 0.12s',
                    }}
                  >
                    {showIndex && (
                      <span style={{
                        fontSize: '5px',
                        color: 'oklch(0.50 0.02 240)',
                        lineHeight: 1,
                        pointerEvents: 'none',
                      }}>
                        {idx}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── 底部色阶图例 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
        <span style={{ fontSize: '8px', color: 'oklch(0.40 0.02 240)' }}>压力:</span>
        {[0, 32, 64, 96, 128, 160, 192, 224, 255].map(v => (
          <div key={v} style={{
            width: 12, height: 8, borderRadius: 1,
            background: adcToColor(v),
            border: '1px solid oklch(0.25 0.03 265)',
          }} />
        ))}
        <span style={{ fontSize: '7px', color: 'oklch(0.35 0.02 240)' }}>低</span>
        <span style={{ fontSize: '7px', color: 'oklch(0.35 0.02 240)', marginLeft: 'auto' }}>高</span>
      </div>
    </div>
  );
}
