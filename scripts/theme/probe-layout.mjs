/** 测量一致性页左栏各卡片高度，用于定位"矩阵显示面积小"的空间去哪了。 */
const PORT = process.env.CDP_PORT || '9222';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const targets = list.filter(t => t.type === 'page');
console.log('targets:', targets.map(t => t.url).join(' | '));

const target = targets.find(t => t.url.includes('localhost')) || targets[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve } = pending.get(m.id);
    pending.delete(m.id);
    resolve(m.result);
  }
};
const send = (method, params = {}) => new Promise(resolve => {
  const mid = ++id;
  pending.set(mid, { resolve });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) return 'ERR:' + r.exceptionDetails.text;
  return r.result?.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: 'http://localhost:4173/?theme=dark' });
await sleep(1200);
await ev(`localStorage.setItem('jq_client_id', JSON.stringify({id:'jq'}));
          localStorage.setItem('matrixRows','16'); localStorage.setItem('matrixCols','16');`);
await send('Page.reload');
await sleep(3000);

const probe = `(() => {
  const main = document.querySelector('main');
  if (!main) return 'no-main';
  const root = main.firstElementChild;
  const col = root && root.firstElementChild;
  if (!col) return 'no-col';
  const out = { mainH: main.clientHeight, colW: Math.round(col.getBoundingClientRect().width), colH: Math.round(col.getBoundingClientRect().height), kids: [] };
  [...col.children].forEach((k, i) => {
    const r = k.getBoundingClientRect();
    out.kids.push({ i, h: Math.round(r.height), t: (k.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 18) });
  });
  return JSON.stringify(out, null, 1);
})()`;
console.log(await ev(probe));
ws.close();
