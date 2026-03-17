/**
 * DataLogPage - 数据记录汇总页面
 * 显示所有检测模式的数据，支持CSV导出
 * 数据格式：Time, Pressure, ADC Value, ADC Sum
 */
import { useState } from 'react';
import {
  DataRecord,
  SensorPoint,
  generateSensorMatrix,
  generateConsistencyData,
  generateRepeatabilityData,
  generateDurabilityData,
  exportToCSV,
  toHex,
} from '@/lib/sensorData';
import { Download, Database, FileText, BarChart2 } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

// 生成示例数据（使用默认8×8矩阵中的4个传感器点）
const DEMO_SENSORS: SensorPoint[] = generateSensorMatrix(8, 8).slice(0, 4).map(s => ({ ...s, selected: true }));
const DEMO_DATA: Record<string, DataRecord[]> = {
  consistency: generateConsistencyData(DEMO_SENSORS, 10, 20, 10, 50),
  repeatability: generateRepeatabilityData(DEMO_SENSORS, 30, 1, 30),
  durability: generateDurabilityData(DEMO_SENSORS, 200),
};

const MODE_LABELS: Record<string, string> = {
  consistency: '一致性检测',
  repeatability: '重复性检测',
  durability: '耐久性检测',
};

const MODE_COLORS: Record<string, string> = {
  consistency: 'oklch(0.70 0.18 200)',
  repeatability: 'oklch(0.72 0.20 145)',
  durability: 'oklch(0.75 0.18 55)',
};

