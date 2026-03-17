/**
 * HandMatrix - 手形传感器矩阵可视化组件
 * 支持左手 (LH) 和右手 (RH) 两种布局
 * 将传感器原始数组编号映射到手形网格坐标
 * 实时显示各传感器点的 ADC 压力值
 *
 * v1.4.5 新增
 */
import { useMemo } from 'react';

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

export type HandSide = 'LH' | 'RH';

/** 网格单元格类型 */
type CellType =
  | 'empty'       // 空白（手形轮廓外）
  | 'pressure'    // 压力传感器（手指/手掌）
  | 'flex'        // 弯折传感器（彩色方块）
  | 'palm';       // 手掌压力传感器

/** 单元格定义 */
interface CellDef {
  type: CellType;
  /** 原始数组编号（1-based），用于从 ADC 数组取值 */
  arrayIndex: number;
  /** 所属部位标签 */
  label: string;
  /** 弯折传感器颜色（仅 flex 类型） */
  flexColor?: string;
  /** 所属手指（用于颜色分组） */
  finger?: 'thumb' | 'index' | 'middle' | 'ring' | 'pinky' | 'palm';
}

// ─────────────────────────────────────────────
// 左手布局定义 (LH)
// 网格 10 行 × 15 列（row 0-9, col 0-14）
// 手指从左到右：小拇指(0-2) 无名指(3-5) 中指(6-8) 食指(9-11) 大拇指(12-14)
// ─────────────────────────────────────────────

function buildLHLayout(): (CellDef | null)[][] {
  const grid: (CellDef | null)[][] = Array.from({ length: 10 }, () =>
    Array(15).fill(null)
  );

  const set = (r: number, c: number, def: CellDef) => {
    if (r >= 0 && r < 10 && c >= 0 && c < 15) grid[r][c] = def;
  };

  // 小拇指压力 [31,30,29,15,14,13,255,254,253,239,238,237]
  const pinkyLH = [31, 30, 29, 15, 14, 13, 255, 254, 253, 239, 238, 237];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      set(i, j, { type: 'pressure', arrayIndex: pinkyLH[i * 3 + j], label: '小拇指', finger: 'pinky' });
    }
  }

  // 无名指压力 [28,27,26,12,11,10,252,251,250,236,235,234]
  const ringLH = [28, 27, 26, 12, 11, 10, 252, 251, 250, 236, 235, 234];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      set(i, 3 + j, { type: 'pressure', arrayIndex: ringLH[i * 3 + j], label: '无名指', finger: 'ring' });
    }
  }

  // 中指压力 [25,24,23,9,8,7,249,248,247,233,232,231]
  const middleLH = [25, 24, 23, 9, 8, 7, 249, 248, 247, 233, 232, 231];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      set(i, 6 + j, { type: 'pressure', arrayIndex: middleLH[i * 3 + j], label: '中指', finger: 'middle' });
    }
  }

  // 食指压力 [22,21,20,6,5,4,246,245,244,230,229,228]
  const indexLH = [22, 21, 20, 6, 5, 4, 246, 245, 244, 230, 229, 228];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      set(i, 9 + j, { type: 'pressure', arrayIndex: indexLH[i * 3 + j], label: '食指', finger: 'index' });
    }
  }

  // 大拇指压力 [19,18,17,3,2,1,243,242,241,227,226,225] — 从 row 2 开始（偏下）
  const thumbLH = [19, 18, 17, 3, 2, 1, 243, 242, 241, 227, 226, 225];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      set(2 + i, 12 + j, { type: 'pressure', arrayIndex: thumbLH[i * 3 + j], label: '大拇指', finger: 'thumb' });
    }
  }

  // 弯折传感器（row 4，彩色方块）
  set(4, 1, { type: 'flex', arrayIndex: 222, label: '小拇指弯折', flexColor: '#7c3aed', finger: 'pinky' });
  set(4, 4, { type: 'flex', arrayIndex: 219, label: '无名指弯折', flexColor: '#0891b2', finger: 'ring' });
  set(4, 7, { type: 'flex', arrayIndex: 216, label: '中指弯折', flexColor: '#6b7280', finger: 'middle' });
  set(4, 10, { type: 'flex', arrayIndex: 213, label: '食指弯折', flexColor: '#dc2626', finger: 'index' });
  set(5, 13, { type: 'flex', arrayIndex: 210, label: '大拇指弯折', flexColor: '#16a34a', finger: 'thumb' });

  // 手掌 row 5-9
  // row 5: 207,206,205,204,203,202,201,200,199,198,197,196 (col 0-11)
  const palm5 = [207, 206, 205, 204, 203, 202, 201, 200, 199, 198, 197, 196];
  for (let j = 0; j < 12; j++) {
    set(5, j, { type: 'palm', arrayIndex: palm5[j], label: '手掌', finger: 'palm' });
  }

  // row 6: 191,190,...,177 (col 0-14, 15个)
  const palm6 = [191, 190, 189, 188, 187, 186, 185, 184, 183, 182, 181, 180, 179, 178, 177];
  for (let j = 0; j < 15; j++) {
    set(6, j, { type: 'palm', arrayIndex: palm6[j], label: '手掌', finger: 'palm' });
  }

  // row 7: 175,174,...,161 (col 0-14, 15个)
  const palm7 = [175, 174, 173, 172, 171, 170, 169, 168, 167, 166, 165, 164, 163, 162, 161];
  for (let j = 0; j < 15; j++) {
    set(7, j, { type: 'palm', arrayIndex: palm7[j], label: '手掌', finger: 'palm' });
  }

  // row 8: 159,158,...,145 (col 0-14, 15个)
  const palm8 = [159, 158, 157, 156, 155, 154, 153, 152, 151, 150, 149, 148, 147, 146, 145];
  for (let j = 0; j < 15; j++) {
    set(8, j, { type: 'palm', arrayIndex: palm8[j], label: '手掌', finger: 'palm' });
  }

  // row 9: 143,142,...,129 (col 0-14, 15个)
  const palm9 = [143, 142, 141, 140, 139, 138, 137, 136, 135, 134, 133, 132, 131, 130, 129];
  for (let j = 0; j < 15; j++) {
    set(9, j, { type: 'palm', arrayIndex: palm9[j], label: '手掌', finger: 'palm' });
  }

  return grid;
}

