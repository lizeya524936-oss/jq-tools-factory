import { useRef } from 'react';
import { Download, FileUp, Loader2, X } from 'lucide-react';
import type { CsvReferenceState } from './useCsvReference';
import type { CsvScope } from './csvReference';

const number = (value: number | null | undefined, digits = 4) => value == null || !Number.isFinite(value) ? '无法计算' : value.toFixed(digits);

export function CsvUpload({ csv, collecting }: { csv: CsvReferenceState; collecting: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="csv-upload">
    <div className="csv-upload-heading"><div><strong>与历史 CSV 比较</strong><p>上传之前导出的压力–传感器 CSV，按同一组通道的 ADC 平均值叠加比较。</p></div><div className="csv-actions">
      <input ref={input} type="file" accept=".csv,text/csv" multiple hidden aria-label="上传参考 CSV" disabled={collecting || csv.busy} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (!collecting && !csv.busy) void csv.upload(files); }} />
      <button className="button secondary small" disabled={csv.busy || collecting} onClick={() => input.current?.click()}>{csv.busy ? <Loader2 size={16} className="spin" /> : <FileUp size={16} />}{collecting ? '采集中，稍后上传' : csv.busy ? '正在拟合…' : csv.datasets.length ? '替换 CSV' : '上传 CSV（可多选）'}</button>
      {csv.datasets.length > 0 && <button className="text-button" disabled={collecting} onClick={csv.clear} aria-label="清除参考 CSV"><X size={14} />清除</button>}
    </div></div>
    {csv.datasets.length > 0 && <>
      <div className="csv-files">{csv.datasets.map((file, index) => <span key={index}>{file.fileName}</span>)}</div>
      <div className="csv-options"><label>CSV 拟合范围<select aria-label="CSV 拟合范围" value={csv.scope} disabled={csv.busy || collecting} onChange={event => csv.setScope(event.target.value as CsvScope)}><option value="legacy-loading">旧网页兼容 · 全加载段</option><option value="loading-low">加载段 0–20 N 重新拟合</option></select></label><label className="csv-checkbox"><input type="checkbox" checked={csv.excludeSaturated} disabled={csv.busy || collecting} onChange={event => csv.setExcludeSaturated(event.target.checked)} />排除饱和帧</label></div>
      <p className="csv-help">每个文件取至最后峰值的加载段，再合并拟合；默认沿用旧网页零截距 Hill 算法和饱和帧处理。若旧图调整过拟合上限，曲线可能不同。上传、替换或清除 CSV 均保留本次六档采集。</p>
    </>}
    {!csv.datasets.length && <p className="csv-help">支持测试页的逐通道 CSV、一致性页的 ADC Value 列和本页导出的六档测点。最多选择 10 个文件，每个不超过 5 MB。文件仅在本机处理。</p>}
    {csv.error && <p className="inline-error" role="alert">{csv.error}{csv.reference ? '（仍保留上次成功导入的参考曲线。）' : ''}</p>}
  </div>;
}

export function CsvComparison({ csv, demo, hasCurve }: { csv: CsvReferenceState; demo: boolean; hasCurve: boolean }) {
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
    <details className="csv-details"><summary>查看六档差值与 CSV 拟合信息</summary>
      <div className="csv-detail-actions"><span>差值 = 本次测点 − CSV 预测</span><button className="button secondary small" disabled={!comparison.rows.length || !!comparison.blockedReason} onClick={exportDetails}><Download size={14} />对比明细 CSV</button></div>
      <div className="csv-table-scroll"><table><thead><tr><th>砝码</th><th>力 / N</th><th>本次 ADC</th><th>CSV ADC</th><th>差值 / ADC</th><th>状态</th></tr></thead><tbody>{comparison.rows.map(row => <tr key={row.massG}><td>{row.massG} g</td><td>{row.forceN.toFixed(4)}</td><td>{row.measuredADC.toFixed(3)}</td><td>{row.referenceADC === null ? '—' : row.referenceADC.toFixed(3)}</td><td>{row.errorADC === null ? '—' : row.errorADC.toFixed(3)}</td><td>{row.reason || '可比较'}</td></tr>)}</tbody></table></div>
      <div className="csv-equation"><b>CSV Hill 方程 · ADC Avg</b><code>ADC = {reference.offset.toFixed(4)} + {reference.a.toFixed(4)} × P^{reference.n.toFixed(4)} / ({reference.b.toFixed(4)}^{reference.n.toFixed(4)} + P^{reference.n.toFixed(4)})</code><p>拟合范围 {reference.fitMinN.toFixed(3)}–{reference.fitMaxN.toFixed(3)} N · {reference.sampleCount} 个样本 · CSV 自身拟合 R² {number(reference.fitR2)} · RMSE {number(reference.fitRmse, 3)} ADC</p><p>通道：{reference.channels1Based?.join('、') ?? '文件未提供通道编号，请核对选区'}；未饱和覆盖 {reference.minN.toFixed(3)}–{reference.maxN.toFixed(3)} N。</p></div>
      <p className="csv-help">R² = 1 − Σ(基准 ADC − 对比 ADC)² / Σ(基准 ADC − 基准均值)²。六档测点以本次实测为基准，曲线对比以 CSV 预测为基准。少于两个有效值或基准无变化时无法计算。</p>
    </details>
  </div>;
}
