/** 验证「已选点位」面板落在矩阵右侧，且不改变页面滚动状态。 */
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

const clickBtn = txt => ev(`(async () => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '${txt}');
  if (!b) return 'missing:${txt}';
  b.click();
  await new Promise(r => setTimeout(r, 700));
  return 'ok';
})()`, true);

const probe = `(() => {
  const main = document.querySelector('main');
  return JSON.stringify({
    mainScroll: main ? main.scrollHeight > main.clientHeight + 1 : null,
    docScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
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

console.log('16×16 无选中:', await ev(probe));
await shot('sel-16-none');

console.log('16×16 中心区域选中:', await clickBtn('中心区域'), await ev(probe));
await shot('sel-16-center');

console.log('16×16 全选:', await clickBtn('全选'), await ev(probe));
await shot('sel-16-all');

// 切 32×32
console.log('切 32×32:', await ev(`(async () => {
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
})()`, true));
await sleep(600);
await clickBtn('中心区域');
console.log('32×32 中心区域选中:', await ev(probe));
await shot('sel-32-center');

ws.close();
