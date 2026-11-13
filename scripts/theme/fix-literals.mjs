/**
 * 收尾：处理 retheme.mjs 覆盖不到的字面量颜色。
 * 全部走 Node 的 UTF-8 读写（不要用 PowerShell Get-Content -Raw / Set-Content 改这些文件，
 * 在中文环境会按 ANSI 解码、吃掉汉字后面的 ASCII 字符）。
 */
import fs from 'node:fs';

const R = process.cwd();
const read = f => fs.readFileSync(`${R}/${f}`, 'utf8');
const write = (f, s) => fs.writeFileSync(`${R}/${f}`, s, 'utf8');

const tasks = [
  // 主色底上的文字：暗色主题是深色字，亮色主题是白字 → 统一用语义变量
  ['client/src/components/SensorMatrix.tsx', [
    [`background: 'var(--jk-primary)', color: 'white'`,
     `background: 'var(--jk-primary)', color: 'var(--jk-on-primary)'`],
  ]],
  ['client/src/components/Sidebar.tsx', [
    [`fontWeight: 700, color: 'white'`, `fontWeight: 700, color: 'var(--jk-on-primary)'`],
  ]],
  ['client/src/pages/RepeatabilityPage.tsx', [
    [`color: 'white',`, `color: 'var(--jk-on-primary)',`],
    [`style={{ borderColor: 'white', borderTopColor: 'transparent' }}`,
     `style={{ borderColor: 'var(--jk-on-primary)', borderTopColor: 'transparent' }}`],
  ]],
  // 主色底上的深色文字
  ['client/src/components/PressController.tsx', [[`'#0a0e1a'`, `'var(--jk-on-primary)'`]]],
  ['client/src/pages/LoginPage.tsx', [[`'#0a0e1a'`, `'var(--jk-on-primary)'`]]],
  // 原生 <option>：不能继承 CSS 变量以外的主题，直接给语义色
  ['client/src/components/SerialConnectPanel.tsx', [
    [`background: '#16213e', color: '#e0e0e0'`,
     `background: 'var(--jk-s2)', color: 'var(--jk-ink)'`],
  ]],
  // 拟合曲线橙：亮色主题需要更深一档，抽成变量
  ['client/src/components/DataChart.tsx', [[`'#f0a030'`, `'var(--jk-fit)'`]]],
  ['client/src/pages/ConsistencyPage.tsx', [
    [`'#f0a030'`, `'var(--jk-fit)'`],
    [`stroke="#f0a030"`, `stroke="var(--jk-fit)"`],
  ]],
];

let hits = 0;
for (const [file, pairs] of tasks) {
  let s = read(file);
  const before = s;
  for (const [a, b] of pairs) {
    const n = s.split(a).length - 1;
    if (n) { s = s.split(a).join(b); hits += n; }
  }
  if (s !== before) write(file, s);
}

// 单独处理 RepeatabilityPage 里的 stroke 形式
{
  const f = 'client/src/pages/RepeatabilityPage.tsx';
  let s = read(f);
  const n = s.split(`stroke="#f0a030"`).length - 1;
  if (n) { s = s.split(`stroke="#f0a030"`).join(`stroke="var(--jk-fit)"`); write(f, s); hits += n; }
}

console.log(`字面量修复完成，共 ${hits} 处`);

// 校验：不该再有残留
const leftovers = [];
for (const [file] of tasks) {
  const s = read(file);
  for (const pat of [`color: 'white'`, `#0a0e1a`, `#16213e`, `#e0e0e0`, `#f0a030`]) {
    if (s.includes(pat)) leftovers.push(`${file} 仍含 ${pat}`);
  }
}
console.log(leftovers.length ? '⚠ 仍有残留:\n' + leftovers.join('\n') : '✓ 无残留');
