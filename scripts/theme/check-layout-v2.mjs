/**
 * 布局验收口径（v1.9.45 起）：
 *   - 矩阵区域【内部】不允许滚动（matrixScroll 必须为 false）
 *   - 页面本身【允许】滚动（用户上传 CSV 后要看下方的分析与图表）
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

const probe = `(() => {
  const main = document.querySelector('main');
  const mx = document.querySelector('[data-jk-matrix-area]');
  const grid = mx ? mx.querySelector('div') : null;
  return JSON.stringify({
    matrixScroll: mx ? mx.scrollHeight > mx.clientHeight + 1 || mx.scrollWidth > mx.clientWidth + 1 : null,
    matrixBox: mx ? [Math.round(mx.clientWidth), Math.round(mx.clientHeight)] : null,
    pageScrollable: main ? main.scrollHeight > main.clientHeight + 1 : null,
    mainScrollH: main?.scrollHeight, mainClientH: main?.clientHeight,
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

for (const vp of [{ w: 1440, h: 900 }, { w: 1920, h: 1040 }]) {
  await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${BASE}/?theme=dark` });
  await sleep(1200);
  await ev(`localStorage.setItem('jq_client_id', JSON.stringify({id:'jq'}));
           localStorage.setItem('matrixRows','16'); localStorage.setItem('matrixCols','16');`);
  await send('Page.reload');
  await sleep(2800);

  console.log(`\n=== ${vp.w}x${vp.h} ===`);
  console.log('16×16 无选中:', await ev(probe));
  await shot(`v2-16-none-${vp.w}`);
  await clickBtn('中心区域');
  console.log('16×16 选中:', await ev(probe));
  await shot(`v2-16-sel-${vp.w}`);

  // 32×32
  await ev(`(async () => {
    const findBtn = t => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t);
    findBtn('尺寸')?.click();
    await new Promise(r => setTimeout(r, 300));
    const setNative = (el, v) => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const ins = [...document.querySelectorAll('input[type=number]')];
    setNative(ins[0], 32); setNative(ins[1], 32);
    await new Promise(r => setTimeout(r, 200));
    findBtn('应用')?.click();
    await new Promise(r => setTimeout(r, 900));
    return 'ok';
  })()`, true);
  await sleep(500);
  console.log('32×32 无选中:', await ev(probe));
  await shot(`v2-32-none-${vp.w}`);
  await clickBtn('全选');
  console.log('32×32 全选:', await ev(probe));
  await shot(`v2-32-all-${vp.w}`);
}

ws.close();
