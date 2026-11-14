/** 逐页检查传感器矩阵：内部不得滚动、不得裁切（网格底部必须落在容器内）。 */
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

const probe = `(() => {
  const mx = document.querySelector('[data-jk-matrix-area]');
  if (!mx) return 'no-matrix';
  const col = mx.firstElementChild;
  const cRect = col.getBoundingClientRect();
  const mRect = mx.getBoundingClientRect();
  const inner = mx.querySelector('div');  // 网格列
  const cells = mx.querySelectorAll('div[style*="border-radius: 2px"]');
  return JSON.stringify({
    matrixScroll: mx.scrollHeight > mx.clientHeight + 1 || mx.scrollWidth > mx.clientWidth + 1,
    area: [Math.round(mRect.width), Math.round(mRect.height)],
    gridCol: [Math.round(cRect.width), Math.round(cRect.height)],
    clipped: cRect.bottom > mRect.bottom + 1 || cRect.right > mRect.right + 1,
    cells: cells.length,
    pageScrollable: (() => { const m = document.querySelector('main'); return m ? m.scrollHeight > m.clientHeight + 1 : null; })(),
  });
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/?theme=dark` });
await sleep(1200);
await ev(`localStorage.setItem('jq_client_id', JSON.stringify({id:'jq'}));
         localStorage.setItem('matrixRows','16'); localStorage.setItem('matrixCols','16');`);
await send('Page.reload');
await sleep(3000);

for (const tab of ['一致性', '测试页', '重复性', '耐久性']) {
  const ok = await ev(`(async () => {
    const el = [...document.querySelectorAll('button,div,a')].find(e => (e.textContent || '').trim().startsWith('${tab}'));
    if (!el) return 'missing';
    el.click();
    await new Promise(r => setTimeout(r, 900));
    return 'ok';
  })()`, true);
  await sleep(900);
  console.log(`${tab.padEnd(4)} ${ok}  ${await ev(probe)}`);
  await shot(`page-${tab}-16x16`);
}

ws.close();
