/**
 * 布局验证截图：登录态下截一致性页 16×16 / 32×32 两种矩阵尺寸。
 * 前置：vite preview 在 4173；Edge 开 --remote-debugging-port=9222。
 */
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4173';
const OUT = process.argv[3] || 'docs/theme-preview';
const PORT = process.env.CDP_PORT || '9222';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find(t => t.type === 'page');
if (!target) throw new Error('no page target');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mid = ++id;
  pending.set(mid, { resolve, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function evaluate(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.result));
  return r.result?.value;
}

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log(`${name}.png  ${Buffer.from(data, 'base64').length} bytes`);
};

await send('Page.enable');
await send('Runtime.enable');

// 用接近真实使用的大窗口，便于判断"显示面积"是否够
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
});

await send('Page.navigate', { url: `${BASE}/?theme=dark` });
await sleep(1500);
await evaluate(`localStorage.setItem('jq_client_id', JSON.stringify({id:'jq'}));
                localStorage.setItem('matrixRows','16');
                localStorage.setItem('matrixCols','16');`);
await send('Page.reload');
await sleep(3000);

// 报告当前的滚动与尺寸情况
const probe = `(() => {
  const main = document.querySelector('main');
  const matrix = document.querySelector('[data-jk-matrix]');
  return {
    mainScrollable: main ? main.scrollHeight > main.clientHeight + 1 : null,
    mainScrollH: main?.scrollHeight, mainClientH: main?.clientHeight,
    docScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  };
})()`;
console.log('16x16 布局探测:', JSON.stringify(await evaluate(probe)));

await shot('layout-16x16-dark');

// 切到 32×32：点击「尺寸」→ 输入 32 → 应用
const setSize = `(async () => {
  const findBtn = (txt) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === txt);
  const sizeBtn = findBtn('尺寸');
  if (!sizeBtn) return 'no-size-button';
  sizeBtn.click();
  await new Promise(r => setTimeout(r, 350));

  const setNative = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll('input[type=number]')];
  if (inputs.length < 2) return 'inputs:' + inputs.length;
  setNative(inputs[0], 32);
  setNative(inputs[1], 32);
  await new Promise(r => setTimeout(r, 250));

  const applyBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '应用');
  if (!applyBtn) return 'no-apply';
  applyBtn.click();
  await new Promise(r => setTimeout(r, 900));
  return 'ok';
})()`;
console.log('切换 32×32:', await evaluate(setSize, true));
await sleep(1200);

console.log('32x32 布局探测:', JSON.stringify(await evaluate(probe)));
await shot('layout-32x32-dark');

// 浅色主题也存一张，便于看对比度
await evaluate(`document.documentElement.classList.remove('dark')`);
await sleep(600);
await shot('layout-32x32-light');

ws.close();
