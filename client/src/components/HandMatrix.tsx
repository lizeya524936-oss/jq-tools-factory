/**
 * HandMatrix - 手形传感器矩阵可视化组件
 * 支持左手 (LH) 和右手 (RH) 两种布局
 *
 * 布局分三个区域（从上到下）：
 * 1. 指尖区域：5根手指各12个压力点，用红色区域框包裹
 * 2. 弯折区域：5个弯折传感器，彩色方块（与指尖红色框精确中心对齐）
 * 3. 手掌区域：手掌压力点，暗色背景（沿中指中心对齐）
 *
 * v1.4.9 新增选点功能：点击格子可选中/取消，选中的点参与ADC Sum计算
 */
import { useMemo, useCallback } from 'react';

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

/** 收集所有手形矩阵用到的编号（用于外部全选/清空等操作） */
export function getHandIndices(side: HandSide): number[] {
  const fingers = side === 'LH' ? LH_FINGERS : RH_FINGERS;
  const palmRows = side === 'LH' ? LH_PALM_ROWS : RH_PALM_ROWS;
  const indices: number[] = [];
  for (const f of fingers) {
    indices.push(...f.pressure);
    indices.push(f.flex);
  }
  for (const row of palmRows) {
    indices.push(...row);
  }
  return indices;
}

// ─────────────────────────────────────────────
// 颜色工具
// ─────────────────────────────────────────────

