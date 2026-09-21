/**
 * 第二轮令牌迁移：语义状态软底与强调色渐变。
 *
 * 第一轮处理了中性表面色；这一轮处理：
 *  - 状态标签的浅色实心淡底 (#ecfdf5 / #fef2f2 / #fffbeb ...)
 *    在暗色模式下会变成刺眼的亮块，必须跟随语义变量。
 *  - 同色系淡描边。
 *  - 进度条渐变中写死的强调色。
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WRITE = process.argv.includes('--write');
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'src');

const SOFT_BG = [
  [/#ecfdf5|#d1fae5|#f0fdf4/gi, 'var(--mi-status-green-soft)'],
  [/#fef2f2|#fee2e2|#fff1f2/gi, 'var(--mi-status-red-soft)'],
  [/#fffbeb|#fef3c7/gi, 'var(--mi-status-orange-soft)'],
  [/#fff7ed/gi, 'var(--mi-accent-soft)'],
  [/#eff6ff|#dbeafe/gi, 'var(--mi-status-blue-soft)'],
  [/#f0f9ff|#e0f2fe/gi, 'var(--mi-status-cyan-soft)'],
  [/#f5f3ff|#ede9fe/gi, 'var(--mi-status-violet-soft)']
];

const SOFT_BORDER = [
  [/#a7f3d0|#6ee7b7/gi, 'var(--mi-status-green-soft)'],
  [/#fecaca|#fca5a5/gi, 'var(--mi-status-red-soft)'],
  [/#fde68a|#fdba74/gi, 'var(--mi-status-orange-soft)'],
  [/#bfdbfe|#93c5fd/gi, 'var(--mi-status-blue-soft)'],
  [/#bae6fd|#7dd3fc/gi, 'var(--mi-status-cyan-soft)'],
  [/#ddd6fe|#c4b5fd/gi, 'var(--mi-status-violet-soft)']
];

// 进度条 / 高亮条渐变里写死的强调色（只替换渐变色标，不动 --mi-orange 定义处）
const ACCENT_IN_GRADIENT = [/#ff6700|#ff8533|#ffa04d|#fa5800/gi, 'var(--mi-orange)'];

// 状态文字补充
const STATUS_TEXT = [
  [/#d97706/gi, 'var(--mi-status-orange)'],
  [/#dcfce7|#bbf7d0/gi, 'var(--mi-status-green-soft)']
];

const SKIP_SELECTOR = /video-js|\.vjs-|gazette|masthead|preset-banner|banner-|palette-swatch|wallpaper-item|@keyframes|scrollbar|\.light-pv|\.dark-pv|\.pv-half|\.mock-|\.thumb-img|theme-constructivism/;

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) {
      if (e === 'node_modules' || e === 'dist') continue;
      walk(full);
    } else if (['.vue', '.css'].includes(extname(e))) {
      files.push(full);
    }
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
    if (SKIP_SELECTOR.test(selector)) return whole;

    const newBody = body.replace(
      /((?:^|;)\s*(background|background-color|border|border-color|color)\s*:\s*)([^;}]+)/gi,
      (m, prefix, prop, value) => {
        if (/var\(--mi-/.test(value)) return m;

        let out = value;
        if (/^border/.test(prop)) {
          for (const [re, tok] of SOFT_BORDER) out = out.replace(re, tok);
        } else if (/background/.test(prop)) {
          for (const [re, tok] of SOFT_BG) out = out.replace(re, tok);
          if (/gradient/.test(out)) {
            out = out.replace(ACCENT_IN_GRADIENT[0], ACCENT_IN_GRADIENT[1]);
          }
        } else {
          for (const [re, tok] of STATUS_TEXT) out = out.replace(re, tok);
        }

        if (out !== value) {
          count++;
          if (samples.length < 25) {
            samples.push({ file: rel, selector: selector.trim().replace(/\s+/g, ' ').slice(0, 46), from: value.trim().slice(0, 44), to: out.trim().slice(0, 46) });
          }
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