// ─────────────────────────────────────────────
// 右手布局定义 (RH)
// 网格 10 行 × 15 列（row 0-9, col 0-14）
// 手指从左到右：大拇指(0-2) 食指(3-5) 中指(6-8) 无名指(9-11) 小拇指(12-14)
// ─────────────────────────────────────────────

function buildRHLayout(): (CellDef | null)[][] {
  const grid: (CellDef | null)[][] = Array.from({ length: 10 }, () =>
    Array(15).fill(null)
  );

  const set = (r: number, c: number, def: CellDef) => {
    if (r >= 0 && r < 10 && c >= 0 && c < 15) grid[r][c] = def;
  };

  // 大拇指压力 [240,239,238,256,255,254,16,15,14,32,31,30] — 从 row 2 开始（偏下）
  const thumbRH = [240, 239, 238, 256, 255, 254, 16, 15, 14, 32, 31, 30];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      set(2 + i, j, { type: 'pressure', arrayIndex: thumbRH[i * 3 + j], label: '大拇指', finger: 'thumb' });
    }
  }

  // 食指压力 [237,236,235,253,252,251,13,12,11,29,28,27]
  const indexRH = [237, 236, 235, 253, 252, 251, 13, 12, 11, 29, 28, 27];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      set(i, 3 + j, { type: 'pressure', arrayIndex: indexRH[i * 3 + j], label: '食指', finger: 'index' });
    }
  }

  // 中指压力 [234,233,232,250,249,248,10,9,8,26,25,24]
  const middleRH = [234, 233, 232, 250, 249, 248, 10, 9, 8, 26, 25, 24];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      set(i, 6 + j, { type: 'pressure', arrayIndex: middleRH[i * 3 + j], label: '中指', finger: 'middle' });
    }
  }

  // 无名指压力 [231,230,229,247,246,245,7,6,5,23,22,21]
  const ringRH = [231, 230, 229, 247, 246, 245, 7, 6, 5, 23, 22, 21];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      set(i, 9 + j, { type: 'pressure', arrayIndex: ringRH[i * 3 + j], label: '无名指', finger: 'ring' });
    }
  }

  // 小拇指压力 [228,227,226,244,243,242,4,3,2,20,19,18]
  const pinkyRH = [228, 227, 226, 244, 243, 242, 4, 3, 2, 20, 19, 18];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      set(i, 12 + j, { type: 'pressure', arrayIndex: pinkyRH[i * 3 + j], label: '小拇指', finger: 'pinky' });
    }
  }

  // 弯折传感器
  set(5, 1, { type: 'flex', arrayIndex: 47, label: '大拇指弯折', flexColor: '#16a34a', finger: 'thumb' });
  set(4, 4, { type: 'flex', arrayIndex: 44, label: '食指弯折', flexColor: '#dc2626', finger: 'index' });
  set(4, 7, { type: 'flex', arrayIndex: 41, label: '中指弯折', flexColor: '#6b7280', finger: 'middle' });
  set(4, 10, { type: 'flex', arrayIndex: 38, label: '无名指弯折', flexColor: '#0891b2', finger: 'ring' });
  set(4, 13, { type: 'flex', arrayIndex: 35, label: '小拇指弯折', flexColor: '#7c3aed', finger: 'pinky' });

  // 手掌 row 5-9
  // row 5: 61,60,...,50 (col 3-14, 12个)
  const palm5 = [61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50];
  for (let j = 0; j < 12; j++) {
    set(5, 3 + j, { type: 'palm', arrayIndex: palm5[j], label: '手掌', finger: 'palm' });
  }

  // row 6: 80,79,...,66 (col 0-14, 15个)
  const palm6 = [80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70, 69, 68, 67, 66];
  for (let j = 0; j < 15; j++) {
    set(6, j, { type: 'palm', arrayIndex: palm6[j], label: '手掌', finger: 'palm' });
  }

  // row 7: 96,95,...,82 (col 0-14, 15个)
  const palm7 = [96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82];
  for (let j = 0; j < 15; j++) {
    set(7, j, { type: 'palm', arrayIndex: palm7[j], label: '手掌', finger: 'palm' });
  }

  // row 8: 112,111,...,98 (col 0-14, 15个)
  const palm8 = [112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100, 99, 98];
  for (let j = 0; j < 15; j++) {
    set(8, j, { type: 'palm', arrayIndex: palm8[j], label: '手掌', finger: 'palm' });
  }

  // row 9: 128,127,...,114 (col 0-14, 15个)
  const palm9 = [128, 127, 126, 125, 124, 123, 122, 121, 120, 119, 118, 117, 116, 115, 114];
  for (let j = 0; j < 15; j++) {
    set(9, j, { type: 'palm', arrayIndex: palm9[j], label: '手掌', finger: 'palm' });
  }

  return grid;
}

