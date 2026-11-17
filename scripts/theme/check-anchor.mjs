/**
 * 验证「已选点位」面板常驻后，矩阵不再随选中状态移动。
 * 依次记录 无选中 → 中心区域 → 清空 三种状态下矩阵网格的矩形，比较是否一致。
 */
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4173';
const OUT = process.argv[3] || 'docs/theme-preview';
const PORT = process.env.CDP_PORT || '9222';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.filter(t => t.type === 'page').find(t => t.url.includes('localhost')) || list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve } = pending.get(m.id); pending.delete(m.id); resolve(m.result); }
};
const send = (method, params = {}) => new Promise(resolve => {
  const mid = ++id; pending.set(mid, { resolve });
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

// 网格列（矩阵区域第一个子元素）的矩形 + 面板宽度
const rectProbe = `(() => {
  const mx = document.querySelector('[data-jk-matrix-area]');
  if (!mx) return 'no-matrix';
  const gridCol = mx.firstElementChild;
  const panel = mx.children[1];
  const r = gridCol.getBoundingClientRect();
  const cells = mx.querySelectorAll('div[style*="border-radius: 2px"]');
  return JSON.stringify({
    grid: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    panelW: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
    cells: cells.length,
  });
})()`;

const clickBtn = txt => ev(`(async () => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '${txt}');
  if (!b) return 'missing:${txt}';
  b.click();
  await new Promise(r => setTimeout(r, 700));
  return 'ok';
})()`, true);

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/?theme=dark` });
await sleep(1200);
await ev(`localStorage.setItem('jq_client_id', JSON.stringify({id:'jq'}));
         localStorage.setItem('matrixRows','16'); localStorage.setItem('matrixCols','16');`);
await send('Page.reload');
await sleep(3000);

const results = {};
results['无选中'] = await ev(rectProbe);
await shot('anchor-none');

await clickBtn('中心区域');
await sleep(500);
results['选中 64 点'] = await ev(rectProbe);
await shot('anchor-selected');

await clickBtn('清空');
await sleep(500);
results['清空后'] = await ev(rectProbe);
await shot('anchor-cleared');

const parsed = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, JSON.parse(v)]));
for (const [state, r] of Object.entries(parsed)) {
  console.log(`${state.padEnd(10)} grid=[${r.grid.join(', ')}]  panelW=${r.panelW}  cells=${r.cells}`);
}
const rects = Object.values(parsed).map(r => r.grid.join(','));
console.log(rects.every(x => x === rects[0]) ? '✓ 三种状态矩阵位置完全一致' : '✗ 矩阵位置发生变化');

ws.close();
