/**
 * DataTable - 数据记录表格组件
 * 显示Time, Pressure, ADC Value, ADC Sum列
 * 支持CSV导出
 */
import { DataRecord, toHex, exportToCSV } from '@/lib/sensorData';
import { Download, Trash2 } from 'lucide-react';

interface DataTableProps {
  records: DataRecord[];
  onClear?: () => void;
  maxRows?: number;
}

export default function DataTable({ records, onClear, maxRows = 50 }: DataTableProps) {
  const displayRecords = records.slice(-maxRows);

  const handleExport = () => {
    if (records.length === 0) return;
    const modeMap = { consistency: '一致性', repeatability: '重复性', durability: '耐久性' };
    const mode = records[0]?.testMode ? modeMap[records[0].testMode] : '检测';
    exportToCSV(records, `JQ_${mode}_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono" style={{ color: 'oklch(0.70 0.18 200)' }}>
            数据记录
          </span>
          <span
            className="px-1.5 py-0.5 rounded text-xs font-mono"
            style={{
              background: 'oklch(0.22 0.03 265)',
              color: 'oklch(0.60 0.02 240)',
            }}
          >
            {records.length} 条
          </span>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={handleExport}
            disabled={records.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors disabled:opacity-40"
            style={{
              background: 'oklch(0.58 0.22 265 / 0.15)',
              border: '1px solid oklch(0.58 0.22 265 / 0.3)',
              color: 'oklch(0.70 0.18 200)',
            }}
          >
            <Download size={11} />
            导出CSV
          </button>
          {onClear && (
            <button
              onClick={onClear}
              disabled={records.length === 0}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors disabled:opacity-40"
              style={{
                background: 'oklch(0.65 0.22 25 / 0.10)',
                border: '1px solid oklch(0.65 0.22 25 / 0.25)',
                color: 'oklch(0.65 0.22 25)',
              }}
            >
              <Trash2 size={11} />
              清空
            </button>
          )}
        </div>
      </div>

      {/* 表格 */}
      <div
        className="flex-1 overflow-auto rounded"
        style={{
          background: 'oklch(0.13 0.02 265)',
          border: '1px solid oklch(0.22 0.03 265)',
        }}
      >
        {records.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-sm font-mono" style={{ color: 'oklch(0.40 0.02 240)' }}>
                暂无记录
              </div>
              <div className="text-xs font-mono mt-1" style={{ color: 'oklch(0.30 0.02 240)' }}>
                开始检测后数据将显示在此处
              </div>
            </div>
          </div>
        ) : (
          <table className="w-full text-xs font-mono" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'oklch(0.17 0.025 265)', position: 'sticky', top: 0, zIndex: 1 }}>
                {['#', 'Time', 'Pressure(N)', 'ADC Value', 'ADC Sum (HEX)'].map(h => (
                  <th
                    key={h}
                    className="px-2 py-1.5 text-left"
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
                    borderBottom: '1px solid oklch(0.18 0.02 265)',
                    background: i % 2 === 0 ? 'transparent' : 'oklch(0.15 0.02 265 / 0.5)',
                  }}
                >
                  <td className="px-2 py-1" style={{ color: 'oklch(0.40 0.02 240)' }}>
                    {records.length - displayRecords.length + i + 1}
                  </td>
                  <td className="px-2 py-1" style={{ color: 'oklch(0.55 0.02 240)', whiteSpace: 'nowrap' }}>
                    {r.time.slice(11)}
                  </td>
                  <td className="px-2 py-1" style={{ color: 'oklch(0.72 0.20 145)' }}>
                    {r.pressure.toFixed(2)}
                  </td>
                  <td className="px-2 py-1" style={{ color: 'oklch(0.60 0.02 240)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.adcValues.slice(0, 4).join(', ')}{r.adcValues.length > 4 ? '...' : ''}
                  </td>
                  <td className="px-2 py-1" style={{ color: 'oklch(0.70 0.18 200)' }}>
                    {toHex(r.adcSum)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {records.length > maxRows && (
        <div className="mt-1 text-xs font-mono text-right" style={{ color: 'oklch(0.45 0.02 240)' }}>
          显示最新 {maxRows} 条，共 {records.length} 条
        </div>
      )}
    </div>
  );
}
