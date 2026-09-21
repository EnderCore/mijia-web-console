/**
 * 硬编码颜色 → 设计令牌 批量迁移脚本 (一次性工具，支持 dry-run)
 *
 * 用法:
 *   node scripts/codemod-tokens.mjs          # 预览将要发生的替换，不写文件
 *   node scripts/codemod-tokens.mjs --write  # 实际写入
 *
 * 设计要点：
 *  - 按「规则块」为单位判断，而不是无脑全局替换。
 *    例如 color:white 只有在同一块内确实设置了强调色底时，才改写成
 *    var(--mi-on-accent)；否则白光可能是压在深色遮罩/视频画面上的，
 *    保持原样并交由 contrast-guard 报告。
 *  - 第三方皮肤（video.js）、装饰性图形、主题预览色板一律跳过。
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WRITE = process.argv.includes('--write');
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'src');

// 背景色映射（中性表面）
const BG_RULES = [
  [/#ffffff\b|#fff\b/gi, 'var(--mi-card-bg)'],
  [/#f8fafc|#fcfdfe|#f9fafb/gi, 'var(--mi-card-sub-bg)'],
  [/#f1f5f9|#f5f6f8|#f0f2f5|#edf0f4|#f3f4f6|#e2e8f0|#eae[d-f]1|#e5e7eb/gi, 'var(--mi-control-sub-bg)'],
  [/#151d2f|#131b2e|#121215|#111827/gi, 'var(--mi-card-bg)'],
  [/#1e293b|#18181b|#1f293d/gi, 'var(--mi-card-sub-bg)'],
  [/#0f172a|#0b0f19|#09090b/gi, 'var(--mi-bg)'],
  [/rgba\(\s*255\s*,\s*103\s*,\s*0\s*,\s*0\.(08|1|12|15|2)\s*\)/gi, 'var(--mi-accent-soft)'],
  [/rgba\(\s*16\s*,\s*185\s*,\s*129\s*,\s*0\.(1|12|15)\s*\)/gi, 'var(--mi-status-green-soft)'],
  [/rgba\(\s*239\s*,\s*68\s*,\s*68\s*,\s*0\.(1|12|16)\s*\)/gi, 'var(--mi-status-red-soft)'],
  [/rgba\(\s*59\s*,\s*130\s*,\s*246\s*,\s*0\.(1|15)\s*\)/gi, 'var(--mi-status-blue-soft)'],
  [/rgba\(\s*14\s*,\s*165\s*,\s*233\s*,\s*0\.(1|15)\s*\)/gi, 'var(--mi-status-cyan-soft)'],
  [/rgba\(\s*245\s*,\s*158\s*,\s*11\s*,\s*0\.(1|15)\s*\)/gi, 'var(--mi-status-orange-soft)']
];

// 前景色映射
const FG_RULES = [
  [/#1f2329|#0f172a|#111827|#334155|#475569|#404040/gi, 'var(--mi-text-main)'],
  [/#8f959e|#94a3b8|#64748b|#6b7280|#9ca3af|#cbd5e1/gi, 'var(--mi-text-sub)'],
  [/#f1f5f9|#f8fafc|#f4f4f5|#e2e8f0/gi, 'var(--mi-text-main)'],
  [/#ff6700|#ff8533|#fa5800/gi, 'var(--mi-accent-text)'],
  [/#10b981|#059669|#34d399|#047857/gi, 'var(--mi-status-green)'],
  [/#dc2626|#ef4444|#b91c1c|#f87171|#fca5a5/gi, 'var(--mi-status-red)'],
  [/#3b82f6|#2563eb|#1d4ed8|#60a5fa/gi, 'var(--mi-status-blue)'],
  [/#0ea5e9|#0284c7|#0369a1|#38bdf8/gi, 'var(--mi-status-cyan)'],
  [/#f59e0b|#f97316|#b45309|#fbbf24/gi, 'var(--mi-status-orange)'],
  [/#8b5cf6|#7c3aed|#6d28d9|#a78bfa/gi, 'var(--mi-status-violet)']
];

// 该块是否设置了「实心强调色底」——决定白字能否安全改写
const ACCENT_SOLID_BG = /background(-color)?\s*:\s*(var\(--mi-orange[^)]*\)|#ff6700|#fa5800|#ff8533|linear-gradient\([^)]*#ff6700)/i;

// 跳过：第三方皮肤与装饰性图形
const SKIP_SELECTOR = /video-js|\.vjs-|gazette|preset-banner|banner-|palette-swatch|wallpaper-item|@keyframes|scrollbar|\.light-pv|\.dark-pv|\.pv-half|\.mock-|\.thumb-img/;

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

let changedFiles = 0;
let total = 0;
const preview = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).replace(/\\/g, '/');

  const next = text.replace(/([^{}]+)\{([^{}]*)\}/g, (whole, selector, body) => {
    if (SKIP_SELECTOR.test(selector) || SKIP_SELECTOR.test(body)) return whole;

    const hasAccentSolid = ACCENT_SOLID_BG.test(body);

    const newBody = body.replace(
      /((?:^|;)\s*(background|background-color|color|border-color|fill|stroke)\s*:\s*)([^;}]+)/gi,
      (m, prefix, prop, value) => {
        if (/var\(--mi-/.test(value)) return m;

        let out = value;
        const isBg = /background/.test(prop);

        if (isBg) {
          for (const [re, token] of BG_RULES) out = out.replace(re, token);
        } else {
          for (const [re, token] of FG_RULES) out = out.replace(re, token);
          // 白字仅在强调实心底上才改写，避免破坏深色遮罩/视频画面上层文字
          if (hasAccentSolid) {
            out = out.replace(/\bwhite\b|#ffffff/gi, 'var(--mi-on-accent)');
          }
        }

        if (out !== value) {
          total++;
          if (preview.length < 60) {
            preview.push({ file: rel, selector: selector.trim().replace(/\s+/g, ' ').slice(0, 46), from: `${prop}: ${value.trim()}`.slice(0, 50), to: `${prop}: ${out.trim()}`.slice(0, 50) });
          }
        }
        return prefix + out;
      }
    );
    return selector + '{' + newBody + '}';
  });

  if (next !== text) {
    changedFiles++;
    if (WRITE) writeFileSync(file, next, 'utf8');
  }
}

console.log(WRITE ? '=== 已写入 ===' : '=== DRY RUN（未写入，加 --write 生效）===');
console.log(`\n涉及文件 ${changedFiles} 个，替换 ${total} 处。\n`);
console.log('样例（最多 60 条）：');
for (const p of preview) {
  console.log(`  ${p.file}`);
  console.log(`      ${p.selector}`);
  console.log(`      ${p.from}`);
  console.log(`   →  ${p.to}`);
}