function adcToColor(adc: number, selected: boolean): string {
  const v = Math.min(255, Math.max(0, adc));
  if (selected) {
    // 选中状态：绿色系
    const intensity = Math.max(0.3, v / 255);
    return `oklch(${0.40 + intensity * 0.35} 0.22 145)`;
  }
  // 未选中：蓝→绿→红热力图
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

function selectedBorder(selected: boolean): string {
  return selected
    ? '2px solid oklch(0.72 0.22 145)'
    : '1px solid oklch(0.35 0.08 25 / 0.6)';
}

function selectedGlow(selected: boolean): string {
  return selected ? '0 0 5px oklch(0.72 0.22 145 / 0.5)' : 'none';
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
  /** 已选中的数组编号集合 */
  selectedIndices?: Set<number>;
  /** 点击格子切换选中状态的回调 */
  onToggleSelect?: (arrayIndex: number) => void;
}

// ─────────────────────────────────────────────
// 尺寸常量
// ─────────────────────────────────────────────

const DOT = 18;       // 压力点格子尺寸 px
const GAP = 2;        // 格子间距 px
const PALM_DOT = 16;  // 手掌格子尺寸 px
const FINGER_PAD = 4; // 红色框内边距 px

// 红色框内部宽度 = 3*DOT + 2*GAP
const FINGER_INNER_W = DOT * 3 + GAP * 2;
// 红色框外部宽度（含 padding）= FINGER_INNER_W + 2*FINGER_PAD
const FINGER_BLOCK_W = FINGER_INNER_W + FINGER_PAD * 2;
// 手指列间距
const FINGER_GAP = 6;

// ─────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────

export default function HandMatrix({
  side,
  adcValues,
  showIndex = true,
  selectedIndices,
  onToggleSelect,
}: HandMatrixProps) {
  const fingers = useMemo(() => (side === 'LH' ? LH_FINGERS : RH_FINGERS), [side]);
  const palmRows = useMemo(() => (side === 'LH' ? LH_PALM_ROWS : RH_PALM_ROWS), [side]);

  const getAdc = useCallback(
    (idx: number) => (adcValues && idx >= 1 ? adcValues[idx - 1] ?? 0 : 0),
    [adcValues],
  );

  const isSelected = useCallback(
    (idx: number) => selectedIndices?.has(idx) ?? false,
    [selectedIndices],
  );

  const handleClick = useCallback(
    (idx: number) => {
      onToggleSelect?.(idx);
    },
    [onToggleSelect],
  );

  const selectable = !!onToggleSelect;
  const selectedCount = selectedIndices?.size ?? 0;

  // 指尖区域总宽度
  const fingersAreaWidth = FINGER_BLOCK_W * 5 + FINGER_GAP * 4;

  return (
    <div
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 8,
        userSelect: 'none',
      }}
    >
      {/* ── 标题行 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: side === 'LH' ? 'oklch(0.72 0.20 200)' : 'oklch(0.72 0.20 145)',
            letterSpacing: '0.06em',
          }}
        >
          {side === 'LH' ? '◀ LH  Left Hand' : 'RH  Right Hand ▶'}
        </span>
        {selectedCount > 0 && (
          <span style={{ fontSize: '9px', color: 'oklch(0.72 0.20 145)' }}>
            已选 {selectedCount} 点
          </span>
        )}
        <span style={{ fontSize: '9px', color: 'oklch(0.40 0.02 240)' }}>
          {showIndex ? '格内显示原始编号' : ''}
        </span>
      </div>

      {/* ── 区域1：指尖压力（5根手指并排） ── */}
      <div>
        <div
          style={{
            fontSize: '8px',
            color: 'oklch(0.65 0.22 25)',
            marginBottom: 4,
            letterSpacing: '0.04em',
            fontWeight: 600,
          }}
        >
          ▌ 指尖压力区
        </div>
        <div style={{ display: 'flex', gap: FINGER_GAP, alignItems: 'flex-start' }}>
          {fingers.map((finger) => (
            <div
              key={finger.name}
              style={{
                width: FINGER_BLOCK_W,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {/* 手指名称 */}
              <span
                style={{
                  fontSize: '9px',
                  color: 'oklch(0.65 0.02 240)',
                  letterSpacing: '0.02em',
                  whiteSpace: 'nowrap',
                }}
              >
                {finger.name}
              </span>

              {/* 红色压力区域框 */}
              <div
                style={{
                  padding: FINGER_PAD,
                  background: 'oklch(0.65 0.22 25 / 0.08)',
                  border: '1.5px solid oklch(0.65 0.22 25 / 0.55)',
                  borderRadius: 5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: GAP,
                }}
              >
                {/* 4行 × 3列 */}
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} style={{ display: 'flex', gap: GAP }}>
                    {[0, 1, 2].map((col) => {
                      const idx = finger.pressure[row * 3 + col];
                      const adc = getAdc(idx);
                      const sel = isSelected(idx);
                      return (
                        <div
                          key={col}
                          title={`#${idx}  ADC: ${adc}${sel ? ' ✓已选' : ''}`}
                          onClick={() => handleClick(idx)}
                          style={{
                            width: DOT,
                            height: DOT,
                            background: adcToColor(adc, sel),
                            border: selectedBorder(sel),
                            borderRadius: 3,
                            boxShadow: selectedGlow(sel),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            cursor: selectable ? 'pointer' : 'default',
                            transition: 'background 0.12s, border 0.12s',
                          }}
                        >
                          {showIndex && (
                            <span
                              style={{
                                fontSize: '6px',
                                color: sel ? 'oklch(0.90 0.10 145)' : 'oklch(0.55 0.02 240)',
                                lineHeight: 1,
                                userSelect: 'none',
                                pointerEvents: 'none',
                              }}
                            >
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
          ))}
        </div>
      </div>

      {/* ── 区域2：弯折传感器（与指尖红色框精确中心对齐） ── */}
      <div>
        <div
          style={{
            fontSize: '8px',
            color: 'oklch(0.70 0.18 55)',
            marginBottom: 4,
            letterSpacing: '0.04em',
            fontWeight: 600,
          }}
        >
          ▌ 弯折传感器
        </div>
        <div style={{ display: 'flex', gap: FINGER_GAP, alignItems: 'flex-start' }}>
          {fingers.map((finger) => {
            const adc = getAdc(finger.flex);
            const pct = Math.round((adc / 255) * 100);
            const sel = isSelected(finger.flex);
            const isEdge = finger.name === '小拇指' || finger.name === '大拇指';
            return (
              <div
                key={finger.name}
                style={{
                  // 与上方 FingerBlock 完全相同的外层宽度
                  width: FINGER_BLOCK_W,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                {/* 彩色方块（居中在 FINGER_BLOCK_W 内） */}
                <div
                  title={`${finger.name}弯折 #${finger.flex}  ADC: ${adc}${sel ? ' ✓已选' : ''}`}
                  onClick={() => handleClick(finger.flex)}
                  style={{
                    width: FINGER_INNER_W,
                    height: DOT,
                    background: sel ? adcToColor(adc, true) : finger.color + '28',
                    border: sel
                      ? '2px solid oklch(0.72 0.22 145)'
                      : `2px solid ${finger.color}`,
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                    cursor: selectable ? 'pointer' : 'default',
                    boxShadow: selectedGlow(sel),
                    transition: 'background 0.12s, border 0.12s',
                  }}
                >
                  {/* 进度条背景 */}
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${pct}%`,
                      background: sel ? 'oklch(0.72 0.22 145 / 0.3)' : finger.color + '40',
                      transition: 'width 0.15s',
                    }}
                  />
                  {showIndex && (
                    <span
                      style={{
                        position: 'relative',
                        fontSize: '7px',
                        color: sel ? 'oklch(0.90 0.10 145)' : finger.color,
                        fontWeight: 700,
                        zIndex: 1,
                      }}
                    >
                      #{finger.flex}
                    </span>
                  )}
                </div>
                {/* 标签：小拇指和大拇指显示全名+高亮 */}
                <span
                  style={{
                    fontSize: isEdge ? '8px' : '7px',
                    color: isEdge ? finger.color : 'oklch(0.45 0.02 240)',
                    fontWeight: isEdge ? 700 : 400,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isEdge ? `◆ ${finger.name}` : finger.name.slice(-2)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 区域3：手掌（沿中指对齐） ── */}
      <div>
        <div
          style={{
            fontSize: '8px',
            color: 'oklch(0.60 0.06 265)',
            marginBottom: 4,
            letterSpacing: '0.04em',
            fontWeight: 600,
          }}
        >
          ▌ 手掌掌托区
        </div>
        <div
          style={{
            width: fingersAreaWidth,
            padding: '6px',
            background: 'oklch(0.20 0.03 265 / 0.6)',
            border: '1px solid oklch(0.35 0.05 265 / 0.6)',
            borderRadius: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: GAP,
            alignItems: 'center',
          }}
        >
          {palmRows.map((row, ri) => (
            <div key={ri} style={{ display: 'flex', gap: GAP }}>
              {row.map((idx) => {
                const adc = getAdc(idx);
                const sel = isSelected(idx);
                return (
                  <div
                    key={idx}
                    title={`#${idx}  ADC: ${adc}${sel ? ' ✓已选' : ''}`}
                    onClick={() => handleClick(idx)}
                    style={{
                      width: PALM_DOT,
                      height: PALM_DOT,
                      background: adcToColor(adc, sel),
                      border: sel
                        ? '2px solid oklch(0.72 0.22 145)'
                        : '1px solid oklch(0.32 0.04 265 / 0.7)',
                      borderRadius: 2,
                      boxShadow: selectedGlow(sel),
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: selectable ? 'pointer' : 'default',
                      transition: 'background 0.12s, border 0.12s',
                    }}
                  >
                    {showIndex && (
                      <span
                        style={{
                          fontSize: '5px',
                          color: sel ? 'oklch(0.90 0.10 145)' : 'oklch(0.50 0.02 240)',
                          lineHeight: 1,
                          pointerEvents: 'none',
                        }}
                      >
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
        {[0, 32, 64, 96, 128, 160, 192, 224, 255].map((v) => (
          <div
            key={v}
            style={{
              width: 12,
              height: 8,
              borderRadius: 1,
              background: adcToColor(v, false),
              border: '1px solid oklch(0.25 0.03 265)',
            }}
          />
        ))}
        <span style={{ fontSize: '7px', color: 'oklch(0.35 0.02 240)' }}>低</span>
        <span style={{ fontSize: '7px', color: 'oklch(0.35 0.02 240)', marginLeft: 'auto' }}>
          高
        </span>
        {selectable && (
          <>
            <span style={{ fontSize: '8px', color: 'oklch(0.40 0.02 240)', marginLeft: 8 }}>
              选中:
            </span>
            <div
              style={{
                width: 12,
                height: 8,
                borderRadius: 1,
                background: 'oklch(0.55 0.22 145)',
                border: '2px solid oklch(0.72 0.22 145)',
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
