import { useRef, useState } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import type { CsvReferenceState } from './useCsvReference';
import type { CsvScope } from './csvReference';
import { CURVE_MAX_N } from './calibration';

const number = (value: number | null | undefined, digits = 4) => value == null || !Number.isFinite(value) ? '无法计算' : value.toFixed(digits);

interface CsvControlsProps {
  csv: CsvReferenceState;
  collecting: boolean;
}

export function CsvUpload({ csv, collecting, onFiles }: CsvControlsProps & { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const count = csv.datasets.length;
  const uploadLabel = count ? '替换 CSV' : '上传 CSV';
  return <>
    <div className="wc-chart-toolbar">
      <h2>压力 &amp; ADC Avg 综合曲线</h2>
      {count > 0 && <span className="wc-file-count">{count} 个文件已导入</span>}
      <div className="wc-file-actions">
        {count > 0 && <button type="button" className="wc-clear" disabled={collecting || csv.busy}
          onClick={csv.clear} aria-label="清除全部参考 CSV">清除全部</button>}
        <input ref={input} type="file" accept=".csv,text/csv" multiple hidden aria-label="上传参考 CSV"
          disabled={collecting || csv.busy} onChange={event => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            onFiles(files);
          }} />
        <button type="button" className="wc-upload-action" disabled={collecting || csv.busy}
          onClick={() => input.current?.click()}
          title={collecting ? '采集完成后可上传参考 CSV' : '点击选择或拖放到图表。可同时导入最多 10 个 CSV，每个不超过 5 MB，新一批将替换全部参考文件。'}>
          {csv.busy ? <Loader2 size={13} className="spin" /> : <Upload size={13} />}
          {csv.busy ? '正在拟合…' : uploadLabel + ' (' + count + '/10)'}
        </button>
      </div>
    </div>
    {csv.error && <p className="inline-error" role="alert">{csv.error}{csv.reference ? '（仍保留上次成功导入的参考曲线。）' : ''}</p>}
  </>;
}

export function CsvFitSettings({ csv, collecting }: CsvControlsProps) {
  return <details className="wc-upload-settings">
    <summary>CSV 格式与拟合设置</summary>
    <p className="csv-help">支持测试页的逐通道 CSV、一致性页的 ADC Value 列和本页导出的六档测点。最多选择 10 个文件，每个不超过 5 MB。</p>
    {csv.datasets.length > 0 && <>
      <div className="csv-options">
        <label>CSV 拟合范围<select aria-label="CSV 拟合范围" value={csv.scope} disabled={csv.busy || collecting}
          onChange={event => csv.setScope(event.target.value as CsvScope)}>
          <option value="legacy-loading">旧网页兼容 · 全加载段</option>
          <option value="loading-low">加载段 0–{CURVE_MAX_N} N 重新拟合</option>
        </select></label>
        <label className="csv-checkbox"><input type="checkbox" checked={csv.excludeSaturated}
          disabled={csv.busy || collecting} onChange={event => csv.setExcludeSaturated(event.target.checked)} />排除饱和帧</label>
      </div>
      <p className="csv-help">每个文件取至最后峰值的加载段，再合并拟合。勾选图例和调节显示范围只影响绘图。</p>
    </>}
  </details>;
}

export function CsvComparison({ csv, demo, hasCurve }: { csv: CsvReferenceState; demo: boolean; hasCurve: boolean }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const reference = csv.reference, comparison = csv.comparison;
  if (!reference || !comparison || csv.busy) return null;
  const exportDetails = () => {
    const rows = [['本次数据来源', '砝码质量(g)', '力(N)', '本次ADC_Avg', 'CSV预测ADC_Avg', '本次减CSV(ADC)', '说明'], ...comparison.rows.map(row => [demo ? '示范模拟数据' : '串口采集', row.massG, row.forceN, row.measuredADC, row.referenceADC ?? '', row.errorADC ?? '', row.reason ?? ''])];
    const content = '\ufeff' + rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${demo ? 'DEMO_' : ''}六档与CSV对比_${Date.now()}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="csv-comparison" data-testid="csv-comparison">
    <div className="csv-result-heading"><strong>六档与 CSV 的一致程度</strong>{demo && <b className="demo-label">本次六档为示范数据</b>}<span>越接近 1，数值越一致；负值会如实显示</span></div>
    {comparison.blockedReason && <p className="result-warning" role="status">{comparison.blockedReason}</p>}
    <div className="csv-metrics">
      <div className="csv-metric"><span>六档测点对比 R²{comparison.pointPartial && ' · 部分覆盖'}</span><strong data-testid="point-r2">{comparison.blockedReason ? '—' : comparison.pointComplete ? number(comparison.pointMetrics?.r2) : '待完成六档'}</strong><p>在各砝码力值处，用 CSV 曲线预测 ADC，与本次实测值比较。</p><small>有效对比 {comparison.pointMetrics?.count ?? 0}/6 点 · RMSE {comparison.pointMetrics?.rmse == null ? '—' : number(comparison.pointMetrics.rmse, 3)} ADC</small></div>
      <div className="csv-metric"><span>曲线对比 R²</span><strong data-testid="curve-r2">{comparison.blockedReason ? '—' : !hasCurve ? '待生成曲线' : number(comparison.curveMetrics?.r2)}</strong><p>以 CSV 曲线为基准，对比本次六档拟合曲线。</p><small>{comparison.curveRange ? `${comparison.curveRange[0].toFixed(3)}–${comparison.curveRange[1].toFixed(3)} N · ${comparison.curveMetrics?.count ?? 0} 个等距位置` : '共同实测范围内比较'} · RMSE {comparison.curveMetrics?.rmse == null ? '—' : number(comparison.curveMetrics.rmse, 3)} ADC</small></div>
    </div>
    <p className="csv-help">两项 R² 的基准不同，数值不必相等；它们不等于下方「非零档 R²」。曲线对比仅使用双方共同的未饱和实测范围，不计入本次最高实测力以上的外推段，也不随图表缩放改变。</p>
    {[...new Set([...reference.warnings, ...comparison.warnings])].map((warning, index) => <p className="result-warning" key={index}>{warning}</p>)}
    <details className="csv-details" open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}><summary>查看六档差值明细</summary>
      <div className="csv-detail-actions"><span>差值 = 本次测点 − CSV 预测</span><button className="button secondary small" disabled={!comparison.rows.length || !!comparison.blockedReason} onClick={exportDetails}><Download size={14} />对比明细 CSV</button></div>
      <div className="csv-table-scroll"><table><thead><tr><th>砝码</th><th>力 / N</th><th>本次 ADC</th><th>CSV ADC</th><th>差值 / ADC</th><th>状态</th></tr></thead><tbody>{comparison.rows.map(row => <tr key={row.massG}><td>{row.massG} g</td><td>{row.forceN.toFixed(4)}</td><td>{row.measuredADC.toFixed(3)}</td><td>{row.referenceADC === null ? '—' : row.referenceADC.toFixed(3)}</td><td>{row.errorADC === null ? '—' : row.errorADC.toFixed(3)}</td><td>{row.reason || '可比较'}</td></tr>)}</tbody></table></div>
      <p className="csv-help">CSV 选区通道：{reference.channels1Based?.join('、') ?? '文件未提供编号，请核对选区'}。</p>
      <p className="csv-help">R² = 1 − Σ(基准 ADC − 对比 ADC)² / Σ(基准 ADC − 基准均值)²。六档测点以本次实测为基准，曲线对比以 CSV 预测为基准。少于两个有效值或基准无变化时无法计算。</p>
    </details>
  </div>;
}