export default function DataLogPage() {
  const [activeMode, setActiveMode] = useState<'consistency' | 'repeatability' | 'durability'>('consistency');
  const [activeView, setActiveView] = useState<'table' | 'stats'>('table');

  const records = DEMO_DATA[activeMode];
  const maxRows = 100;
  const displayRecords = records.slice(-maxRows);

  const handleExport = (mode: string) => {
    const data = DEMO_DATA[mode];
    if (data.length === 0) return;
    exportToCSV(data, `JQ_${MODE_LABELS[mode]}_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const handleExportAll = () => {
    const all = [
      ...DEMO_DATA.consistency,
      ...DEMO_DATA.repeatability,
      ...DEMO_DATA.durability,
    ];
    exportToCSV(all, `JQ_全部数据_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // 统计图数据
  const statsData = Object.entries(DEMO_DATA).map(([mode, recs]) => ({
    name: MODE_LABELS[mode],
    count: recs.length,
    avgPressure: parseFloat((recs.reduce((a, r) => a + r.pressure, 0) / recs.length).toFixed(2)),
    avgADC: Math.round(recs.reduce((a, r) => a + r.adcSum, 0) / recs.length),
  }));

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      {/* 顶部统计卡片 */}
      <div className="grid grid-cols-3 gap-3">
        {Object.entries(DEMO_DATA).map(([mode, recs]) => (
          <div
            key={mode}
            className="rounded p-3 cursor-pointer transition-all"
            style={{
              background: activeMode === mode ? 'oklch(0.20 0.03 265)' : 'oklch(0.17 0.025 265)',
              border: `1px solid ${activeMode === mode ? MODE_COLORS[mode] + ' / 0.5' : 'oklch(0.25 0.03 265)'}`,
            }}
            onClick={() => setActiveMode(mode as any)}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono" style={{ color: 'oklch(0.60 0.02 240)' }}>
                {MODE_LABELS[mode]}
              </span>
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: MODE_COLORS[mode] }}
              />
            </div>
            <div className="text-2xl font-mono font-semibold" style={{ color: MODE_COLORS[mode] }}>
              {recs.length}
            </div>
            <div className="text-xs font-mono mt-0.5" style={{ color: 'oklch(0.45 0.02 240)' }}>
              条数据记录
            </div>
            <button
              onClick={e => { e.stopPropagation(); handleExport(mode); }}
              className="mt-2 flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded transition-colors"
              style={{
                background: 'oklch(0.22 0.03 265)',
                border: '1px solid oklch(0.30 0.03 265)',
                color: 'oklch(0.60 0.02 240)',
              }}
            >
              <Download size={10} />
              导出CSV
            </button>
          </div>
        ))}
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {[
            { id: 'table', label: '数据表格', icon: <FileText size={11} /> },
            { id: 'stats', label: '统计图表', icon: <BarChart2 size={11} /> },
          ].map(v => (
            <button
              key={v.id}
              onClick={() => setActiveView(v.id as any)}
              className="flex items-center gap-1 px-3 py-1 rounded text-xs font-mono transition-all"
              style={{
                background: activeView === v.id ? 'oklch(0.58 0.22 265 / 0.2)' : 'oklch(0.17 0.025 265)',
                border: `1px solid ${activeView === v.id ? 'oklch(0.58 0.22 265 / 0.5)' : 'oklch(0.25 0.03 265)'}`,
                color: activeView === v.id ? 'oklch(0.70 0.18 200)' : 'oklch(0.55 0.02 240)',
              }}
            >
              {v.icon}
              {v.label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <button
            onClick={handleExportAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-medium transition-all"
            style={{
              background: 'oklch(0.58 0.22 265)',
              color: 'white',
            }}
          >
            <Download size={12} />
            导出全部数据
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0">
        {activeView === 'table' && (
          <div
            className="h-full flex flex-col rounded overflow-hidden"
            style={{ border: '1px solid oklch(0.22 0.03 265)' }}
          >
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{ background: 'oklch(0.17 0.025 265)', borderBottom: '1px solid oklch(0.22 0.03 265)' }}
            >
              <div className="flex items-center gap-2">
                <Database size={12} style={{ color: MODE_COLORS[activeMode] }} />
                <span className="text-xs font-mono" style={{ color: 'oklch(0.75 0.01 220)' }}>
                  {MODE_LABELS[activeMode]}
                </span>
                <span
                  className="px-1.5 py-0.5 rounded text-xs font-mono"
                  style={{ background: 'oklch(0.22 0.03 265)', color: 'oklch(0.55 0.02 240)' }}
                >
                  {records.length} 条
                </span>
              </div>
              <span className="text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)' }}>
                CSV格式：Time, Pressure, ADC Value, ADC Sum
              </span>
            </div>
            <div className="flex-1 overflow-auto" style={{ background: 'oklch(0.13 0.02 265)' }}>
              <table className="w-full text-xs font-mono" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'oklch(0.17 0.025 265)', position: 'sticky', top: 0, zIndex: 1 }}>
                    {['#', 'Time', 'Pressure (N)', 'ADC Value', 'ADC Sum', 'ADC Sum (HEX)'].map(h => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left"
                        style={{
                          color: 'oklch(0.55 0.02 240)',
                          borderBottom: '1px solid oklch(0.25 0.03 265)',
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRecords.map((r, i) => (
                    <tr
                      key={r.id}
                      style={{
                        borderBottom: '1px solid oklch(0.16 0.02 265)',
                        background: i % 2 === 0 ? 'transparent' : 'oklch(0.15 0.02 265 / 0.4)',
                      }}
                    >
                      <td className="px-3 py-1.5" style={{ color: 'oklch(0.38 0.02 240)' }}>
                        {records.length - displayRecords.length + i + 1}
                      </td>
                      <td className="px-3 py-1.5" style={{ color: 'oklch(0.55 0.02 240)', whiteSpace: 'nowrap' }}>
                        {r.time}
                      </td>
                      <td className="px-3 py-1.5" style={{ color: 'oklch(0.72 0.20 145)' }}>
                        {r.pressure.toFixed(2)}
                      </td>
                      <td className="px-3 py-1.5" style={{ color: 'oklch(0.60 0.02 240)', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.adcValues.join(', ')}
                      </td>
                      <td className="px-3 py-1.5" style={{ color: 'oklch(0.75 0.01 220)' }}>
                        {r.adcSum}
                      </td>
                      <td className="px-3 py-1.5" style={{ color: 'oklch(0.70 0.18 200)' }}>
                        {toHex(r.adcSum)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeView === 'stats' && (
          <div className="grid grid-cols-2 gap-3 h-full">
            {/* 数据量对比 */}
            <div className="chart-container p-3 flex flex-col">
              <div className="text-xs font-mono mb-2" style={{ color: 'oklch(0.70 0.18 200)' }}>
                各模式数据量对比
              </div>
              <div className="flex-1" style={{ minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statsData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.03 265)" strokeOpacity={0.5} />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" }}
                      axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                      tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                    />
                    <YAxis
                      tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                      axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                      tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'oklch(0.17 0.025 265)',
                        border: '1px solid oklch(0.35 0.04 265)',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: '11px',
                        color: 'oklch(0.85 0.01 220)',
                      }}
                    />
                    <Bar dataKey="count" name="数据量" fill="oklch(0.58 0.22 265)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 平均ADC Sum对比 */}
            <div className="chart-container p-3 flex flex-col">
              <div className="text-xs font-mono mb-2" style={{ color: 'oklch(0.70 0.18 200)' }}>
                各模式平均ADC Sum对比
              </div>
              <div className="flex-1" style={{ minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statsData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.03 265)" strokeOpacity={0.5} />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" }}
                      axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                      tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                    />
                    <YAxis
                      tick={{ fill: 'oklch(0.50 0.02 240)', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}
                      axisLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                      tickLine={{ stroke: 'oklch(0.30 0.03 265)' }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'oklch(0.17 0.025 265)',
                        border: '1px solid oklch(0.35 0.04 265)',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: '11px',
                        color: 'oklch(0.85 0.01 220)',
                      }}
                    />
                    <Bar dataKey="avgADC" name="平均ADC Sum" fill="oklch(0.70 0.18 200)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 汇总表 */}
            <div
              className="col-span-2 rounded p-3"
              style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}
            >
              <div className="text-xs font-mono mb-2" style={{ color: 'oklch(0.60 0.02 240)' }}>
                数据汇总
              </div>
              <table className="w-full text-xs font-mono" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['检测模式', '数据量', '平均压力(N)', '平均ADC Sum', '操作'].map(h => (
                      <th
                        key={h}
                        className="text-left pb-2"
                        style={{ color: 'oklch(0.50 0.02 240)', borderBottom: '1px solid oklch(0.25 0.03 265)', paddingRight: '16px' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {statsData.map((s, i) => {
                    const mode = Object.keys(DEMO_DATA)[i];
                    return (
                      <tr key={s.name} style={{ borderBottom: '1px solid oklch(0.20 0.025 265)' }}>
                        <td className="py-2 pr-4" style={{ color: MODE_COLORS[mode] }}>{s.name}</td>
                        <td className="py-2 pr-4" style={{ color: 'oklch(0.75 0.01 220)' }}>{s.count}</td>
                        <td className="py-2 pr-4" style={{ color: 'oklch(0.72 0.20 145)' }}>{s.avgPressure}</td>
                        <td className="py-2 pr-4" style={{ color: 'oklch(0.70 0.18 200)' }}>{s.avgADC}</td>
                        <td className="py-2">
                          <button
                            onClick={() => handleExport(mode)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors"
                            style={{
                              background: 'oklch(0.22 0.03 265)',
                              border: '1px solid oklch(0.30 0.03 265)',
                              color: 'oklch(0.60 0.02 240)',
                            }}
                          >
                            <Download size={9} />
                            CSV
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
