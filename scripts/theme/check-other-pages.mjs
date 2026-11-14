/** 检查其它使用 SensorMatrix 的页面（耐久性/重复性/测试页）是否因本次改动出现回归。 */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9222';
const OUT = process.argv[2] || 'docs/theme-preview';

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

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://localhost:4173/?theme=dark' });
await sleep(1200);
await ev(`localStorage.setItem('jq_client_id', JSON.stringify({id:'jq'}));`);
await send('Page.reload');
await sleep(2800);

const measure = `(() => {
  const main = document.querySelector('main');
  const areas = [...document.querySelectorAll('div')].filter(d => d.className && String(d.className).includes('flex-1 min-h-0 overflow-hidden'));
  const a = areas[0];
  return JSON.stringify({
    mainScroll: main ? main.scrollHeight > main.clientHeight + 1 : null,
    docScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    matrixArea: a ? { w: Math.round(a.getBoundingClientRect().width), h: Math.round(a.getBoundingClientRect().height) } : null,
    cells: a ? a.querySelectorAll('div[style*="border-radius: 2px"]').length : 0,
  });
})()`;

for (const tab of ['耐久性', '重复性', '测试页']) {
  const clicked = await ev(`(async () => {
    const btn = [...document.querySelectorAll('button,div,a')].find(el => (el.textContent || '').trim().startsWith('${tab}'));
    if (!btn) return 'not-found';
    btn.click();
    await new Promise(r => setTimeout(r, 900));
    return 'ok';
  })()`, true);
  await sleep(1000);
  console.log(`${tab}: ${clicked}  ${await ev(measure)}`);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/layout-tab-${tab}.png`, Buffer.from(data, 'base64'));
}

ws.close();
