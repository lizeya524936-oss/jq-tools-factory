/**
 * 通过 CDP 截图真实应用（含登录态），用于验证双主题在主页面的实际效果。
 *
 * 前置：Edge 以 --remote-debugging-port 启动；vite preview 在 4173 端口。
 * 用法：node scripts/theme/shot-cdp.mjs <baseUrl> <outDir>
 */
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4173';
const OUT = process.argv[3] || 'docs/theme-preview';
const PORT = process.env.CDP_PORT || '9222';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find(t => t.type === 'page');
if (!target) throw new Error('找不到可用的 page target');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

const sleep = ms => new Promise(r => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');

// 固定视口，保证两张图可直接对比
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
});

const shots = [
  { theme: 'light', name: 'live-home-light', path: '/' },
  { theme: 'dark',  name: 'live-home-dark',  path: '/' },
];

for (const s of shots) {
  const url = `${BASE}${s.path}?theme=${s.theme}`;
  await send('Page.navigate', { url });
  await sleep(1500);

  // 注入登录态（jq 账号，含全部传感器产品）
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('jq_client_id', JSON.stringify({id:'jq'}));`,
  });

  await send('Page.reload');
  await sleep(2500);

  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/${s.name}.png`, Buffer.from(data, 'base64'));
  console.log(`${s.name}.png  ${Buffer.from(data, 'base64').length} bytes`);
}

ws.close();
