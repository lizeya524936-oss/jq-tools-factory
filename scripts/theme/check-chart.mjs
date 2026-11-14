/**
 * 验证两件事：
 *   1) 上传 CSV 后综合曲线是否真的画出来了（统计 Recharts 生成的 path 数量）
 *   2) 矩阵容器下方是否还有多余空白（对比容器高度与网格列高度）
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:4173';
const OUT = process.argv[3] || 'docs/theme-preview';
const PORT = process.env.CDP_PORT || '9222';
const TMP = path.join(process.env.TEMP || '.', 'jq-csv-fixtures');

// ---- 生成两份格式A的 CSV（表头含 压力(N)）----
fs.mkdirSync(TMP, { recursive: true });
const ranges = [
  { name: 'csvA', scale: 1.0 },
  { name: 'csvB', scale: 1.08 },
];
const files = [];
for (const r of ranges) {
  const lines = ['时间,压力(N),传感器#1,传感器#2,传感器#3'];
  for (let i = 0; i < 40; i++) {
    const p = (i / 39) * 100;
    const adc = Math.round((180 + 90 * Math.sqrt(i / 39)) * r.scale);
    lines.push(`0.${String(i).padStart(3, '0')},${p.toFixed(1)},${adc},${adc + 2},${adc - 3}`);
  }
  const f = path.join(TMP, `${r.name}.csv`);
  fs.writeFileSync(f, '\uFEFF' + lines.join('\n'), 'utf8');
  files.push(f);
}
console.log('样例 CSV:', files.join(', '));

// ---- CDP ----
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.filter(t => t.type === 'page').find(t => t.url.includes('localhost')) || list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mid = ++id; pending.set(mid, { resolve, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const ev = async (expr, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) return 'ERR:' + r.exceptionDetails.text;
  return r.result?.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async name => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
};

await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1876, height: 877, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/?theme=dark` });
await sleep(1200);
await ev(`localStorage.setItem('jq_client_id', JSON.stringify({id:'jq'}));
         localStorage.setItem('matrixRows','16'); localStorage.setItem('matrixCols','16');`);
await send('Page.reload');
await sleep(3000);

// 1) 矩阵空白量
const boxProbe = `(() => {
  const mx = document.querySelector('[data-jk-matrix-area]');
  if (!mx) return 'no-matrix';
  const gridCol = mx.firstElementChild;
  const sidePanel = mx.children[1];
  return JSON.stringify({
    areaH: Math.round(mx.clientHeight),
    areaW: Math.round(mx.clientWidth),
    gridColH: gridCol ? Math.round(gridCol.getBoundingClientRect().height) : null,
    sidePanelW: sidePanel ? Math.round(sidePanel.getBoundingClientRect().width) : 0,
    leftoverV: gridCol ? Math.round(mx.clientHeight - gridCol.getBoundingClientRect().height) : null,
    leftoverH: gridCol ? Math.round(mx.clientWidth - gridCol.getBoundingClientRect().width) : null,
  });
})()`;
console.log('矩阵空间:', await ev(boxProbe));

// 换个更矮的窗口再看一次留白（用户截图里的窗口比 1876×877 更矮）
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 700, deviceScaleFactor: 1, mobile: false });
await send('Page.reload', { ignoreCache: true });
await sleep(3000);
console.log('矩阵空间 @1400×700:', await ev(boxProbe));
await shot('matrix-1400x700');
await send('Emulation.setDeviceMetricsOverride', { width: 1876, height: 877, deviceScaleFactor: 1, mobile: false });
await send('Page.reload', { ignoreCache: true });
await sleep(3000);

// 2) 上传 CSV
const doc = await send('DOM.getDocument', { depth: -1 });
const sel = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file][accept=".csv"]' });
if (!sel.nodeId) {
  console.log('找不到 CSV 文件输入框');
} else {
  await send('DOM.setFileInputFiles', { nodeId: sel.nodeId, files });
  await sleep(4000);
}

// 3) 曲线是否渲染
const chartProbe = `(() => {
  const svgs = [...document.querySelectorAll('svg')];
  const recharts = svgs.filter(s => s.className.baseVal !== undefined && /recharts/i.test(s.className.baseVal));
  let curves = 0, dots = 0;
  document.querySelectorAll('path.recharts-curve, path.recharts-line-curve').forEach(() => curves++);
  document.querySelectorAll('circle.recharts-dot').forEach(() => dots++);
  const legend = [...document.querySelectorAll('span')].filter(s => /个文件已导入/.test(s.textContent||'')).map(s => s.textContent.trim())[0] || null;
  return JSON.stringify({ rechartsSvgs: recharts.length, curves, dots, importedLabel: legend });
})()`;
console.log('图表元素:', await ev(chartProbe));
console.log('页面滚动:', await ev(`JSON.stringify({ pageScrollable: (() => { const m = document.querySelector('main'); return m ? m.scrollHeight > m.clientHeight + 1 : null; })() })`));

await shot('chart-1876');
await ev(`document.querySelector('main').scrollTop = 400`);
await sleep(600);
await shot('chart-1876-scrolled');

ws.close();