// ─────────────────────────────────────────────
// 颜色工具
// ─────────────────────────────────────────────

/** 根据 ADC 值（0-255）生成热力图颜色 */
function adcToColor(adc: number): string {
  const v = Math.min(255, Math.max(0, adc));
  if (v === 0) return 'oklch(0.18 0.03 265)';
  if (v < 127) {
    const t = v / 127;
    const hue = 260 - t * 115;
    const sat = 0.16 + t * 0.04;
    const light = 0.35 + t * 0.20;
    return `oklch(${light} ${sat} ${hue})`;
  }
  const t = (v - 127) / 128;
  const hue = 145 - t * 120;
  const sat = 0.20 + t * 0.02;
  const light = 0.55 - t * 0.05;
  return `oklch(${light} ${sat} ${hue})`;
}

/** 手指颜色（用于压力传感器边框区分） */
const FINGER_BORDER: Record<string, string> = {
  pinky: 'oklch(0.55 0.22 295)',   // 紫色
  ring: 'oklch(0.55 0.18 200)',    // 青色
  middle: 'oklch(0.55 0.02 240)',  // 灰色
  index: 'oklch(0.55 0.22 25)',    // 红色
  thumb: 'oklch(0.55 0.22 145)',   // 绿色
  palm: 'oklch(0.35 0.04 265)',    // 暗蓝
};

