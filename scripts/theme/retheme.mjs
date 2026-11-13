/**
 * 把组件里的内联 oklch() 字面量替换为语义变量 var(--jk-*)。
 *
 * 背景：全站配色散落在 22 个组件的 1245 处内联 style 里。内联样式优先级高于 CSS，
 * 不抽成变量的话，亮色主题根本无法生效。
 *
 * 策略：
 *   1. 按「色相 + 彩度 + 明度」把原始字面量归到有限的语义槽位；
 *   2. 带 alpha 的（oklch(... / 0.3)）转成 color-mix(in srgb, var(--slot) 30%, transparent)；
 *   3. 含 ${...} 的动态插值一律跳过（那是数据驱动的热力色，本来就该逐帧算）；
 *   4. 长尾色相（图表系列色等）跳过，保持原样。
 *
 * 用法：node scripts/theme/retheme.mjs          # 试运行，只出报告
 *       node scripts/theme/retheme.mjs --write  # 实际改写文件
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'client', 'src');
const WRITE = process.argv.includes('--write');

const OKLCH = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)/g;

/** 中性面色阶（H≈265）按明度分档 —— 面 / 线 */
function surfaceSlot(L) {
  if (L < 0.105) return '--jk-bg-deep';
  if (L < 0.125) return '--jk-bg';
  if (L < 0.145) return '--jk-sunken';
  if (L < 0.165) return '--jk-s1';
  if (L < 0.185) return '--jk-s2';
  if (L < 0.212) return '--jk-s3';
  if (L < 0.238) return '--jk-s4';
  if (L < 0.262) return '--jk-line-1';
  if (L < 0.292) return '--jk-line-2';
  if (L < 0.318) return '--jk-line-3';
  if (L < 0.372) return '--jk-line-4';
  return '--jk-surface-hi';
}

/** 文字灰阶（H≈240）按明度分档 */
function textSlot(L) {
  if (L < 0.32) return '--jk-text-faint';
  if (L < 0.43) return '--jk-text-dim';
  if (L < 0.49) return '--jk-text-low';
  if (L < 0.53) return '--jk-text-mid';
  if (L < 0.58) return '--jk-text-body';
  if (L < 0.68) return '--jk-text-high';
  if (L < 0.75) return '--jk-text-strong';
  return '--jk-text-max';
}

/** 色相距离（考虑 360 环绕） */
const hueDist = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * 核心映射：返回变量名；返回 null 表示保留原样。
 */
function mapToSlot(L, C, H) {
  // —— 中性蓝紫系（面 / 线 / 主色）——
  if (hueDist(H, 265) <= 12) {
    if (C >= 0.15) return '--jk-primary';          // 原蓝紫主色 → 新主色
    if (C >= 0.09) return '--jk-primary-soft';     // 主色的弱化态
    if (L >= 0.55) return '--jk-line-4';           // 偏亮的中性细线
    return surfaceSlot(L);
  }
  // —— 灰蓝系 ——
  if (hueDist(H, 240) <= 12) {
    if (C >= 0.15) return '--jk-primary';
    return textSlot(L);
  }
  // —— 偏白/亮文字 ——
  if (hueDist(H, 220) <= 12) {
    if (L >= 0.70) return '--jk-ink';
    return textSlot(L);
  }
  // —— 语义强调色 ——
  if (hueDist(H, 200) <= 10) return '--jk-accent';      // 青
  if (hueDist(H, 180) <= 10) return '--jk-accent-2';    // 蓝绿
  if (hueDist(H, 145) <= 12) return '--jk-ok';          // 通过绿
  if (hueDist(H, 55) <= 4) return '--jk-warn';          // 警示黄
  if (hueDist(H, 25) <= 8) return '--jk-danger';        // 失败红

  return null; // 长尾色相：图表系列色，保持原样
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'ui') continue; // shadcn 原语不动
      walk(p, out);
    } else if (/\.(tsx?|css)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(SRC).filter(f => !/index\.css$/.test(f));
const stats = new Map();
const skipped = new Map();
let totalReplaced = 0;
let filesChanged = 0;
const fileReports = [];

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  if (!before.includes('oklch(')) continue;

  let count = 0;
  const after = before.replace(/oklch\([^()]*\)/g, (raw) => {
    // 动态插值：保持原样
    if (raw.includes('${')) {
      skipped.set(raw, (skipped.get(raw) || 0) + 1);
      return raw;
    }
    const m = OKLCH.exec(raw);
    OKLCH.lastIndex = 0;
    if (!m) {
      skipped.set(raw, (skipped.get(raw) || 0) + 1);
      return raw;
    }
    const L = parseFloat(m[1]);
    const C = parseFloat(m[2]);
    const H = parseFloat(m[3]);
    const A = m[4] ? parseFloat(m[4]) : null;

    const slot = mapToSlot(L, C, H);
    if (!slot) {
      skipped.set(raw, (skipped.get(raw) || 0) + 1);
      return raw;
    }

    count++;
    const key = `${slot}${A !== null ? ` @${A}` : ''}`;
    stats.set(key, (stats.get(key) || 0) + 1);

    if (A === null) return `var(${slot})`;
    const pct = Math.round(A * 1000) / 10; // 保留一位小数
    return `color-mix(in srgb, var(${slot}) ${pct}%, transparent)`;
  });

  if (after !== before) {
    filesChanged++;
    totalReplaced += count;
    fileReports.push({ file: path.relative(ROOT, file), count });
    if (WRITE) fs.writeFileSync(file, after, 'utf8');
  }
}

console.log(`模式: ${WRITE ? '实际改写' : '试运行（未写盘）'}`);
console.log(`涉及文件: ${filesChanged}    替换处数: ${totalReplaced}\n`);
console.log('=== 各文件替换数 ===');
for (const r of fileReports.sort((a, b) => b.count - a.count)) {
  console.log(`${String(r.count).padStart(5)}  ${r.file}`);
}
console.log('\n=== 命中槽位分布 ===');
for (const [k, v] of [...stats.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(v).padStart(5)}  ${k}`);
}
console.log('\n=== 保留原样的（动态插值 / 长尾系列色）===');
let skippedTotal = 0;
for (const [k, v] of [...skipped.entries()].sort((a, b) => b[1] - a[1])) {
  skippedTotal += v;
  console.log(`${String(v).padStart(5)}  ${k}`);
}
console.log(`\n保留合计: ${skippedTotal} 处`);
