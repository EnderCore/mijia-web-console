/**
 * 第三轮令牌迁移：收尾各类残留。
 *
 * 覆盖：
 *  - 状态药丸的 rgba 淡底与描边（如 rgba(217,119,6,0.12)）
 *  - 卡片/控件的兜底边框 var(--mi-border, #xxx) 里的死值时
 *  - 中性半透明叠色 rgba(0,0,0,0.05) —— 应改为随主题的表面凹槽色
 *  - 强调色低透明度描边 rgba(255,103,0,0.3)
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WRITE = process.argv.includes('--write');
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'src');

// 状态色的 rgba 淡底 / 描边 → 语义软底
const RGBA_RULES = [
  // 橙 / 琥珀
  [/rgba\(\s*217\s*,\s*119\s*,\s*6\s*,\s*0\.(12|25)\s*\)/gi, 'var(--mi-status-orange-soft)'],
  [/rgba\(\s*245\s*,\s*158\s*,\s*11\s*,[^)]*\)/gi, 'var(--mi-status-orange-soft)'],
  // 青 / 天蓝
  [/rgba\(\s*2\s*,\s*132\s*,\s*199\s*,\s*0\.(12|25)\s*\)/gi, 'var(--mi-status-cyan-soft)'],
  [/rgba\(\s*14\s*,\s*165\s*,\s*233\s*,[^)]*\)/gi, 'var(--mi-status-cyan-soft)'],
  // 绿
  [/rgba\(\s*16\s*,\s*185\s*,\s*129\s*,[^)]*\)/gi, 'var(--mi-status-green-soft)'],
  [/rgba\(\s*5\s*,\s*150\s*,\s*105\s*,[^)]*\)/gi, 'var(--mi-status-green-soft)'],
  // 红
  [/rgba\(\s*239\s*,\s*68\s*,\s*68\s*,[^)]*\)/gi, 'var(--mi-status-red-soft)'],
  [/rgba\(\s*220\s*,\s*38\s*,\s*38\s*,[^)]*\)/gi, 'var(--mi-status-red-soft)'],
  // 蓝
  [/rgba\(\s*59\s*,\s*130\s*,\s*246\s*,[^)]*\)/gi, 'var(--mi-status-blue-soft)'],
  // 紫
  [/rgba\(\s*139\s*,\s*92\s*,\s*246\s*,[^)]*\)/gi, 'var(--mi-status-violet-soft)'],
  // 强调色低透描边 / 淡底
  [/rgba\(\s*255\s*,\s*103\s*,\s*0\s*,\s*0\.(05|1|12|15|2|25|3)\s*\)/gi, 'var(--mi-accent-soft)'],
  // 中性黑叠色（凹槽/分隔）→ 随主题的表面色，避免暗色下变成"更黑"
  [/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\.(04|05|06|08)\s*\)/gi, 'var(--mi-control-sub-bg)'],
  // 中性白叠色（暗色下的高光）→ 次级卡片色
  [/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.(06|08|1|12|15)\s*\)/gi, 'var(--mi-card-sub-bg)']
];

// var(--mi-x, #fallback) 里的死值兜底：令牌一定存在，兜底值只会误导
const FALLBACK_STRIP = [
  [/var\(--mi-border,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--mi-border)'],
  [/var\(--mi-card-bg,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--mi-card-bg)'],
  [/var\(--mi-card-sub-bg,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--mi-card-sub-bg)'],
  [/var\(--mi-control-sub-bg,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--mi-control-sub-bg)'],
  [/var\(--mi-control-bg,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--mi-control-bg)'],
  [/var\(--mi-text-main,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--mi-text-main)'],
  [/var\(--mi-text-sub,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--mi-text-sub)'],
  [/var\(--mi-orange,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--mi-orange)'],
  [/var\(--mi-orange-hover,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--mi-orange-hover)'],
  [/var\(--mi-on-accent,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--mi-on-accent)'],
  [/var\(--mi-accent-text,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--mi-accent-text)']
];

const SKIP = /video-js|\.vjs-|gazette|masthead|preset-banner|banner-|palette-swatch|wallpaper-item|@keyframes|scrollbar|\.light-pv|\.dark-pv|\.pv-half|\.mock-|\.stage-canvas|\.thumb-img|\.player-|\.res-|\.q-badge|\.viewer-|\.tb-btn|\.close-viewer|\.media-viewer|\.audio-disc|\.heic-|\.video-overlay|\.res-tag|theme-constructivism/;

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) {
      if (e === 'node_modules' || e === 'dist') continue;
      walk(full);
    } else if (['.vue', '.css'].includes(extname(e))) files.push(full);
  }
})(SRC);

let total = 0;
let touched = 0;
const samples = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  let count = 0;

  const next = text.replace(/([^{}]+)\{([^{}]*)\}/g, (whole, selector, body) => {
    if (SKIP.test(selector)) return whole;
    let newBody = body;

    // 1) 剥离误导性兜底值
    for (const [re, tok] of FALLBACK_STRIP) {
      const before = newBody;
      newBody = newBody.replace(re, tok);
      if (newBody !== before) count++;
    }

    // 2) rgba 语义化
    newBody = newBody.replace(
      /((?:^|;)\s*(background|background-color|border|border-color|color)\s*:\s*)([^;}]+)/gi,
      (m, prefix, prop, value) => {
        let out = value;
        for (const [re, tok] of RGBA_RULES) out = out.replace(re, tok);
        if (out !== value) {
          count++;
          if (samples.length < 30) samples.push({ file: rel, selector: selector.trim().replace(/\s+/g, ' ').slice(0, 44), from: value.trim().slice(0, 42), to: out.trim().slice(0, 46) });
        }
        return prefix + out;
      }
    );

    return selector + '{' + newBody + '}';
  });

  if (next !== text) {
    touched++;
    total += count;
    if (WRITE) writeFileSync(file, next, 'utf8');
  }
}

console.log(WRITE ? '=== 已写入 ===' : '=== DRY RUN（加 --write 生效）===');
console.log(`文件 ${touched} 个，替换 ${total} 处\n`);
for (const s of samples) {
  console.log(`  ${s.file}  ${s.selector}`);
  console.log(`      ${s.from}  →  ${s.to}`);
}
