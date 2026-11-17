/**
 * SensorMatrix - 传感器数组点阵展示/选择组件
 * 支持最大64×64传感器矩阵，横纵点阵0-64可设置
 * 数据按 AA 55 03 99 帧头分隔，数组按点阵展示
 * 支持单点选取和多点矩形框选
 * 选中点显示在数组中的第几位（从1开始）
 * 支持点击放大查看局部区域详情
 */
import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';
import { SensorPoint } from '@/lib/sensorData';
import { Settings2, Grid3x3, ZoomIn, X } from 'lucide-react';

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  sensor: SensorPoint | null;
}

interface BoxSelectState {
  active: boolean;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

interface ZoomState {
  active: boolean;
  centerRow: number;
  centerCol: number;
  radius: number; // 放大区域半径（向四周扩展的行/列数）
}

export interface SensorMatrixProps {
  sensors: SensorPoint[];
  rows: number;
  cols: number;
  onSelectionChange: (sensors: SensorPoint[]) => void;
  onResize?: (rows: number, cols: number) => void;
  realtimeMatrix?: number[][];
  isConnected?: boolean;
}

export default function SensorMatrix({ sensors, rows, cols, onSelectionChange, onResize, realtimeMatrix, isConnected }: SensorMatrixProps) {
  // 拖拽框选状态（统一交互模式：单击选点 / Ctrl+多选 / 拖拽框选 / 右键清除）
  const [boxSelect, setBoxSelect] = useState<BoxSelectState>({ active: false, startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
  const [showSizeEditor, setShowSizeEditor] = useState(false);
  const [editRows, setEditRows] = useState(rows);
  const [editCols, setEditCols] = useState(cols);
  const [displayMode, setDisplayMode] = useState<'index' | 'value' | 'off'>('index');
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, sensor: null });
  const [zoom, setZoom] = useState<ZoomState>({ active: false, centerRow: 0, centerCol: 0, radius: 3 });
  const containerRef = useRef<HTMLDivElement>(null);

  // 自适应格子尺寸：按容器实际可用空间等比缩放，保证任何矩阵尺寸（含 64×64）都不出现滚动条
  const [fitBox, setFitBox] = useState({ w: 0, h: 0 });
  // 矩阵网格列的实际高度：用于把右侧「已选点位」面板钉成同样高，避免面板内容撑高容器
  const gridColRef = useRef<HTMLDivElement>(null);
  const [gridH, setGridH] = useState(0);
  useEffect(() => {
    const el = gridColRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const h = Math.round(entries[0].contentRect.height);
      setGridH(prev => (Math.abs(prev - h) < 1 ? prev : h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 视口高度单独跟踪：矩阵卡片高度随内容撑开，格子尺寸不能反过来依赖容器高度
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const sync = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect;
      setFitBox(prev =>
        Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
          ? prev
          : { w: r.width, h: r.height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 拖拽判定
  const mouseDownRef = useRef<{ row: number; col: number; ctrl: boolean } | null>(null);
  const dragDistanceRef = useRef(0);

  const selectedCount = sensors.filter(s => s.selected).length;
  const totalCount = sensors.length;

  // 计算数组位序：行优先，从1开始
  const getArrayIndex = (row: number, col: number) => row * cols + col + 1;

  // ADC颜色映射：未选中 0蓝色→127绿色→255红色；选中 绿色高亮
  const getAdcColor = (adcValue: number, selected: boolean) => {
    const v = Math.min(255, Math.max(0, adcValue));
    // 选中的传感器点：蓝变绿（思维导图要求）
    if (selected) {
      const intensity = Math.max(0.3, v / 255);
      return {
        bg: `oklch(${0.40 + intensity * 0.35} 0.22 145)`,
        border: `oklch(${0.55 + intensity * 0.30} 0.18 145)`,
        glow: `0 0 5px oklch(0.72 0.22 145 / ${0.4 + intensity * 0.4})`,
      };
    }
    // 未选中：蓝色系热力图
    if (v === 0) return { bg: 'var(--jk-s2)', border: 'var(--jk-line-1)', glow: 'none' };
    let hue: number, sat: number, light: number;
    if (v < 127) {
      const t = v / 127;
      hue = 260 - t * 115; sat = 0.16 + t * 0.04; light = 0.35 + t * 0.20;
    } else {
      const t = (v - 127) / 128;
      hue = 145 - t * 120; sat = 0.20 + t * 0.02; light = 0.55 - t * 0.05;
    }
    return {
      bg: `oklch(${light} ${sat} ${hue})`,
      border: `oklch(${light + 0.12} ${sat - 0.02} ${hue})`,
      glow: v > 180 ? `0 0 3px oklch(0.60 0.20 25 / ${(v - 180) / 200})` : 'none',
    };
  };

  // 获取实时ADC值（优先使用串口数据）
  const getAdcValue = (row: number, col: number, fallback: number) => {
    if (realtimeMatrix && realtimeMatrix.length > 0) {
      const srcRows = realtimeMatrix.length;
      const srcCols = realtimeMatrix[0]?.length ?? 0;
      if (srcRows > 0 && srcCols > 0) {
        const srcR = Math.min(Math.floor(row * srcRows / rows), srcRows - 1);
        const srcC = Math.min(Math.floor(col * srcCols / cols), srcCols - 1);
        return realtimeMatrix[srcR]?.[srcC] ?? fallback;
      }
    }
    return fallback;
  };

  // 切换单个传感器选中状态（Ctrl+多选用）
  const toggleSensor = useCallback((id: string) => {
    const updated = sensors.map(s =>
      s.id === id ? { ...s, selected: !s.selected } : s
    );
    onSelectionChange(updated);
  }, [sensors, onSelectionChange]);

  // 统一交互：单击选点 / Ctrl+多选 / 拖拽框选 / Ctrl+拖拽追加框选 / 右键清除
  const handleMouseDown = (row: number, col: number, id: string, e: React.MouseEvent) => {
    e.preventDefault();
    const withCtrl = e.ctrlKey || e.metaKey;
    mouseDownRef.current = { row, col, ctrl: withCtrl };
    dragDistanceRef.current = 0;

    if (withCtrl) {
      // Ctrl+单击 → 切换该点（同时开始框选追踪，拖拽即转为追加框选）
      toggleSensor(id);
    } else {
      // 普通单击 → 选中该点，清除其他
      const updated = sensors.map(s => ({ ...s, selected: s.id === id }));
      onSelectionChange(updated);
    }

    // 开始框选追踪
    setBoxSelect({ active: true, startRow: row, startCol: col, endRow: row, endCol: col });
  };

  const handleMouseEnterCell = (row: number, col: number, _id: string) => {
    if (!mouseDownRef.current || !boxSelect.active) return;
    dragDistanceRef.current += 1;

    setBoxSelect(prev => {
      if (!prev.active) return prev;
      return { ...prev, endRow: row, endCol: col };
    });
  };

  const handleMouseUp = () => {
    if (!mouseDownRef.current) return;
    const wasDragging = dragDistanceRef.current > 2;
    const withCtrl = mouseDownRef.current.ctrl;
    mouseDownRef.current = null;
    dragDistanceRef.current = 0;

    if (boxSelect.active && wasDragging) {
      const minR = Math.min(boxSelect.startRow, boxSelect.endRow);
      const maxR = Math.max(boxSelect.startRow, boxSelect.endRow);
      const minC = Math.min(boxSelect.startCol, boxSelect.endCol);
      const maxC = Math.max(boxSelect.startCol, boxSelect.endCol);
      if (withCtrl) {
        // Ctrl+拖拽 → 追加框选（不清除已有选择）
        const updated = sensors.map(s => {
          if (s.row >= minR && s.row <= maxR && s.col >= minC && s.col <= maxC) {
            return { ...s, selected: true };
          }
          return s;
        });
        onSelectionChange(updated);
      } else {
        // 普通拖拽 → 替换框选
        const updated = sensors.map(s => ({
          ...s,
          selected: s.row >= minR && s.row <= maxR && s.col >= minC && s.col <= maxC,
        }));
        onSelectionChange(updated);
      }
    }
    setBoxSelect({ active: false, startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
  };

  // 右键清除所有选择
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    clearAll();
  };

  // ref 代理：始终指向最新的 handleMouseUp，避免闭包过期
  const handleMouseUpRef = useRef(handleMouseUp);
  handleMouseUpRef.current = handleMouseUp;

  // 全局 mouseup：拖拽超出矩阵区域时也能完成框选（只注册一次）
  useEffect(() => {
    const onGlobalMouseUp = () => handleMouseUpRef.current();
    window.addEventListener('mouseup', onGlobalMouseUp);
    return () => window.removeEventListener('mouseup', onGlobalMouseUp);
  }, []);

  const isInBoxSelection = (row: number, col: number) => {
    if (!boxSelect.active) return false;
    const minR = Math.min(boxSelect.startRow, boxSelect.endRow);
    const maxR = Math.max(boxSelect.startRow, boxSelect.endRow);
    const minC = Math.min(boxSelect.startCol, boxSelect.endCol);
    const maxC = Math.max(boxSelect.startCol, boxSelect.endCol);
    return row >= minR && row <= maxR && col >= minC && col <= maxC;
  };

  // 悬停弹出框
  const handleSensorHoverEnter = useCallback((e: React.MouseEvent, sensor: SensorPoint) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ visible: true, x: e.clientX - rect.left, y: e.clientY - rect.top, sensor });
  }, []);

  const handleSensorHoverMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip(prev => prev.visible ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top } : prev);
  }, []);

  const handleSensorHoverLeave = useCallback(() => {
    setTooltip({ visible: false, x: 0, y: 0, sensor: null });
  }, []);

  // 放大查看：双击传感器点触发，以该点为中心放大显示周围区域
  const handleDoubleClick = (row: number, col: number) => {
    setZoom({ active: true, centerRow: row, centerCol: col, radius: 3 });
  };

  // 放大视图中的双击：以双击位置为新中心
  const handleZoomDoubleClick = (row: number, col: number) => {
    setZoom(prev => ({ ...prev, centerRow: row, centerCol: col }));
  };

  // 快速选择
  const selectAll = () => onSelectionChange(sensors.map(s => ({ ...s, selected: true })));
  const clearAll = () => onSelectionChange(sensors.map(s => ({ ...s, selected: false })));
  const selectRegion = (region: 'center' | 'edge') => {
    const centerRows = [Math.floor(rows / 4), Math.floor(rows * 3 / 4)];
    const centerCols = [Math.floor(cols / 4), Math.floor(cols * 3 / 4)];
    onSelectionChange(sensors.map(s => {
      if (region === 'center') {
        return { ...s, selected: s.row >= centerRows[0] && s.row < centerRows[1] && s.col >= centerCols[0] && s.col < centerCols[1] };
      } else {
        return { ...s, selected: s.row < 2 || s.row >= rows - 2 || s.col < 2 || s.col >= cols - 2 };
      }
    }));
  };

  const handleApplySize = () => {
    const r = Math.min(64, Math.max(0, editRows));
    const c = Math.min(64, Math.max(0, editCols));
    onResize?.(r, c);
    setShowSizeEditor(false);
  };

  // 自适应格子尺寸的固定开销常量
  const maxDim = Math.max(rows, cols);
  const GAP = 1;
  const PAD = 16;        // 容器 p-2 左右内边距
  const rowLabelW = Math.max(20, String(rows).length * 8 + 8);
  const showLabels = maxDim <= 32;

  // 高度预算来自视口（矩阵卡片本身随内容撑开，因此不能反过来用容器高度定尺寸，
  // 否则卡片高度和格子尺寸互为因果）。CHROME_H ≈ 卡片外的固定占用 + 卡片内标题/图例。
  const CHROME_H = 400;
  const heightBudget = Math.max(200, (viewport.h || 900) - CHROME_H);

  // 缓存已选传感器的数组索引列表
  const selectedIndices = useMemo(
    () => sensors.filter(s => s.selected).map(s => getArrayIndex(s.row, s.col)).sort((a, b) => a - b),
    [sensors, cols]
  );

  // 有选中就把「已选点位」放到矩阵右侧（不占纵向空间）；
  // 面板宽度优先吃掉「按高度算完格子后剩下的空白」，实在不够才最少占 150px
  const fallbackSize = maxDim > 32 ? 6 : maxDim > 16 ? 10 : maxDim > 8 ? 14 : 20;
  const dotSizeByH = Math.max(3, Math.min(40, Math.floor((heightBudget / rows) * 2) / 2));
  const gridWByH = rowLabelW + cols * dotSizeByH + (cols - 1) * GAP;
  const leftoverW = fitBox.w > 0 ? fitBox.w - PAD - gridWByH - 10 : 0;

  // 面板常驻（不随选中状态出现/消失），否则矩阵会因可用宽度变化而左右跳动
  const showSidePanel = fitBox.w > 0;
  const sidePanelW = showSidePanel
    ? Math.min(300, Math.max(150, Math.floor(leftoverW)))
    : 0;

  const availW = fitBox.w > 0
    ? fitBox.w - rowLabelW - (cols - 1) * GAP - PAD - (sidePanelW ? sidePanelW + 10 : 4)
    : 0;
  const fitted = Math.min(availW / cols, heightBudget / rows);
  // 用 0.5px 步长而不是整数截断：整数取整会在低分辨率窗口下留下十几到几十 px 的死白
  const dotSize = fitBox.w > 0 && fitted > 2
    ? Math.max(3, Math.min(40, Math.floor(fitted * 2) / 2))
    : fallbackSize;

  const showAxisLabels = showLabels && dotSize >= 7;      // 行列号太挤时隐藏
  const showLabelInDot = maxDim <= 16 && displayMode !== 'off' && dotSize >= 11;

  // 缓存颜色计算结果
  const colorCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof getAdcColor>>();
    sensors.forEach(s => {
      const adcVal = getAdcValue(s.row, s.col, s.adcValue);
      const key = `${adcVal}-${s.selected}`;
      if (!cache.has(key)) {
        cache.set(key, getAdcColor(adcVal, s.selected));
      }
    });
    return cache;
  }, [sensors, realtimeMatrix]);

