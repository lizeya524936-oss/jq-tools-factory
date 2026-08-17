/**
 * TestPage - 测试页面
 * 展示设备连接状态、传感器数据实时监控、力学仪器数据显示
 * 支持数据采集和 CSV 导出
 * 
 * 采集策略（双保险）：
 * 1. 优先从 SensorDataStreamV2 全局单例获取传感器数据（零延迟，不经过React）
 * 2. 备用从 Context 的 latestSensorMatrix 获取（通过 Ref 同步）
 * 3. 压力数据通过 Ref 同步（更新频率低，useEffect 足够）
 * 
 * v1.8.2 新增：手掌布局/矩阵显示切换开关，连接手套(LH/RH)时可自由选择显示模式
 * v1.9.34 重构：移除顶部自研采集按钮，统一下移接入 SerialMonitor「数据采集控制」面板，
 *   停止采集后右侧显示采集区间压力曲线并生成 Hill 拟合参数（与一致性页面行为一致）
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import SensorMatrix from '@/components/SensorMatrix';
import HandMatrix, { getHandIndices } from '@/components/HandMatrix';
import type { HandSide } from '@/components/HandMatrix';
import PressureChart from '@/components/PressureChart';
import SerialMonitor from '@/components/SerialMonitor';
import { useSerialData } from './Home';
import { generateSensorMatrix, SensorPoint } from '@/lib/sensorData';
import { fitHill, formatHillEquation, formatInverseEquation } from '@/lib/hillFit';
import type { HillFitResult } from '@/lib/hillFit';
import { CheckCircle2, AlertCircle, Zap, Hand, Grid3x3 } from 'lucide-react';

interface DataRecord {
  timestamp: number;
  pressure: number | null;
  adcValues: number[];
}

export default function TestPage() {
  // 从 localStorage 恢复矩阵尺寸
  const [matrixRows, setMatrixRows] = useState(() => {
    const saved = localStorage.getItem('matrixRows');
    return saved ? parseInt(saved, 10) : 8;
  });
  const [matrixCols, setMatrixCols] = useState(() => {
    const saved = localStorage.getItem('matrixCols');
    return saved ? parseInt(saved, 10) : 8;
  });
  const [sensors, setSensors] = useState<SensorPoint[]>(() => {
    const rows = localStorage.getItem('matrixRows') ? parseInt(localStorage.getItem('matrixRows')!, 10) : 8;
    const cols = localStorage.getItem('matrixCols') ? parseInt(localStorage.getItem('matrixCols')!, 10) : 8;
    const matrix = generateSensorMatrix(rows, cols);
    // 从 localStorage 恢复选点状态
    try {
      const savedSelection = localStorage.getItem('selectedSensorPoints');
      if (savedSelection) {
        const selectedSet = new Set<string>(JSON.parse(savedSelection));
        return matrix.map(s => ({ ...s, selected: selectedSet.has(`${s.row}_${s.col}`) }));
      }
    } catch {}
    return matrix;
  });
  const { latestForceN, latestSensorMatrix, latestAdcValues, isForceConnected, isSensorConnected, sensorDeviceType, sensorProtocol, sensorMatrixSize, sensorMatrixCols, sensorFps, forceFps, sendForceCommand } = useSerialData();

  // ===== 手掌布局/矩阵显示切换 =====
  const handSide: HandSide | null = (sensorDeviceType === 'LH' || sensorDeviceType === 'RH') ? sensorDeviceType : null;
  
  // 从 localStorage 恢复显示模式偏好（true=手掌布局, false=矩阵显示）
  const [useHandLayout, setUseHandLayout] = useState(() => {
    const saved = localStorage.getItem('testPage_useHandLayout');
    return saved !== null ? saved === 'true' : false; // 默认矩阵显示
  });

  // 保存显示模式到 localStorage
  const toggleHandLayout = useCallback(() => {
    setUseHandLayout(prev => {
      const next = !prev;
      localStorage.setItem('testPage_useHandLayout', String(next));
      return next;
    });
  }, []);

  // HandMatrix 选点状态
  const [handSelectedIndices, setHandSelectedIndices] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem('testPage_handSelectedIndices');
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    return new Set();
  });

  const handleHandToggleSelect = useCallback((arrayIndex: number) => {
    setHandSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(arrayIndex)) {
        next.delete(arrayIndex);
      } else {
        next.add(arrayIndex);
      }
      localStorage.setItem('testPage_handSelectedIndices', JSON.stringify([...next]));
      return next;
    });
  }, []);

  // 实际是否显示手掌布局：需要同时满足 handSide 存在 且 用户选择了手掌布局
  const showHandLayout = handSide !== null && useHandLayout;

  // 当传感器协议变化时，自动切换矩阵尺寸
  useEffect(() => {
    if (sensorMatrixSize && (sensorMatrixSize !== matrixRows || (sensorMatrixCols ?? sensorMatrixSize) !== matrixCols)) {
      handleMatrixSizeChange(sensorMatrixSize, sensorMatrixCols ?? sensorMatrixSize);
    }
  }, [sensorMatrixSize, sensorMatrixCols]);  // eslint-disable-line react-hooks/exhaustive-deps

  // LH/RH 时自动切换为 16×16 矩阵
  useEffect(() => {
    if (handSide && (matrixRows !== 16 || matrixCols !== 16)) {
      handleMatrixSizeChange(16, 16);
    }
  }, [handSide]);

  // 采集区间状态（由 SerialMonitor 回调驱动）
  const [recordingActive, setRecordingActive] = useState(false);
  const [recordingRecords, setRecordingRecords] = useState<DataRecord[]>([]);
  const [hillFit, setHillFit] = useState<HillFitResult | null>(null);

  // 开始采集：清空上一轮区间数据
  const handleSMStart = useCallback(() => {
    setRecordingActive(true);
    setRecordingRecords([]);
    setHillFit(null);
  }, []);

  // 停止采集：回传区间数据 → 压力曲线 + Hill 拟合
  const handleSMComplete = useCallback((records: DataRecord[]) => {
    setRecordingActive(false);
    setRecordingRecords(records);

    // Hill 拟合：过滤有效数据（压力>0 且有 ADC）
    const pressures: number[] = [];
    const adcSums: number[] = [];
    records.forEach(r => {
      if (r.pressure !== null && r.pressure > 0 && r.adcValues.length > 0) {
        pressures.push(r.pressure);
        adcSums.push(r.adcValues.reduce((a, b) => a + b, 0));
      }
    });
    setHillFit(pressures.length >= 3 ? fitHill(pressures, adcSums) : null);
  }, []);

  // 矩阵模式下 SerialMonitor 需要的选点（row/col 列表）
  const selectedSensors = sensors.filter(s => s.selected).map(s => ({ row: s.row, col: s.col }));

  // 更新矩阵尺寸并保存到 localStorage
  const handleMatrixSizeChange = (rows: number, cols: number) => {
    if (rows >= 1 && rows <= 64 && cols >= 1 && cols <= 64) {
      setMatrixRows(rows);
      setMatrixCols(cols);
      setSensors(generateSensorMatrix(rows, cols));
      localStorage.setItem('matrixRows', rows.toString());
      localStorage.setItem('matrixCols', cols.toString());
    }
  };

  // 更新传感器数据，同时保存选点到 localStorage
  const handleSensorChange = (updatedSensors: SensorPoint[]) => {
    setSensors(updatedSensors);
    const selectedKeys = updatedSensors.filter(s => s.selected).map(s => `${s.row}_${s.col}`);
    localStorage.setItem('selectedSensorPoints', JSON.stringify(selectedKeys));
  };

  const selectedCount = showHandLayout ? handSelectedIndices.size : sensors.filter(s => s.selected).length;
  const adcSum = latestAdcValues ? latestAdcValues.reduce((a, b) => a + b, 0) : 0;

  // 采集区间压力曲线数据（停止采集后传递给 PressureChart）
  const recordingPressureData = !recordingActive && recordingRecords.length > 0
    ? recordingRecords.map(r => ({
        index: 0,
        pressure: r.pressure ?? 0,
        time: new Date(r.timestamp).toLocaleTimeString('zh-CN'),
      }))
    : undefined;

  return (
    <div className="flex flex-col h-full p-4 gap-4" style={{ background: 'oklch(0.13 0.02 265)' }}>
      {/* 顶部设备连接状态卡片 */}
      <div className="grid grid-cols-2 gap-3">
        {/* 力学仪器连接状态 */}
        <div
          className="rounded p-3"
          style={{
            background: 'oklch(0.17 0.025 265)',
            border: `1px solid ${isForceConnected ? 'oklch(0.70 0.18 200 / 0.4)' : 'oklch(0.25 0.03 265)'}`,
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            {isForceConnected ? (
              <CheckCircle2 size={14} style={{ color: 'oklch(0.70 0.18 200)' }} />
            ) : (
              <AlertCircle size={14} style={{ color: 'oklch(0.65 0.22 25)' }} />
            )}
            <span className="text-xs font-mono font-medium" style={{ color: isForceConnected ? 'oklch(0.70 0.18 200)' : 'oklch(0.65 0.22 25)' }}>
              力学仪器 (CL2-500N-MH01)
            </span>
          </div>
          <div className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
            状态: <span style={{ color: isForceConnected ? 'oklch(0.72 0.20 145)' : 'oklch(0.40 0.02 240)' }}>
              {isForceConnected ? '已连接' : '未连接'}
            </span>
          </div>
          {isForceConnected && latestForceN !== null && (
            <div className="mt-2 text-xs font-mono" style={{ color: 'oklch(0.72 0.20 145)' }}>
              压力: <span style={{ fontWeight: 600 }}>{latestForceN.toFixed(2)} N</span>
            </div>
          )}
        </div>

        {/* 传感器产品连接状态 */}
        <div
          className="rounded p-3"
          style={{
            background: 'oklch(0.17 0.025 265)',
            border: `1px solid ${isSensorConnected ? 'oklch(0.72 0.20 145 / 0.4)' : 'oklch(0.25 0.03 265)'}`,
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            {isSensorConnected ? (
              <CheckCircle2 size={14} style={{ color: 'oklch(0.72 0.20 145)' }} />
            ) : (
              <AlertCircle size={14} style={{ color: 'oklch(0.65 0.22 25)' }} />
            )}
            <span className="text-xs font-mono font-medium" style={{ color: isSensorConnected ? 'oklch(0.72 0.20 145)' : 'oklch(0.65 0.22 25)' }}>
              传感器产品 (织物触觉传感器)
            </span>
          </div>
          <div className="text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
            状态: <span style={{ color: isSensorConnected ? 'oklch(0.72 0.20 145)' : 'oklch(0.40 0.02 240)' }}>
              {isSensorConnected ? '已连接' : '未连接'}
            </span>
          </div>
          {isSensorConnected && adcSum > 0 && (
            <div className="mt-2 text-xs font-mono" style={{ color: 'oklch(0.70 0.18 200)' }}>
              ADC Sum: <span style={{ fontWeight: 600 }}>0x{adcSum.toString(16).toUpperCase().padStart(8, '0')}</span>
            </div>
          )}
        </div>
      </div>

      {/* 中间主区域：传感器矩阵 + 压力图表 */}
      <div className="flex-1 min-h-0 flex gap-4">
        {/* 传感器数组显示（左侧，增加1.5倍） */}
        <div
          className="rounded p-4 flex flex-col min-h-0"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', flex: '1.3' }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap size={14} style={{ color: 'oklch(0.70 0.18 200)' }} />
              <span className="text-sm font-mono font-medium" style={{ color: 'oklch(0.70 0.18 200)' }}>
                传感器数组实时监控
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono" style={{ color: 'oklch(0.55 0.02 240)' }}>
              <span>矩阵: {matrixRows}×{matrixCols}</span>
              <span style={{ color: 'oklch(0.35 0.02 240)' }}>|</span>
              <span>已选: {selectedCount}</span>
            </div>
          </div>

          {/* 手掌布局/矩阵显示切换开关 - 仅在连接手套(LH/RH)时显示 */}
          {handSide && (
            <div className="flex items-center gap-1 mb-3 p-1 rounded-lg" style={{ background: 'oklch(0.13 0.02 265)', border: '1px solid oklch(0.25 0.03 265)' }}>
              <button
                onClick={() => { if (!useHandLayout) toggleHandLayout(); }}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-mono font-medium transition-all"
                style={{
                  background: useHandLayout ? 'oklch(0.58 0.22 265 / 0.25)' : 'transparent',
                  border: useHandLayout ? '1px solid oklch(0.58 0.22 265 / 0.5)' : '1px solid transparent',
                  color: useHandLayout ? 'oklch(0.80 0.15 265)' : 'oklch(0.45 0.02 240)',
                }}
              >
                <Hand size={16} />
                <span>手掌布局</span>
              </button>
              <button
                onClick={() => { if (useHandLayout) toggleHandLayout(); }}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-mono font-medium transition-all"
                style={{
                  background: !useHandLayout ? 'oklch(0.72 0.20 145 / 0.25)' : 'transparent',
                  border: !useHandLayout ? '1px solid oklch(0.72 0.20 145 / 0.5)' : '1px solid transparent',
                  color: !useHandLayout ? 'oklch(0.82 0.15 145)' : 'oklch(0.45 0.02 240)',
                }}
              >
                <Grid3x3 size={16} />
                <span>矩阵显示</span>
              </button>
            </div>
          )}

          {/* 矩阵尺寸调整 - 仅在矩阵模式下显示 */}
          {!showHandLayout && (
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)' }}>矩阵尺寸:</span>
              <input
                type="number"
                min={1}
                max={16}
                value={matrixRows}
                onChange={e => handleMatrixSizeChange(parseInt(e.target.value), matrixCols)}
                className="w-14 px-2 py-1.5 rounded text-xs font-mono outline-none"
                style={{
                  background: 'oklch(0.12 0.02 265)',
                  border: '1px solid oklch(0.25 0.03 265)',
                  color: 'oklch(0.82 0.01 220)',
                }}
              />
              <span style={{ color: 'oklch(0.50 0.02 240)' }}>×</span>
              <input
                type="number"
                min={1}
                max={16}
                value={matrixCols}
                onChange={e => handleMatrixSizeChange(matrixRows, parseInt(e.target.value))}
                className="w-14 px-2 py-1.5 rounded text-xs font-mono outline-none"
                style={{
                  background: 'oklch(0.12 0.02 265)',
                  border: '1px solid oklch(0.25 0.03 265)',
                  color: 'oklch(0.82 0.01 220)',
                }}
              />
            </div>
          )}

          {/* 手掌布局模式下的全选按钮 */}
          {showHandLayout && handSide && (
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => {
                  const allIndices = getHandIndices(handSide);
                  const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                  if (allSelected) {
                    setHandSelectedIndices(new Set());
                    localStorage.setItem('testPage_handSelectedIndices', '[]');
                  } else {
                    const newSet = new Set(allIndices);
                    setHandSelectedIndices(newSet);
                    localStorage.setItem('testPage_handSelectedIndices', JSON.stringify(allIndices));
                  }
                }}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono transition-all"
                style={{
                  background: (() => {
                    const allIndices = getHandIndices(handSide);
                    const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                    return allSelected ? 'oklch(0.35 0.15 30 / 0.3)' : 'oklch(0.30 0.15 250 / 0.3)';
                  })(),
                  border: (() => {
                    const allIndices = getHandIndices(handSide);
                    const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                    return allSelected ? '1px solid oklch(0.50 0.15 30 / 0.5)' : '1px solid oklch(0.50 0.15 250 / 0.5)';
                  })(),
                  color: (() => {
                    const allIndices = getHandIndices(handSide);
                    const allSelected = allIndices.every(i => handSelectedIndices.has(i));
                    return allSelected ? 'oklch(0.70 0.15 30)' : 'oklch(0.70 0.15 250)';
                  })(),
                }}
              >
                {(() => {
                  const allIndices = getHandIndices(handSide);
                  return allIndices.every(i => handSelectedIndices.has(i)) ? '全部取消' : '全选';
                })()}
              </button>
            </div>
          )}

          {/* 传感器矩阵 / 手掌布局 */}
          <div className="flex-1 min-h-0 overflow-auto">
            {showHandLayout && handSide ? (
              <HandMatrix
                side={handSide}
                adcValues={latestAdcValues}
                showIndex={true}
                selectedIndices={handSelectedIndices}
                onToggleSelect={handleHandToggleSelect}
              />
            ) : (
              <div style={{ transform: 'scale(1.15)', transformOrigin: 'top left', width: '86.96%' }}>
                <SensorMatrix
                  sensors={sensors}
                  onSelectionChange={handleSensorChange}
                  rows={matrixRows}
                  cols={matrixCols}
                  realtimeMatrix={latestSensorMatrix ?? undefined}
                  isConnected={isSensorConnected}
                />
              </div>
            )}
          </div>
        </div>

        {/* 压力图表显示（右侧）+ Hill 拟合参数 */}
        <div
          className="rounded p-4 flex flex-col min-h-0 gap-3"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)', flex: '1' }}
        >
          <div className="flex-1 min-h-0">
            <PressureChart externalData={recordingPressureData} />
          </div>

          {/* Hill 拟合参数（停止采集后显示） */}
          {!recordingActive && recordingRecords.length > 0 && (
            <div
              className="rounded p-3 flex-shrink-0"
              style={{ background: 'oklch(0.14 0.02 265)', border: '1px solid oklch(0.25 0.03 265)' }}
            >
              <div className="text-xs font-mono font-medium mb-2" style={{ color: 'oklch(0.70 0.18 200)' }}>
                Hill 拟合参数
              </div>
              {hillFit ? (
                <div className="space-y-1 text-xs font-mono">
                  <div style={{ color: 'oklch(0.75 0.18 55)' }}>
                    正向: {formatHillEquation(hillFit)}
                  </div>
                  <div style={{ color: 'oklch(0.70 0.18 200)' }}>
                    反推: {formatInverseEquation(hillFit)}
                  </div>
                  <div style={{ color: 'oklch(0.55 0.02 240)' }}>
                    a = {hillFit.a.toFixed(2)} · b = {hillFit.b.toFixed(2)} · n = {hillFit.n.toFixed(4)}
                  </div>
                  <div style={{ color: 'oklch(0.55 0.02 240)' }}>
                    R² = {hillFit.r2.toFixed(4)} · RMSE = {hillFit.rmse.toFixed(4)} · 采样点 = {recordingRecords.length}
                  </div>
                </div>
              ) : (
                <div className="text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)' }}>
                  有效数据不足（需 ≥3 组压力&gt;0 且有 ADC 的数据）才能拟合 Hill 方程
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 数据采集控制面板 */}
      <div
        className="rounded p-3"
        style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}
      >
        <div className="text-xs font-mono font-medium mb-2" style={{ color: 'oklch(0.72 0.20 145)' }}>
          数据采集控制
        </div>
        <SerialMonitor
          isForceConnected={isForceConnected}
          isSensorConnected={isSensorConnected}
          latestForceN={latestForceN}
          latestAdcValues={latestAdcValues}
          selectedSensors={selectedSensors}
          matrixCols={matrixCols}
          handSelectedIndices={showHandLayout ? handSelectedIndices : undefined}
          onStartRecording={() => {
            // 开始采集前发送压力计 CMD_RESET 归零指令
            if (isForceConnected && sendForceCommand) {
              sendForceCommand(new Uint8Array([0x23, 0x55, 0x00, 0x0A]));
            }
          }}
          onRecordingStart={handleSMStart}
          onRecordingComplete={handleSMComplete}
        />
      </div>

      {/* 实时数据面板 */}
      {(isForceConnected || isSensorConnected) && (
        <div
          className="rounded p-3"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}
        >
          <div className="text-xs font-mono font-medium mb-2" style={{ color: 'oklch(0.70 0.18 200)' }}>
            实时数据监控
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs font-mono">
            {isForceConnected && (
              <div>
                <div style={{ color: 'oklch(0.50 0.02 240)' }}>压力 (N)</div>
                <div style={{ color: 'oklch(0.72 0.20 145)', fontSize: '14px', fontWeight: 600, marginTop: '4px' }}>
                  {latestForceN !== null ? latestForceN.toFixed(2) : '--'}
                </div>
              </div>
            )}
            {isSensorConnected && (
              <>
                <div>
                  <div style={{ color: 'oklch(0.50 0.02 240)' }}>ADC Sum</div>
                  <div style={{ color: 'oklch(0.70 0.18 200)', fontSize: '14px', fontWeight: 600, marginTop: '4px' }}>
                    {adcSum}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'oklch(0.50 0.02 240)' }}>ADC Sum (HEX)</div>
                  <div style={{ color: 'oklch(0.70 0.18 200)', fontSize: '14px', fontWeight: 600, marginTop: '4px' }}>
                    0x{adcSum.toString(16).toUpperCase().padStart(8, '0')}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
