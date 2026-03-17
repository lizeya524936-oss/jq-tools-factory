/**
 * ParameterPanel - 检测参数设置面板
 * 支持误差阈值、判定方法、力学范围、采样参数等全部可定义
 * 设计风格：精密科学仪器，深色背景
 */
import { useState } from 'react';
import { Settings, ChevronDown, ChevronUp, Info } from 'lucide-react';

export interface TestParameters {
  // 通用
  threshold: number;           // 误差阈值（%）
  // 一致性
  productCount: number;        // 产品数量
  samplesPerProduct: number;   // 每产品采样数
  forceMin: number;            // 力学范围最小值（N）
  forceMax: number;            // 力学范围最大值（N）
  checkPoints: number;         // 判断方法A：检查点数量（间隔一致的数据点数）
  // 重复性
  repeatInterval: number;      // 采样间隔（分钟）
  repeatCount: number;         // 采样次数
  // 耐久性
  durabilityCount: number;     // 抓握次数
}

interface ParameterPanelProps {
  params: TestParameters;
  onChange: (params: TestParameters) => void;
  mode: 'consistency' | 'repeatability' | 'durability';
}

function ParamRow({ label, value, onChange, min, max, step = 1, unit = '', hint }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
}) {
  const [showHint, setShowHint] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <label className="text-xs font-mono truncate" style={{ color: 'oklch(0.60 0.02 240)' }}>
          {label}
        </label>
        {hint && (
          <div className="relative flex-shrink-0">
            <button
              onMouseEnter={() => setShowHint(true)}
              onMouseLeave={() => setShowHint(false)}
              className="flex items-center"
            >
              <Info size={9} style={{ color: 'oklch(0.40 0.02 240)' }} />
            </button>
            {showHint && (
              <div
                className="absolute left-4 top-0 z-50 rounded p-2 text-xs font-mono shadow-xl"
                style={{
                  background: 'oklch(0.20 0.03 265)',
                  border: '1px solid oklch(0.32 0.04 265)',
                  color: 'oklch(0.65 0.02 240)',
                  width: '180px',
                  fontSize: '10px',
                  lineHeight: '1.4',
                }}
              >
                {hint}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
          className="w-16 text-right text-xs font-mono rounded px-1.5 py-0.5 outline-none"
          style={{
            background: 'oklch(0.14 0.02 265)',
            border: '1px solid oklch(0.28 0.03 265)',
            color: 'oklch(0.85 0.01 220)',
          }}
        />
        {unit && (
          <span className="text-xs font-mono w-7 text-left" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '10px' }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ label }: { label: string }) {
  return (
    <div
      className="text-xs font-mono pt-1.5 pb-1"
      style={{
        color: 'oklch(0.45 0.02 240)',
        borderBottom: '1px solid oklch(0.20 0.025 265)',
        letterSpacing: '0.04em',
        fontSize: '10px',
      }}
    >
      {label}
    </div>
  );
}

export default function ParameterPanel({ params, onChange, mode }: ParameterPanelProps) {
  const [collapsed, setCollapsed] = useState(true);

  const update = (key: keyof TestParameters, value: number) => {
    onChange({ ...params, [key]: value });
  };

  return (
    <div
      className="rounded"
      style={{
        background: 'oklch(0.17 0.025 265)',
        border: '1px solid oklch(0.28 0.03 265)',
      }}
    >
      {/* 标题 */}
      <button
        className="w-full flex items-center justify-between px-3 py-2"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-1.5">
          <Settings size={12} style={{ color: 'oklch(0.58 0.22 265)' }} />
          <span className="text-xs font-mono" style={{ color: 'oklch(0.75 0.01 220)' }}>
            检测参数
          </span>
          {collapsed && (
            <span className="text-xs font-mono" style={{ color: 'oklch(0.48 0.02 240)', fontSize: '10px' }}>
              阈值±{params.threshold}%
            </span>
          )}
        </div>
        {collapsed
          ? <ChevronDown size={12} style={{ color: 'oklch(0.50 0.02 240)' }} />
          : <ChevronUp size={12} style={{ color: 'oklch(0.50 0.02 240)' }} />
        }
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid oklch(0.22 0.03 265)' }}>
          {/* 通用参数 */}
          <div className="pt-2 space-y-2">
            <SectionTitle label="通用参数" />
            <ParamRow
              label="误差阈值"
              value={params.threshold}
              onChange={v => update('threshold', v)}
              min={0.5} max={50} step={0.5} unit="%"
              hint="判定通过/失败的误差范围，如±8%表示偏差在8%以内为合格"
            />
          </div>

          {mode === 'consistency' && (
            <div className="space-y-2">
              <SectionTitle label="一致性参数（方法A）" />
              <ParamRow
                label="产品数量"
                value={params.productCount}
                onChange={v => update('productCount', v)}
                min={2} max={30} unit="个"
                hint="同批次被测产品数量，建议10个，剔除偏差较大的数据"
              />
              <ParamRow
                label="每产品采样"
                value={params.samplesPerProduct}
                onChange={v => update('samplesPerProduct', v)}
                min={5} max={100} unit="次"
                hint="对每个产品的高频采样次数，用于获得完整力学曲线"
              />
              <ParamRow
                label="力学范围下限"
                value={params.forceMin}
                onChange={v => update('forceMin', Math.min(v, params.forceMax - 1))}
                min={0} max={499} unit="N"
                hint="判定方法A的平滑曲线力学范围下限"
              />
              <ParamRow
                label="力学范围上限"
                value={params.forceMax}
                onChange={v => update('forceMax', Math.max(v, params.forceMin + 1))}
                min={1} max={500} unit="N"
                hint="判定方法A的平滑曲线力学范围上限"
              />
              <ParamRow
                label="判定检查点数"
                value={params.checkPoints}
                onChange={v => update('checkPoints', v)}
                min={2} max={20} unit="个"
                hint="在力学范围内均匀选取N个间隔一致的数据点，判断各产品在这些点的ADC Sum偏差"
              />
            </div>
          )}

          {mode === 'repeatability' && (
            <div className="space-y-2">
              <SectionTitle label="重复性参数（方法B）" />
              <ParamRow
                label="采样间隔"
                value={params.repeatInterval}
                onChange={v => update('repeatInterval', v)}
                min={1} max={60} unit="min"
                hint="判断方法B：每隔N分钟取一次压力数值和ADC求和数值"
              />
              <ParamRow
                label="采样次数"
                value={params.repeatCount}
                onChange={v => update('repeatCount', v)}
                min={5} max={200} unit="次"
                hint="在采样期间内的总采样次数，用于判断两类数据的误差范围"
              />
              <ParamRow
                label="力学范围下限"
                value={params.forceMin}
                onChange={v => update('forceMin', Math.min(v, params.forceMax - 1))}
                min={0} max={499} unit="N"
                hint="PLC下压机的力学范围下限"
              />
              <ParamRow
                label="力学范围上限"
                value={params.forceMax}
                onChange={v => update('forceMax', Math.max(v, params.forceMin + 1))}
                min={1} max={500} unit="N"
                hint="PLC下压机的力学范围上限"
              />
            </div>
          )}

          {mode === 'durability' && (
            <div className="space-y-2">
              <SectionTitle label="耐久性参数" />
              <ParamRow
                label="抓握次数"
                value={params.durabilityCount}
                onChange={v => update('durabilityCount', v)}
                min={100} max={100000} step={100} unit="次"
                hint="机器人灵巧手套反复抓握特定物体的总次数，默认1万次"
              />
            </div>
          )}

          {/* 参数预览 */}
          <div
            className="rounded p-2 mt-1"
            style={{ background: 'oklch(0.13 0.02 265)', border: '1px solid oklch(0.20 0.025 265)' }}
          >
            <div className="text-xs font-mono" style={{ color: 'oklch(0.40 0.02 240)', fontSize: '9px' }}>
              {mode === 'consistency' && (
                <>判定方法A：{params.forceMin}N-{params.forceMax}N范围内，选取{params.checkPoints}个间隔一致的数据点，误差范围±{params.threshold}%</>
              )}
              {mode === 'repeatability' && (
                <>判定方法B：间隔{params.repeatInterval}分钟取样，共{params.repeatCount}次，两类数据误差范围±{params.threshold}%</>
              )}
              {mode === 'durability' && (
                <>耐久性：{params.durabilityCount.toLocaleString()}次抓握，ADC衰减超过±{params.threshold}%则判定失败</>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
