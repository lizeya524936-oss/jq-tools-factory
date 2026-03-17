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
import { Settings2, Grid3x3, MousePointer2, Square, ZoomIn, X } from 'lucide-react';

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
  const [selectMode, setSelectMode] = useState<'point' | 'box'>('point');
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'select' | 'deselect'>('select');
  const [boxSelect, setBoxSelect] = useState<BoxSelectState>({ active: false, startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
  const [showSizeEditor, setShowSizeEditor] = useState(false);
  const [editRows, setEditRows] = useState(rows);
  const [editCols, setEditCols] = useState(cols);
  const [showArrayIndex, setShowArrayIndex] = useState(true);
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, sensor: null });
  const [zoom, setZoom] = useState<ZoomState>({ active: false, centerRow: 0, centerCol: 0, radius: 3 });
  const containerRef = useRef<HTMLDivElement>(null);

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
    if (v === 0) return { bg: 'oklch(0.18 0.03 265)', border: 'oklch(0.24 0.03 265)', glow: 'none' };
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

  // 点选模式
  const toggleSensor = useCallback((id: string, forceMode?: 'select' | 'deselect') => {
    const updated = sensors.map(s => {
      if (s.id === id) {
        const newSelected = forceMode ? forceMode === 'select' : !s.selected;
        return { ...s, selected: newSelected };
      }
      return s;
    });
    onSelectionChange(updated);
  }, [sensors, onSelectionChange]);

  const handleMouseDown = (row: number, col: number, id: string) => {
    if (selectMode === 'box') {
      setBoxSelect({ active: true, startRow: row, startCol: col, endRow: row, endCol: col });
    } else {
      const sensor = sensors.find(s => s.id === id);
      const mode = sensor?.selected ? 'deselect' : 'select';
      setDragMode(mode);
      setIsDragging(true);
      toggleSensor(id, mode);
    }
  };

  const handleMouseEnterCell = (row: number, col: number, id: string) => {
    if (selectMode === 'box' && boxSelect.active) {
      setBoxSelect(prev => ({ ...prev, endRow: row, endCol: col }));
    } else if (isDragging) {
      toggleSensor(id, dragMode);
    }
  };

  const handleMouseUp = () => {
    if (selectMode === 'box' && boxSelect.active) {
      const minR = Math.min(boxSelect.startRow, boxSelect.endRow);
      const maxR = Math.max(boxSelect.startRow, boxSelect.endRow);
      const minC = Math.min(boxSelect.startCol, boxSelect.endCol);
      const maxC = Math.max(boxSelect.startCol, boxSelect.endCol);
      const updated = sensors.map(s => {
        if (s.row >= minR && s.row <= maxR && s.col >= minC && s.col <= maxC) {
          return { ...s, selected: true };
        }
        return s;
      });
      onSelectionChange(updated);
      setBoxSelect({ active: false, startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
    }
    setIsDragging(false);
  };

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

  // 计算点尺寸
  const maxDim = Math.max(rows, cols);
  const dotSize = maxDim > 32 ? 6 : maxDim > 16 ? 10 : maxDim > 8 ? 14 : 20;
  const showLabels = maxDim <= 32;
  const showIndexInDot = maxDim <= 16 && showArrayIndex;

  // 缓存已选传感器的数组索引列表
  const selectedIndices = useMemo(
    () => sensors.filter(s => s.selected).map(s => getArrayIndex(s.row, s.col)).sort((a, b) => a - b),
    [sensors, cols]
  );

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
          background: inBox ? 'oklch(0.58 0.22 265 / 0.4)' : colors.bg,
          border: isZoomCenter
            ? '2px solid oklch(0.85 0.18 55)'
            : `1px solid ${inBox ? 'oklch(0.70 0.18 200)' : colors.border}`,
          boxShadow: isZoomCenter
            ? '0 0 8px oklch(0.85 0.18 55 / 0.5)'
            : inBox ? '0 0 3px oklch(0.58 0.22 265 / 0.5)' : colors.glow,
          cursor: 'pointer',
          borderRadius: '2px',
          transition: 'background 0.08s, box-shadow 0.08s',
        }}
        onMouseDown={() => handleMouseDown(r, c, sensor.id)}
        onMouseEnter={(e) => { handleMouseEnterCell(r, c, sensor.id); if (!isZoomView) handleSensorHoverEnter(e, sensor); }}
        onMouseMove={!isZoomView ? handleSensorHoverMove : undefined}
        onMouseLeave={!isZoomView ? handleSensorHoverLeave : undefined}
        onDoubleClick={() => isZoomView ? handleZoomDoubleClick(r, c) : handleDoubleClick(r, c)}
      >
        {/* 放大视图：显示ADC值 */}
        {isZoomView && size >= 36 && (
          <div className="flex flex-col items-center gap-0" style={{ lineHeight: 1 }}>
            <span style={{
              fontSize: size > 44 ? '8px' : '6px',
              color: sensor.selected ? 'oklch(0.15 0.02 145)' : 'oklch(0.70 0.02 240)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 700,
            }}>
              {adcVal}
            </span>
            <span style={{
              fontSize: size > 44 ? '7px' : '5px',
              color: sensor.selected ? 'oklch(0.20 0.02 145)' : 'oklch(0.50 0.02 240)',
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
              0x{hexVal}
            </span>
            <span style={{
              fontSize: '5px',
              color: sensor.selected ? 'oklch(0.25 0.02 145)' : 'oklch(0.40 0.02 240)',
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
              #{arrayIdx}
            </span>
          </div>
        )}
        {/* 主矩阵：显示数组位序 */}
        {!isZoomView && showIdx && (
          <span style={{
            fontSize: size > 16 ? '7px' : '5px',
            color: sensor.selected ? 'oklch(0.15 0.02 145)' : adcVal > 127 ? 'oklch(0.15 0.02 265)' : 'oklch(0.55 0.02 240)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 600,
            lineHeight: 1,
          }}>
            {arrayIdx}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Grid3x3 size={12} style={{ color: 'oklch(0.70 0.18 200)' }} />
          <span className="text-xs font-mono" style={{ color: 'oklch(0.60 0.02 240)' }}>传感器数组</span>
          <span className="text-xs font-mono font-medium" style={{ color: 'oklch(0.70 0.18 200)' }}>
            {rows}×{cols}
          </span>
          {isConnected && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'oklch(0.72 0.20 145)' }} />
              <span style={{ color: 'oklch(0.72 0.20 145)', fontSize: '8px', fontFamily: "'IBM Plex Mono', monospace" }}>实时</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* 选择模式切换 */}
          <div className="flex rounded overflow-hidden" style={{ border: '1px solid oklch(0.28 0.03 265)' }}>
            <button
              onClick={() => setSelectMode('point')}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-mono transition-colors"
              style={{
                background: selectMode === 'point' ? 'oklch(0.58 0.22 265 / 0.2)' : 'oklch(0.18 0.025 265)',
                color: selectMode === 'point' ? 'oklch(0.70 0.18 200)' : 'oklch(0.45 0.02 240)',
                fontSize: '9px',
              }}
              title="单点选取/拖拽选取"
            >
              <MousePointer2 size={9} />
              <span>点选</span>
            </button>
            <button
              onClick={() => setSelectMode('box')}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-mono transition-colors"
              style={{
                background: selectMode === 'box' ? 'oklch(0.58 0.22 265 / 0.2)' : 'oklch(0.18 0.025 265)',
                color: selectMode === 'box' ? 'oklch(0.70 0.18 200)' : 'oklch(0.45 0.02 240)',
                fontSize: '9px',
                borderLeft: '1px solid oklch(0.28 0.03 265)',
              }}
              title="矩形框选"
            >
              <Square size={9} />
              <span>框选</span>
            </button>
          </div>
          {/* 尺寸按钮 */}
          {onResize && (
            <button
              onClick={() => { setEditRows(rows); setEditCols(cols); setShowSizeEditor(!showSizeEditor); }}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-mono transition-colors"
              style={{
                background: showSizeEditor ? 'oklch(0.58 0.22 265 / 0.2)' : 'oklch(0.20 0.025 265)',
                border: `1px solid ${showSizeEditor ? 'oklch(0.58 0.22 265 / 0.5)' : 'oklch(0.28 0.03 265)'}`,
                color: showSizeEditor ? 'oklch(0.70 0.18 200)' : 'oklch(0.45 0.02 240)',
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
      <div className="flex items-center justify-between px-2 py-1 rounded" style={{ background: 'oklch(0.15 0.025 265)', border: '1px solid oklch(0.22 0.03 265)' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '10px' }}>
            已选: <span style={{ color: 'oklch(0.72 0.20 145)', fontWeight: 600 }}>{selectedCount}</span>
            <span style={{ color: 'oklch(0.38 0.02 240)' }}>/{totalCount}</span>
          </span>
          {selectedCount > 0 && (
            <span className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)', fontSize: '9px' }}>
              ADC Sum: <span style={{ color: 'oklch(0.70 0.18 200)' }}>
                {sensors.filter(s => s.selected).reduce((sum, s) => sum + getAdcValue(s.row, s.col, s.adcValue), 0)}
              </span>
              <span style={{ color: 'oklch(0.45 0.02 240)', marginLeft: '4px' }}>
                (0x{sensors.filter(s => s.selected).reduce((sum, s) => sum + getAdcValue(s.row, s.col, s.adcValue), 0).toString(16).toUpperCase().padStart(4, '0')})
              </span>
            </span>
          )}
        </div>
        <button
          onClick={() => setShowArrayIndex(!showArrayIndex)}
          className="text-xs font-mono px-1.5 py-0.5 rounded transition-colors"
          style={{
            background: showArrayIndex ? 'oklch(0.70 0.18 200 / 0.12)' : 'transparent',
            color: showArrayIndex ? 'oklch(0.70 0.18 200)' : 'oklch(0.40 0.02 240)',
            fontSize: '9px',
            border: `1px solid ${showArrayIndex ? 'oklch(0.70 0.18 200 / 0.3)' : 'oklch(0.25 0.03 265)'}`,
          }}
          title="切换显示数组位序号"
        >
          #序号
        </button>
      </div>

      {/* 矩阵尺寸编辑器 */}
      {showSizeEditor && (
        <div className="rounded p-2.5 space-y-2" style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.30 0.04 265)' }}>
          <div className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
            矩阵尺寸设置（0-64）
          </div>
          <div className="flex gap-2 items-center">
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)' }}>横</span>
              <input
                type="number"
                value={editCols}
                min={0} max={64}
                onChange={e => setEditCols(Math.min(64, Math.max(0, parseInt(e.target.value) || 0)))}
                className="flex-1 text-center text-xs font-mono rounded px-1 py-0.5 outline-none"
                style={{ background: 'oklch(0.14 0.02 265)', border: '1px solid oklch(0.28 0.03 265)', color: 'oklch(0.85 0.01 220)' }}
              />
            </div>
            <span className="text-xs font-mono" style={{ color: 'oklch(0.40 0.02 240)' }}>×</span>
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)' }}>纵</span>
              <input
                type="number"
                value={editRows}
                min={0} max={64}
                onChange={e => setEditRows(Math.min(64, Math.max(0, parseInt(e.target.value) || 0)))}
                className="flex-1 text-center text-xs font-mono rounded px-1 py-0.5 outline-none"
                style={{ background: 'oklch(0.14 0.02 265)', border: '1px solid oklch(0.28 0.03 265)', color: 'oklch(0.85 0.01 220)' }}
              />
            </div>
          </div>
          <div className="text-xs font-mono" style={{ color: 'oklch(0.40 0.02 240)', fontSize: '9px' }}>
            共 {editRows * editCols} 个传感器点（最大64×64=4096）
          </div>
          <div className="flex gap-2">
            <button onClick={handleApplySize} className="flex-1 py-1 rounded text-xs font-mono" style={{ background: 'oklch(0.58 0.22 265)', color: 'white' }}>
              应用
            </button>
            <button onClick={() => setShowSizeEditor(false)} className="flex-1 py-1 rounded text-xs font-mono" style={{ background: 'oklch(0.22 0.03 265)', border: '1px solid oklch(0.30 0.03 265)', color: 'oklch(0.60 0.02 240)' }}>
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
            style={{ background: 'oklch(0.20 0.025 265)', borderColor: 'oklch(0.30 0.03 265)', color: 'oklch(0.70 0.02 240)', fontSize: '10px' }}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* 矩阵区域 */}
      <div
        ref={containerRef}
        className="relative p-2 rounded overflow-auto"
        style={{
          background: 'oklch(0.13 0.02 265)',
          border: '1px solid oklch(0.25 0.03 265)',
          maxHeight: rows > 32 ? '140px' : rows > 16 ? '300px' : rows > 8 ? '300px' : '360px',
          userSelect: 'none',
          cursor: 'default',
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
              width: `${popW}px`, background: 'oklch(0.18 0.03 265)', border: '1px solid oklch(0.35 0.06 265)',
              borderRadius: '6px', boxShadow: '0 4px 16px oklch(0 0 0 / 0.5)', padding: '8px 10px',
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span style={{ fontSize: '10px', color: 'oklch(0.75 0.18 200)', fontWeight: 600 }}>
                  R{s.row + 1} · C{s.col + 1}
                </span>
                <span style={{
                  fontSize: '9px', background: 'oklch(0.58 0.22 265 / 0.2)', color: 'oklch(0.70 0.18 200)',
                  border: '1px solid oklch(0.58 0.22 265 / 0.4)', borderRadius: '3px', padding: '1px 5px', fontWeight: 600,
                }}>
                  #{arrayIdx}
                </span>
              </div>
              {s.selected && (
                <div style={{ marginBottom: '4px' }}>
                  <span style={{ fontSize: '8px', background: 'oklch(0.72 0.20 145 / 0.2)', color: 'oklch(0.72 0.20 145)', border: '1px solid oklch(0.72 0.20 145 / 0.4)', borderRadius: '3px', padding: '1px 4px' }}>✓ 已选中</span>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '9px', color: 'oklch(0.50 0.02 240)' }}>十六进制</span>
                  <span style={{ fontSize: '11px', color: 'oklch(0.75 0.18 200)', fontWeight: 600 }}>0x{hexVal}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '9px', color: 'oklch(0.50 0.02 240)' }}>十进制</span>
                  <span style={{ fontSize: '11px', color: 'oklch(0.85 0.01 220)', fontWeight: 600 }}>{adcVal}</span>
                </div>
                <div style={{ marginTop: '2px', height: '4px', background: 'oklch(0.22 0.03 265)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${adcNorm * 100}%`, borderRadius: '2px', transition: 'width 0.1s',
                    background: adcNorm < 0.5
                      ? `oklch(${0.45 + adcNorm * 0.3} ${0.18 + adcNorm * 0.04} ${260 - adcNorm * 230})`
                      : `oklch(${0.60 - (adcNorm - 0.5) * 0.1} ${0.20 + (adcNorm - 0.5) * 0.04} ${145 - (adcNorm - 0.5) * 240})`,
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '8px', color: 'oklch(0.38 0.02 240)' }}>0</span>
                  <span style={{ fontSize: '8px', color: 'oklch(0.38 0.02 240)' }}>255</span>
                </div>
              </div>
              <div style={{ marginTop: '4px', fontSize: '8px', color: 'oklch(0.45 0.02 240)', textAlign: 'center' }}>
                双击放大查看
              </div>
            </div>
          );
        })()}

        {/* 列标签 */}
        {showLabels && (
          <div className="flex mb-0.5" style={{ paddingLeft: showLabels ? `${Math.max(20, String(rows).length * 8 + 8)}px` : '0px', gap: '1px' }}>
            {Array.from({ length: cols }, (_, c) => (
              <div
                key={c}
                className="text-center font-mono"
                style={{ fontSize: '7px', color: 'oklch(0.38 0.02 240)', width: `${dotSize}px`, flexShrink: 0 }}
              >
                {c + 1}
              </div>
            ))}
          </div>
        )}

        {/* 矩阵行 */}
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center" style={{ gap: '1px', marginBottom: '1px' }}>
            {showLabels && (
              <div className="font-mono text-right flex-shrink-0" style={{ fontSize: '7px', color: 'oklch(0.38 0.02 240)', width: `${Math.max(20, String(rows).length * 8 + 8)}px`, paddingRight: '3px' }}>
                {r + 1}
              </div>
            )}
            {Array.from({ length: cols }, (_, c) => renderDot(r, c, dotSize, showIndexInDot, false))}
          </div>
        ))}

        {/* 图例 */}
        <div className="flex gap-2 mt-2 pt-1.5 flex-wrap items-center" style={{ borderTop: '1px solid oklch(0.20 0.03 265)' }}>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: 'oklch(0.72 0.20 145)', border: '1px solid oklch(0.82 0.18 145)' }} />
            <span className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)', fontSize: '9px' }}>已选中(绿)</span>
          </div>
          <div className="flex items-center gap-0.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: 'oklch(0.35 0.16 260)', border: '1px solid oklch(0.45 0.14 260)' }} />
            <span style={{ color: 'oklch(0.40 0.02 240)', fontSize: '7px' }}>0</span>
          </div>
          <div className="flex items-center gap-0.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: 'oklch(0.55 0.20 145)', border: '1px solid oklch(0.65 0.18 145)' }} />
            <span style={{ color: 'oklch(0.40 0.02 240)', fontSize: '7px' }}>127</span>
          </div>
          <div className="flex items-center gap-0.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: 'oklch(0.50 0.22 25)', border: '1px solid oklch(0.60 0.20 25)' }} />
            <span style={{ color: 'oklch(0.40 0.02 240)', fontSize: '7px' }}>255</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ZoomIn size={8} style={{ color: 'oklch(0.40 0.02 240)' }} />
            <span className="text-xs font-mono" style={{ color: 'oklch(0.40 0.02 240)', fontSize: '8px' }}>
              双击放大
            </span>
          </div>
        </div>
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
              background: 'oklch(0.14 0.025 265)',
              border: '1px solid oklch(0.35 0.06 265)',
              boxShadow: '0 4px 24px oklch(0 0 0 / 0.4)',
            }}
          >
            {/* 放大视图标题 */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => setZoom({ active: false, centerRow: 0, centerCol: 0, radius: 3 })}>
                <ZoomIn size={12} style={{ color: 'oklch(0.75 0.18 55)' }} />
                <span className="text-xs font-mono font-medium hover:opacity-70 transition-opacity" style={{ color: 'oklch(0.75 0.18 55)' }}>
                  放大视图
                </span>
                <span className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
                  R{minR + 1}~R{maxR + 1} · C{minC + 1}~C{maxC + 1}
                </span>
                <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{
                  background: 'oklch(0.85 0.18 55 / 0.12)',
                  color: 'oklch(0.85 0.18 55)',
                  border: '1px solid oklch(0.85 0.18 55 / 0.3)',
                  fontSize: '9px',
                }}>
                  中心 #{getArrayIndex(zoom.centerRow, zoom.centerCol)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* 放大范围调节 */}
                <span className="text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px' }}>范围:</span>
                {[2, 3, 4, 5].map(r => (
                  <button
                    key={r}
                    onClick={() => setZoom(prev => ({ ...prev, radius: r }))}
                    className="px-1.5 py-0.5 rounded text-xs font-mono transition-colors"
                    style={{
                      background: zoom.radius === r ? 'oklch(0.85 0.18 55 / 0.15)' : 'oklch(0.20 0.025 265)',
                      border: `1px solid ${zoom.radius === r ? 'oklch(0.85 0.18 55 / 0.4)' : 'oklch(0.28 0.03 265)'}`,
                      color: zoom.radius === r ? 'oklch(0.85 0.18 55)' : 'oklch(0.50 0.02 240)',
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
                    background: 'oklch(0.72 0.20 145 / 0.15)',
                    border: '1px solid oklch(0.72 0.20 145 / 0.4)',
                    color: 'oklch(0.72 0.20 145)',
                    fontSize: '9px',
                  }}
                  title="选中此区域内的所有点"
                >
                  ✓ 选中区域
                </button>
                <button
                  onClick={() => setZoom({ active: false, centerRow: 0, centerCol: 0, radius: 3 })}
                  className="ml-1 p-0.5 rounded transition-colors hover:bg-opacity-70"
                  style={{ background: 'oklch(0.65 0.22 25 / 0.15)', border: '1px solid oklch(0.65 0.22 25 / 0.3)', color: 'oklch(0.65 0.22 25)' }}
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
                    style={{ fontSize: '8px', color: 'oklch(0.50 0.02 240)', width: `${zoomDotSize}px`, flexShrink: 0 }}
                  >
                    C{minC + i + 1}
                  </div>
                ))}
              </div>
              {Array.from({ length: zoomRows }, (_, ri) => {
                const r = minR + ri;
                return (
                  <div key={r} className="flex items-center" style={{ gap: '2px', marginBottom: '2px' }}>
                    <div className="font-mono text-right flex-shrink-0" style={{ fontSize: '8px', color: 'oklch(0.50 0.02 240)', width: '26px', paddingRight: '4px' }}>
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
            <div className="flex items-center gap-3 mt-2 pt-2" style={{ borderTop: '1px solid oklch(0.22 0.03 265)' }}>
              <span className="text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px' }}>
                区域 {zoomRows}×{zoomCols} = {zoomRows * zoomCols} 点
              </span>
              <span className="text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px' }}>
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
              <span className="text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px' }}>
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

      {/* 已选传感器索引列表 */}
      {selectedCount > 0 && (
        <div className="rounded p-2" style={{ background: 'oklch(0.15 0.025 265)', border: '1px solid oklch(0.22 0.03 265)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)', fontSize: '10px' }}>
              已选 {selectedCount} 个传感器点 · 数组位序:
            </span>
          </div>
          <div className="flex flex-wrap gap-0.5" style={{ maxHeight: '60px', overflowY: 'auto' }}>
            {selectedIndices.map(idx => {
              const sensor = sensors.find(s => getArrayIndex(s.row, s.col) === idx);
              if (!sensor) return null;
              return (
                <span
                  key={idx}
                  className="px-1 py-0.5 text-xs font-mono rounded"
                  style={{
                    background: 'oklch(0.72 0.20 145 / 0.12)',
                    color: 'oklch(0.72 0.20 145)',
                    border: '1px solid oklch(0.72 0.20 145 / 0.25)',
                    fontSize: '9px',
                  }}
                  title={`R${sensor.row + 1}·C${sensor.col + 1} = 数组第${idx}位`}
                >
                  #{idx}
                </span>
              );
            })}
          </div>
          {selectedCount > 0 && (
            <div className="mt-1 text-xs font-mono" style={{ color: 'oklch(0.40 0.02 240)', fontSize: '9px' }}>
              范围: #{selectedIndices[0]} ~ #{selectedIndices[selectedIndices.length - 1]}
              {' '}| ADC Sum(Hex): 0x{sensors.filter(s => s.selected).reduce((sum, s) => sum + getAdcValue(s.row, s.col, s.adcValue), 0).toString(16).toUpperCase().padStart(4, '0')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
