export const SERIES_COLORS = [
  'var(--jk-accent)',  // 蓝
  'var(--jk-ok)',  // 绿
  'var(--jk-danger)',   // 橙红
  'oklch(0.68 0.20 300)',  // 紫
  'oklch(0.75 0.18 80)',   // 黄
  'oklch(0.65 0.20 350)',  // 粉红
  'var(--jk-accent-2)',  // 青
  'oklch(0.60 0.22 50)',   // 深橙
  'var(--jk-primary)',  // 淡蓝紫
  'oklch(0.68 0.20 120)',  // 黄绿
  'oklch(0.60 0.18 330)',  // 玫红
  'var(--jk-ink)',  // 天蓝
  'oklch(0.65 0.20 70)',   // 琥珀
  'oklch(0.58 0.22 280)',  // 靛蓝
  'oklch(0.72 0.18 160)',  // 翠绿
  'oklch(0.62 0.20 10)',   // 红
  'var(--jk-primary)',  // 钢蓝
  'oklch(0.68 0.18 100)',  // 柠檬绿
  'oklch(0.60 0.20 310)',  // 紫罗兰
  'var(--jk-accent)',  // 浅青
];

export const FIT_CURVE_COLOR = 'var(--jk-fit)';
export const CALIBRATION_COLOR = 'var(--jk-ink)';
export const MAX_DISPLAY_POINTS_PER_SERIES = 200;

export function fileSeriesColor(index: number) {
  const paletteIndex = index === 0 ? 1 : index === 1 ? 0 : index;
  return SERIES_COLORS[paletteIndex % SERIES_COLORS.length];
}

export function seriesLine(color: string, dashed = false) {
  return dashed ? { stroke: color, strokeWidth: 2, strokeDasharray: '6 3' } : { stroke: color, strokeWidth: 1.5 };
}

export interface CurveLegendItem {
  key: string;
  label: string;
  color: string;
  shape: 'samples' | 'line' | 'dashed' | 'points';
}

export function CurveLegendItems({ items }: { items: readonly CurveLegendItem[] }) {
  return <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-1">
    {items.map(item => <div key={item.key} className="flex min-w-0 items-center gap-1.5" style={{ font: "10px 'IBM Plex Mono', monospace", color: item.color }}>
      <svg width="20" height="10" aria-hidden="true" className="shrink-0">
        {item.shape !== 'points' && <line x1="0" y1="5" x2="20" y2="5" stroke={item.color} strokeWidth={item.shape === 'dashed' ? 2 : 1.5} strokeDasharray={item.shape === 'dashed' ? '4 2' : undefined} />}
        {(item.shape === 'samples' || item.shape === 'points') && <circle cx="10" cy="5" r="3" fill={item.color} />}
      </svg>
      <span className="truncate" title={item.label}>{item.label}</span>
    </div>)}
  </div>;
}