  // 放大视图的区域范围
  const getZoomRange = () => {
    const r = zoom.radius;
    const minR = Math.max(0, zoom.centerRow - r);
    const maxR = Math.min(rows - 1, zoom.centerRow + r);
    const minC = Math.max(0, zoom.centerCol - r);
    const maxC = Math.min(cols - 1, zoom.centerCol + r);
    return { minR, maxR, minC, maxC };
  };

  // 渲染单个传感器点（共用于主矩阵和放大视图）
  const renderDot = (r: number, c: number, size: number, showIdx: boolean, isZoomView: boolean = false) => {
    const sensor = sensors.find(s => s.row === r && s.col === c);
    if (!sensor) return null;
    const adcVal = getAdcValue(r, c, sensor.adcValue);
    const cacheKey = `${adcVal}-${sensor.selected}`;
    const colors = colorCache.get(cacheKey) || getAdcColor(adcVal, sensor.selected);
    const inBox = isInBoxSelection(r, c);
    const arrayIdx = getArrayIndex(r, c);
    const hexVal = adcVal.toString(16).toUpperCase().padStart(2, '0');
    const isZoomCenter = isZoomView && r === zoom.centerRow && c === zoom.centerCol;

    return (
      <div
        key={sensor.id}
        className="flex-shrink-0 flex flex-col items-center justify-center relative"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          background: inBox ? 'color-mix(in srgb, var(--jk-primary) 40%, transparent)' : colors.bg,
          border: isZoomCenter
            ? '2px solid var(--jk-warn)'
            : `1px solid ${inBox ? 'var(--jk-accent)' : colors.border}`,
          boxShadow: isZoomCenter
            ? '0 0 8px color-mix(in srgb, var(--jk-warn) 50%, transparent)'
            : inBox ? '0 0 3px color-mix(in srgb, var(--jk-primary) 50%, transparent)' : colors.glow,
          cursor: 'pointer',
          borderRadius: '2px',
          transition: 'background 0.08s, box-shadow 0.08s',
        }}
        onMouseDown={(e) => handleMouseDown(r, c, sensor.id, e)}
        onMouseEnter={(e) => { handleMouseEnterCell(r, c, sensor.id); if (!isZoomView) handleSensorHoverEnter(e, sensor); }}
        onMouseMove={!isZoomView ? handleSensorHoverMove : undefined}
        onMouseLeave={!isZoomView ? handleSensorHoverLeave : undefined}
        onDoubleClick={() => isZoomView ? handleZoomDoubleClick(r, c) : handleDoubleClick(r, c)}
        onContextMenu={handleContextMenu}
      >
        {/* 放大视图：显示ADC值 */}
        {isZoomView && size >= 36 && (
          <div className="flex flex-col items-center gap-0" style={{ lineHeight: 1 }}>
            <span style={{
              fontSize: size > 44 ? '8px' : '6px',
              color: sensor.selected ? 'var(--jk-ok)' : 'var(--jk-text-strong)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 700,
            }}>
              {adcVal}
            </span>
            <span style={{
              fontSize: size > 44 ? '7px' : '5px',
              color: sensor.selected ? 'var(--jk-ok)' : 'var(--jk-text-mid)',
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
              0x{hexVal}
            </span>
            <span style={{
              fontSize: '5px',
              color: sensor.selected ? 'var(--jk-ok)' : 'var(--jk-text-dim)',
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
              #{arrayIdx}
            </span>
          </div>
        )}
        {/* 主矩阵：显示数组位序或ADC数值 */}
        {!isZoomView && showIdx && (
          <span style={{
            fontSize: size > 16 ? '7px' : '5px',
            color: sensor.selected ? 'var(--jk-ok)' : adcVal > 127 ? 'var(--jk-s1)' : 'var(--jk-text-body)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 600,
            lineHeight: 1,
          }}>
            {displayMode === 'value' ? adcVal : arrayIdx}
          </span>
        )}
      </div>
    );
  };

  // 已选点位面板：常驻在矩阵右侧（即使没有选中也占位），
  // 否则「清空 / 选中」切换时矩阵会因为可用宽度变化而左右跳动
  const selectedListPanel = (
    <div
      className="rounded p-2 h-full flex flex-col min-h-0"
      style={{ background: 'var(--jk-s1)', border: '1px solid var(--jk-s4)' }}
    >
      <div className="flex items-center justify-between mb-1 flex-shrink-0">
        <span className="text-xs font-mono" style={{ color: 'var(--jk-text-body)', fontSize: '10px' }}>
          已选 {selectedIndices.length} 个传感器点 · 数组位序:
        </span>
      </div>
      <div className="flex flex-wrap gap-0.5 content-start flex-1 min-h-0" style={{ overflowY: 'auto' }}>
        {selectedIndices.length === 0 ? (
          <span style={{ color: 'var(--jk-text-faint)', fontSize: '9px', fontFamily: "'IBM Plex Mono', monospace" }}>
            点击或拖拽选择传感器点
          </span>
        ) : selectedIndices.map(idx => {
          const sensor = sensors.find(s => getArrayIndex(s.row, s.col) === idx);
          if (!sensor) return null;
          return (
            <span
              key={idx}
              className="px-1 py-0.5 text-xs font-mono rounded flex-shrink-0"
              style={{
                background: 'color-mix(in srgb, var(--jk-ok) 12%, transparent)',
                color: 'var(--jk-ok)',
                border: '1px solid color-mix(in srgb, var(--jk-ok) 25%, transparent)',
                fontSize: '9px',
              }}
              title={`R${sensor.row + 1}·C${sensor.col + 1} = 数组第${idx}位`}
            >
              #{idx}
            </span>
          );
        })}
      </div>
      {selectedIndices.length > 0 && (
        <div className="mt-1 text-xs font-mono flex-shrink-0" style={{ color: 'var(--jk-text-dim)', fontSize: '9px' }}>
          范围: #{selectedIndices[0]} ~ #{selectedIndices[selectedIndices.length - 1]}
          {' '}| ADC Sum(Hex): 0x{sensors.filter(s => s.selected).reduce((sum, s) => sum + getAdcValue(s.row, s.col, s.adcValue), 0).toString(16).toUpperCase().padStart(4, '0')}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Grid3x3 size={12} style={{ color: 'var(--jk-accent)' }} />
          <span className="text-xs font-mono" style={{ color: 'var(--jk-text-high)' }}>传感器数组</span>
          <span className="text-xs font-mono font-medium" style={{ color: 'var(--jk-accent)' }}>
            {rows}×{cols}
          </span>
          {isConnected && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--jk-ok)' }} />
              <span style={{ color: 'var(--jk-ok)', fontSize: '8px', fontFamily: "'IBM Plex Mono', monospace" }}>实时</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* 交互提示 */}
          <span className="text-xs font-mono" style={{ color: 'var(--jk-text-dim)', fontSize: '9px' }}>
            拖拽框选 · Ctrl+拖拽追加 · 单击选点 · 右键清除
          </span>
          {/* 尺寸按钮 */}
          {onResize && (
            <button
              onClick={() => { setEditRows(rows); setEditCols(cols); setShowSizeEditor(!showSizeEditor); }}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-mono transition-colors"
              style={{
                background: showSizeEditor ? 'color-mix(in srgb, var(--jk-primary) 20%, transparent)' : 'var(--jk-s3)',
                border: `1px solid ${showSizeEditor ? 'color-mix(in srgb, var(--jk-primary) 50%, transparent)' : 'var(--jk-line-2)'}`,
                color: showSizeEditor ? 'var(--jk-accent)' : 'var(--jk-text-low)',
                fontSize: '9px',
              }}
              title="设置矩阵尺寸（最大64×64）"
            >
              <Settings2 size={9} />
              <span style={{ fontSize: '9px' }}>尺寸</span>
            </button>
          )}
        </div>
      </div>

      {/* 选中统计栏 */}
      <div className="flex items-center justify-between px-2 py-1 rounded" style={{ background: 'var(--jk-s1)', border: '1px solid var(--jk-s4)' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono" style={{ color: 'var(--jk-text-mid)', fontSize: '10px' }}>
            已选: <span style={{ color: 'var(--jk-ok)', fontWeight: 600 }}>{selectedCount}</span>
            <span style={{ color: 'var(--jk-text-dim)' }}>/{totalCount}</span>
          </span>
          {selectedCount > 0 && (
            <span className="text-xs font-mono" style={{ color: 'var(--jk-text-body)', fontSize: '9px' }}>
              ADC Sum: <span style={{ color: 'var(--jk-accent)' }}>
                {sensors.filter(s => s.selected).reduce((sum, s) => sum + getAdcValue(s.row, s.col, s.adcValue), 0)}
              </span>
              <span style={{ color: 'var(--jk-text-low)', marginLeft: '4px' }}>
                (0x{sensors.filter(s => s.selected).reduce((sum, s) => sum + getAdcValue(s.row, s.col, s.adcValue), 0).toString(16).toUpperCase().padStart(4, '0')})
              </span>
            </span>
          )}
        </div>
        <button
          onClick={() => setDisplayMode(prev => prev === 'index' ? 'value' : prev === 'value' ? 'off' : 'index')}
          className="text-xs font-mono px-1.5 py-0.5 rounded transition-colors"
          style={{
            background: displayMode !== 'off' ? 'color-mix(in srgb, var(--jk-accent) 12%, transparent)' : 'transparent',
            color: displayMode !== 'off' ? 'var(--jk-accent)' : 'var(--jk-text-dim)',
            fontSize: '9px',
            border: `1px solid ${displayMode !== 'off' ? 'color-mix(in srgb, var(--jk-accent) 30%, transparent)' : 'var(--jk-line-1)'}`,
          }}
          title="切换显示: 序号 → 数值 → 关闭"
        >
          {displayMode === 'index' ? '#序号' : displayMode === 'value' ? '#数值' : '#关闭'}
        </button>
      </div>

      {/* 矩阵尺寸编辑器 */}
      {showSizeEditor && (
        <div className="rounded p-2.5 space-y-2" style={{ background: 'var(--jk-s2)', border: '1px solid var(--jk-line-3)' }}>
          <div className="text-xs font-mono" style={{ color: 'var(--jk-text-body)' }}>
            矩阵尺寸设置（0-64）
          </div>
          <div className="flex gap-2 items-center">
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-xs font-mono" style={{ color: 'var(--jk-text-mid)' }}>横</span>
              <input
                type="number"
                value={editCols}
                min={0} max={64}
                onChange={e => setEditCols(Math.min(64, Math.max(0, parseInt(e.target.value) || 0)))}
                className="flex-1 text-center text-xs font-mono rounded px-1 py-0.5 outline-none"
                style={{ background: 'var(--jk-sunken)', border: '1px solid var(--jk-line-2)', color: 'var(--jk-ink)' }}
              />
            </div>
            <span className="text-xs font-mono" style={{ color: 'var(--jk-text-dim)' }}>×</span>
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-xs font-mono" style={{ color: 'var(--jk-text-mid)' }}>纵</span>
              <input
                type="number"
                value={editRows}
                min={0} max={64}
                onChange={e => setEditRows(Math.min(64, Math.max(0, parseInt(e.target.value) || 0)))}
                className="flex-1 text-center text-xs font-mono rounded px-1 py-0.5 outline-none"
                style={{ background: 'var(--jk-sunken)', border: '1px solid var(--jk-line-2)', color: 'var(--jk-ink)' }}
              />
            </div>
          </div>
          <div className="text-xs font-mono" style={{ color: 'var(--jk-text-dim)', fontSize: '9px' }}>
            共 {editRows * editCols} 个传感器点（最大64×64=4096）
          </div>
          <div className="flex gap-2">
            <button onClick={handleApplySize} className="flex-1 py-1 rounded text-xs font-mono" style={{ background: 'var(--jk-primary)', color: 'var(--jk-on-primary)' }}>
              应用
            </button>
            <button onClick={() => setShowSizeEditor(false)} className="flex-1 py-1 rounded text-xs font-mono" style={{ background: 'var(--jk-s4)', border: '1px solid var(--jk-line-3)', color: 'var(--jk-text-high)' }}>
              取消
            </button>
          </div>
        </div>
      )}

      {/* 快速选择按钮 */}
      <div className="flex gap-1 flex-wrap">
        {[
          { label: '全选', action: selectAll },
          { label: '清空', action: clearAll },
          { label: '中心区域', action: () => selectRegion('center') },
          { label: '边缘区域', action: () => selectRegion('edge') },
        ].map(btn => (
          <button
            key={btn.label}
            onClick={btn.action}
            className="px-2 py-0.5 text-xs rounded border transition-colors"
            style={{ background: 'var(--jk-s3)', borderColor: 'var(--jk-line-3)', color: 'var(--jk-text-strong)', fontSize: '10px' }}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* 矩阵区域 —— 按可用空间自适应缩放，始终完整显示、不滚动 */}
      <div
        ref={containerRef}
        data-jk-matrix-area="1"
        className="relative p-2 rounded flex-1 min-h-0 overflow-hidden flex flex-row items-start justify-center gap-2"
        style={{
          background: 'var(--jk-sunken)',
          border: '1px solid var(--jk-line-1)',
          userSelect: 'none',
          cursor: 'default',
          // 父容器没有确定高度时（例如其它页面）仍有足够可用高度，避免矩阵被压小
          minHeight: '260px',
        }}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { handleMouseUp(); handleSensorHoverLeave(); }}
        onDragStart={e => e.preventDefault()}
      >
        {/* 悬停弹出框 */}
        {tooltip.visible && tooltip.sensor && (() => {
          const s = tooltip.sensor;
          const adcVal = getAdcValue(s.row, s.col, s.adcValue);
          const hexVal = adcVal.toString(16).toUpperCase().padStart(2, '0');
          const arrayIdx = getArrayIndex(s.row, s.col);
          const adcNorm = adcVal / 255;
          const containerW = containerRef.current?.clientWidth ?? 300;
          const containerH = containerRef.current?.clientHeight ?? 200;
          const popW = 168; const popH = 120;
          const offsetX = tooltip.x + popW + 12 > containerW ? tooltip.x - popW - 8 : tooltip.x + 12;
          const offsetY = tooltip.y + popH + 8 > containerH ? tooltip.y - popH - 4 : tooltip.y + 4;
          return (
            <div style={{
              position: 'absolute', left: offsetX, top: offsetY, zIndex: 50, pointerEvents: 'none',
              width: `${popW}px`, background: 'var(--jk-s2)', border: '1px solid var(--jk-line-4)',
              borderRadius: '6px', boxShadow: '0 4px 16px oklch(0 0 0 / 0.5)', padding: '8px 10px',
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span style={{ fontSize: '10px', color: 'var(--jk-accent)', fontWeight: 600 }}>
                  R{s.row + 1} · C{s.col + 1}
                </span>
                <span style={{
                  fontSize: '9px', background: 'color-mix(in srgb, var(--jk-primary) 20%, transparent)', color: 'var(--jk-accent)',
                  border: '1px solid color-mix(in srgb, var(--jk-primary) 40%, transparent)', borderRadius: '3px', padding: '1px 5px', fontWeight: 600,
                }}>
                  #{arrayIdx}
                </span>
              </div>
              {s.selected && (
                <div style={{ marginBottom: '4px' }}>
                  <span style={{ fontSize: '8px', background: 'color-mix(in srgb, var(--jk-ok) 20%, transparent)', color: 'var(--jk-ok)', border: '1px solid color-mix(in srgb, var(--jk-ok) 40%, transparent)', borderRadius: '3px', padding: '1px 4px' }}>✓ 已选中</span>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '9px', color: 'var(--jk-text-mid)' }}>十六进制</span>
                  <span style={{ fontSize: '11px', color: 'var(--jk-accent)', fontWeight: 600 }}>0x{hexVal}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '9px', color: 'var(--jk-text-mid)' }}>十进制</span>
                  <span style={{ fontSize: '11px', color: 'var(--jk-ink)', fontWeight: 600 }}>{adcVal}</span>
                </div>
                <div style={{ marginTop: '2px', height: '4px', background: 'var(--jk-s4)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${adcNorm * 100}%`, borderRadius: '2px', transition: 'width 0.1s',
                    background: adcNorm < 0.5
                      ? `oklch(${0.45 + adcNorm * 0.3} ${0.18 + adcNorm * 0.04} ${260 - adcNorm * 230})`
                      : `oklch(${0.60 - (adcNorm - 0.5) * 0.1} ${0.20 + (adcNorm - 0.5) * 0.04} ${145 - (adcNorm - 0.5) * 240})`,
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '8px', color: 'var(--jk-text-dim)' }}>0</span>
                  <span style={{ fontSize: '8px', color: 'var(--jk-text-dim)' }}>255</span>
                </div>
              </div>
              <div style={{ marginTop: '4px', fontSize: '8px', color: 'var(--jk-text-low)', textAlign: 'center' }}>
                双击放大查看
              </div>
            </div>
          );
        })()}

        {/* 网格列（矩阵本体 + 图例） */}
        <div ref={gridColRef} className="flex-1 min-w-0 flex flex-col items-center justify-center min-h-0">

        {/* 列标签 */}
        {showAxisLabels && (
          <div className="flex mb-0.5 flex-shrink-0" style={{ paddingLeft: `${rowLabelW}px`, gap: '1px' }}>
            {Array.from({ length: cols }, (_, c) => (
              <div
                key={c}
                className="text-center font-mono"
                style={{ fontSize: '7px', color: 'var(--jk-text-dim)', width: `${dotSize}px`, flexShrink: 0 }}
              >
                {c + 1}
              </div>
            ))}
          </div>
        )}

        {/* 矩阵行 */}
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center flex-shrink-0" style={{ gap: '1px', marginBottom: '1px' }}>
            {showAxisLabels && (
              <div className="font-mono text-right flex-shrink-0" style={{ fontSize: '7px', color: 'var(--jk-text-dim)', width: `${rowLabelW}px`, paddingRight: '3px' }}>
                {r + 1}
              </div>
            )}
            {Array.from({ length: cols }, (_, c) => renderDot(r, c, dotSize, showLabelInDot, false))}
          </div>
        ))}

        {/* 图例 */}
        <div className="flex gap-2 mt-2 pt-1.5 flex-wrap items-center flex-shrink-0" style={{ borderTop: '1px solid var(--jk-s3)' }}>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--jk-ok)', border: '1px solid var(--jk-ok)' }} />
            <span className="text-xs font-mono" style={{ color: 'var(--jk-text-body)', fontSize: '9px' }}>已选中(绿)</span>
          </div>
          <div className="flex items-center gap-0.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--jk-primary)', border: '1px solid var(--jk-primary-soft)' }} />
            <span style={{ color: 'var(--jk-text-dim)', fontSize: '7px' }}>0</span>
          </div>
          <div className="flex items-center gap-0.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--jk-ok)', border: '1px solid var(--jk-ok)' }} />
            <span style={{ color: 'var(--jk-text-dim)', fontSize: '7px' }}>127</span>
          </div>
          <div className="flex items-center gap-0.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--jk-danger)', border: '1px solid var(--jk-danger)' }} />
            <span style={{ color: 'var(--jk-text-dim)', fontSize: '7px' }}>255</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ZoomIn size={8} style={{ color: 'var(--jk-text-dim)' }} />
            <span className="text-xs font-mono" style={{ color: 'var(--jk-text-dim)', fontSize: '8px' }}>
              双击放大
            </span>
          </div>
        </div>

        </div>{/* /网格列 */}

        {/* 右侧：已选点位面板 —— 在流内占位（宽度预留，矩阵不会因选中状态而移动），
            高度锁定为矩阵网格的实际高度，因此面板内容的多少不会把容器撑高 */}
        {showSidePanel && (
          <div
            className="flex-shrink-0 flex flex-col min-h-0"
            style={{ width: `${sidePanelW}px`, height: gridH > 0 ? `${gridH}px` : undefined, overflow: 'hidden' }}
          >
            {selectedListPanel}
          </div>
        )}
      </div>

      {/* 放大视图弹出层 */}
      {zoom.active && (() => {
        const { minR, maxR, minC, maxC } = getZoomRange();
        const zoomRows = maxR - minR + 1;
        const zoomCols = maxC - minC + 1;
        const zoomDotSize = Math.min(48, Math.max(36, Math.floor(240 / Math.max(zoomRows, zoomCols))));

        return (
          <div
            className="rounded-lg p-3 relative"
            style={{
              background: 'var(--jk-sunken)',
              border: '1px solid var(--jk-line-4)',
              boxShadow: '0 4px 24px oklch(0 0 0 / 0.4)',
            }}
          >
            {/* 放大视图标题 */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => setZoom({ active: false, centerRow: 0, centerCol: 0, radius: 3 })}>
                <ZoomIn size={12} style={{ color: 'var(--jk-warn)' }} />
                <span className="text-xs font-mono font-medium hover:opacity-70 transition-opacity" style={{ color: 'var(--jk-warn)' }}>
                  放大视图
                </span>
                <span className="text-xs font-mono" style={{ color: 'var(--jk-text-body)' }}>
                  R{minR + 1}~R{maxR + 1} · C{minC + 1}~C{maxC + 1}
                </span>
                <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{
                  background: 'color-mix(in srgb, var(--jk-warn) 12%, transparent)',
                  color: 'var(--jk-warn)',
                  border: '1px solid color-mix(in srgb, var(--jk-warn) 30%, transparent)',
                  fontSize: '9px',
                }}>
                  中心 #{getArrayIndex(zoom.centerRow, zoom.centerCol)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* 放大范围调节 */}
                <span className="text-xs font-mono" style={{ color: 'var(--jk-text-low)', fontSize: '9px' }}>范围:</span>
                {[2, 3, 4, 5].map(r => (
                  <button
                    key={r}
                    onClick={() => setZoom(prev => ({ ...prev, radius: r }))}
                    className="px-1.5 py-0.5 rounded text-xs font-mono transition-colors"
                    style={{
                      background: zoom.radius === r ? 'color-mix(in srgb, var(--jk-warn) 15%, transparent)' : 'var(--jk-s3)',
                      border: `1px solid ${zoom.radius === r ? 'color-mix(in srgb, var(--jk-warn) 40%, transparent)' : 'var(--jk-line-2)'}`,
                      color: zoom.radius === r ? 'var(--jk-warn)' : 'var(--jk-text-mid)',
                      fontSize: '9px',
                    }}
                  >
                    ±{r}
                  </button>
                ))}
                {/* 选中当前区域按钮 */}
                <button
                  onClick={() => {
                    const updated = sensors.map(s => {
                      if (s.row >= minR && s.row <= maxR && s.col >= minC && s.col <= maxC) {
                        return { ...s, selected: true };
                      }
                      return s;
                    });
                    onSelectionChange(updated);
                  }}
                  className="px-2 py-0.5 rounded text-xs font-mono transition-colors"
                  style={{
                    background: 'color-mix(in srgb, var(--jk-ok) 15%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--jk-ok) 40%, transparent)',
                    color: 'var(--jk-ok)',
                    fontSize: '9px',
                  }}
                  title="选中此区域内的所有点"
                >
                  ✓ 选中区域
                </button>
                <button
                  onClick={() => setZoom({ active: false, centerRow: 0, centerCol: 0, radius: 3 })}
                  className="ml-1 p-0.5 rounded transition-colors hover:bg-opacity-70"
                  style={{ background: 'color-mix(in srgb, var(--jk-danger) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--jk-danger) 30%, transparent)', color: 'var(--jk-danger)' }}
                  title="关闭放大视图"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* 放大矩阵 */}
            <div className="overflow-auto" style={{ maxHeight: '280px' }}>
              {/* 列标签 */}
              <div className="flex mb-1" style={{ paddingLeft: '28px', gap: '2px' }}>
                {Array.from({ length: zoomCols }, (_, i) => (
                  <div
                    key={i}
                    className="text-center font-mono"
                    style={{ fontSize: '8px', color: 'var(--jk-text-mid)', width: `${zoomDotSize}px`, flexShrink: 0 }}
                  >
                    C{minC + i + 1}
                  </div>
                ))}
              </div>
              {Array.from({ length: zoomRows }, (_, ri) => {
                const r = minR + ri;
                return (
                  <div key={r} className="flex items-center" style={{ gap: '2px', marginBottom: '2px' }}>
                    <div className="font-mono text-right flex-shrink-0" style={{ fontSize: '8px', color: 'var(--jk-text-mid)', width: '26px', paddingRight: '4px' }}>
                      R{r + 1}
                    </div>
                    {Array.from({ length: zoomCols }, (_, ci) => {
                      const c = minC + ci;
                      return renderDot(r, c, zoomDotSize, false, true);
                    })}
                  </div>
                );
              })}
            </div>

            {/* 放大区域统计 */}
            <div className="flex items-center gap-3 mt-2 pt-2" style={{ borderTop: '1px solid var(--jk-s4)' }}>
              <span className="text-xs font-mono" style={{ color: 'var(--jk-text-low)', fontSize: '9px' }}>
                区域 {zoomRows}×{zoomCols} = {zoomRows * zoomCols} 点
              </span>
              <span className="text-xs font-mono" style={{ color: 'var(--jk-text-low)', fontSize: '9px' }}>
                ADC范围: {(() => {
                  const vals: number[] = [];
                  for (let r = minR; r <= maxR; r++) {
                    for (let c = minC; c <= maxC; c++) {
                      const s = sensors.find(s => s.row === r && s.col === c);
                      if (s) vals.push(getAdcValue(r, c, s.adcValue));
                    }
                  }
                  return vals.length > 0 ? `${Math.min(...vals)}~${Math.max(...vals)}` : '--';
                })()}
              </span>
              <span className="text-xs font-mono" style={{ color: 'var(--jk-text-low)', fontSize: '9px' }}>
                ADC均值: {(() => {
                  const vals: number[] = [];
                  for (let r = minR; r <= maxR; r++) {
                    for (let c = minC; c <= maxC; c++) {
                      const s = sensors.find(s => s.row === r && s.col === c);
                      if (s) vals.push(getAdcValue(r, c, s.adcValue));
                    }
                  }
                  return vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '--';
                })()}
              </span>
            </div>
          </div>
        );
      })()}

      {/* 已选点位面板固定在矩阵右侧，不再有「下方」这一分支 */}
    </div>
  );
}