// ─────────────────────────────────────────────
// 组件 Props
// ─────────────────────────────────────────────

export interface HandMatrixProps {
  side: HandSide;
  /** 原始 ADC 数组，索引 0 对应数组编号 1（即 adcValues[arrayIndex - 1]） */
  adcValues: number[] | null;
  /** 是否显示数组编号 */
  showIndex?: boolean;
}

// ─────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────

export default function HandMatrix({ side, adcValues, showIndex = true }: HandMatrixProps) {
  const grid = useMemo(
    () => (side === 'LH' ? buildLHLayout() : buildRHLayout()),
    [side]
  );

  const ROWS = 10;
  const COLS = 15;
  const CELL_SIZE = 36; // px
  const GAP = 2;        // px

  const getAdc = (arrayIndex: number): number => {
    if (!adcValues || arrayIndex < 1) return 0;
    return adcValues[arrayIndex - 1] ?? 0;
  };

  const fingerLabels = side === 'LH'
    ? ['小拇指', '无名指', '中指', '食指', '大拇指']
    : ['大拇指', '食指', '中指', '无名指', '小拇指'];

  const fingerColors = side === 'LH'
    ? ['#7c3aed', '#0891b2', '#6b7280', '#dc2626', '#16a34a']
    : ['#16a34a', '#dc2626', '#6b7280', '#0891b2', '#7c3aed'];

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      {/* 标题 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span style={{
            fontSize: '11px', fontWeight: 700,
            color: side === 'LH' ? 'oklch(0.72 0.20 200)' : 'oklch(0.72 0.20 145)',
            letterSpacing: '0.08em',
          }}>
            {side === 'LH' ? '◀ LH  Left Hand' : 'RH  Right Hand ▶'}
          </span>
        </div>
        {/* 手指图例 */}
        <div className="flex items-center gap-2 flex-wrap">
          {fingerLabels.map((label, i) => (
            <div key={label} className="flex items-center gap-1">
              <div style={{ width: 8, height: 8, borderRadius: 2, background: fingerColors[i], flexShrink: 0 }} />
              <span style={{ fontSize: '9px', color: 'oklch(0.50 0.02 240)' }}>{label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <div style={{ width: 8, height: 8, borderRadius: 2, background: 'oklch(0.30 0.04 265)', border: '1px solid oklch(0.45 0.04 265)', flexShrink: 0 }} />
            <span style={{ fontSize: '9px', color: 'oklch(0.50 0.02 240)' }}>手掌</span>
          </div>
          <div className="flex items-center gap-1">
            <div style={{ width: 8, height: 8, borderRadius: 2, background: '#7c3aed', flexShrink: 0 }} />
            <span style={{ fontSize: '9px', color: 'oklch(0.50 0.02 240)' }}>弯折</span>
          </div>
        </div>
      </div>

      {/* 手指标签行 */}
      <div className="flex mb-1" style={{ paddingLeft: '0px', gap: `${GAP}px` }}>
        {Array.from({ length: COLS }, (_, c) => {
          // 确定该列属于哪根手指
          let fingerIdx = -1;
          if (side === 'LH') {
            if (c <= 2) fingerIdx = 0;       // 小拇指
            else if (c <= 5) fingerIdx = 1;  // 无名指
            else if (c <= 8) fingerIdx = 2;  // 中指
            else if (c <= 11) fingerIdx = 3; // 食指
            else fingerIdx = 4;              // 大拇指
          } else {
            if (c <= 2) fingerIdx = 0;       // 大拇指
            else if (c <= 5) fingerIdx = 1;  // 食指
            else if (c <= 8) fingerIdx = 2;  // 中指
            else if (c <= 11) fingerIdx = 3; // 无名指
            else fingerIdx = 4;              // 小拇指
          }
          // 只在每组3列的中间列显示标签
          const showLabel = c % 3 === 1;
          return (
            <div
              key={c}
              style={{
                width: CELL_SIZE,
                flexShrink: 0,
                textAlign: 'center',
                fontSize: '8px',
                color: showLabel ? fingerColors[fingerIdx] : 'transparent',
                fontWeight: 600,
                height: '14px',
                lineHeight: '14px',
              }}
            >
              {showLabel ? fingerLabels[fingerIdx] : ''}
            </div>
          );
        })}
      </div>

      {/* 矩阵网格 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: `${GAP}px` }}>
        {Array.from({ length: ROWS }, (_, r) => (
          <div key={r} style={{ display: 'flex', gap: `${GAP}px` }}>
            {Array.from({ length: COLS }, (_, c) => {
              const cell = grid[r][c];

              if (!cell) {
                // 空白格
                return (
                  <div
                    key={c}
                    style={{
                      width: CELL_SIZE,
                      height: CELL_SIZE,
                      flexShrink: 0,
                      background: 'transparent',
                    }}
                  />
                );
              }

              const adc = getAdc(cell.arrayIndex);
              const adcHex = adc.toString(16).toUpperCase().padStart(2, '0');

              if (cell.type === 'flex') {
                // 弯折传感器：彩色方块，显示编号和值
                return (
                  <div
                    key={c}
                    title={`${cell.label} #${cell.arrayIndex} ADC:${adc}`}
                    style={{
                      width: CELL_SIZE,
                      height: CELL_SIZE,
                      flexShrink: 0,
                      background: cell.flexColor + '33',
                      border: `2px solid ${cell.flexColor}`,
                      borderRadius: 4,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'default',
                      position: 'relative',
                    }}
                  >
                    {showIndex && (
                      <span style={{ fontSize: '7px', color: cell.flexColor, fontWeight: 700, lineHeight: 1 }}>
                        #{cell.arrayIndex}
                      </span>
                    )}
                    <span style={{ fontSize: '8px', color: '#fff', fontWeight: 600, lineHeight: 1.2 }}>
                      {adc}
                    </span>
                  </div>
                );
              }

              // 压力传感器（pressure / palm）
              const bgColor = adcToColor(adc);
              const borderColor = FINGER_BORDER[cell.finger ?? 'palm'];

              return (
                <div
                  key={c}
                  title={`${cell.label} #${cell.arrayIndex} ADC:${adc} (0x${adcHex})`}
                  style={{
                    width: CELL_SIZE,
                    height: CELL_SIZE,
                    flexShrink: 0,
                    background: bgColor,
                    border: `1px solid ${borderColor}`,
                    borderRadius: cell.type === 'palm' ? 3 : 4,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'default',
                    transition: 'background 0.1s',
                  }}
                >
                  {showIndex && (
                    <span style={{
                      fontSize: '6px',
                      color: 'oklch(0.60 0.02 240)',
                      lineHeight: 1,
                      fontWeight: 500,
                    }}>
                      #{cell.arrayIndex}
                    </span>
                  )}
                  <span style={{
                    fontSize: adc > 0 ? '9px' : '8px',
                    color: adc > 0 ? 'oklch(0.92 0.01 220)' : 'oklch(0.38 0.02 240)',
                    fontWeight: adc > 0 ? 700 : 400,
                    lineHeight: 1.2,
                  }}>
                    {adc > 0 ? adc : '·'}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* 底部图例：ADC 热力图色阶 */}
      <div className="flex items-center gap-2 mt-2 pt-1.5" style={{ borderTop: '1px solid oklch(0.20 0.03 265)' }}>
        <span style={{ fontSize: '8px', color: 'oklch(0.40 0.02 240)' }}>ADC:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {[0, 32, 64, 96, 128, 160, 192, 224, 255].map(v => (
            <div key={v} style={{
              width: 14, height: 10, borderRadius: 2,
              background: adcToColor(v),
              border: '1px solid oklch(0.25 0.03 265)',
            }} />
          ))}
        </div>
        <span style={{ fontSize: '7px', color: 'oklch(0.38 0.02 240)' }}>0</span>
        <span style={{ fontSize: '7px', color: 'oklch(0.38 0.02 240)', marginLeft: 'auto' }}>255</span>
        <span style={{ fontSize: '8px', color: 'oklch(0.40 0.02 240)', marginLeft: 8 }}>
          彩色方块 = 弯折传感器
        </span>
      </div>
    </div>
  );
}
