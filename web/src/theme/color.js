/**
 * 颜色基础运算库 (纯函数，无副作用、无依赖)
 *
 * 设计令牌体系的底层：所有颜色推导、对比度校验都基于这里的函数，
 * 保证「同一个输入永远得到同一个输出」，便于构建期静态校验与单元测试。
 */

// 解析 #rgb / #rrggbb / rgb() / rgba() → [r, g, b, a]
export function parseColor(input) {
  if (!input || typeof input !== 'string') return null;
  const str = input.trim();

  if (str.startsWith('#')) {
    let hex = str.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b, a];
  }

  const m = str.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => !Number.isNaN(n))) {
      const a = parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1;
      return [parts[0], parts[1], parts[2], a];
    }
  }
  return null;
}

export function toHex(color) {
  return (
    '#' +
    color
      .slice(0, 3)
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  );
}

export function toRgba(color, alpha) {
  return `rgba(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}, ${alpha})`;
}

// 半透明前景叠加到不透明底色上，得到实际呈现颜色
export function composite(fg, bg) {
  const a = fg[3] ?? 1;
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
    1
  ];
}

// WCAG 相对亮度
export function relativeLuminance(color) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
}

// WCAG 对比度
export function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// 判断底色亮暗（用于选择深字还是浅字）
export function isLight(color, threshold = 0.5) {
  return relativeLuminance(color) > threshold;
}

// 朝黑/白方向按比例混合；amount 为负变暗，为正变亮
export function shade(color, amount) {
  const target = amount < 0 ? [0, 0, 0] : [255, 255, 255];
  const t = Math.abs(amount);
  return [
    color[0] + (target[0] - color[0]) * t,
    color[1] + (target[1] - color[1]) * t,
    color[2] + (target[2] - color[2]) * t,
    1
  ];
}

// 在指定底色上寻找同色系且对比度达标的前景色
export function readableVariant(color, bg, minRatio = 4.5) {
  return ensureContrast(color, bg, minRatio);
}

// 在两个候选前景色（白/墨）中挑对比度更高的那个
const INK = [31, 35, 41, 1];
const WHITE = [255, 255, 255, 1];

export function bestForeground(bg) {
  return contrastRatio(WHITE, bg) >= contrastRatio(INK, bg) ? WHITE : INK;
}

/**
 * 关键守卫：把一个「前景/背景」配对修正到对比度达标。
 *
 * 两个细节保证结果稳健：
 *  1. 内部目标值高于要求（默认 +0.15），因为最终色值要序列化成 6 位十六进制，
 *     取整会带来微小偏差；留出余量才不会卡在 4.49 这种边界上。
 *  2. 全程搜索并保留最佳候选，而不是「第一个达标就停」，
 *     这样即便单调变暗无法一步达标，也能拿到当前最优解。
 */
export function ensureContrast(fg, bg, minRatio = 4.5) {
  const target = minRatio + 0.15;
  const bgIsLight = isLight(bg);

  if (contrastRatio(fg, bg) >= target) return fg;

  let best = fg;
  let bestRatio = contrastRatio(fg, bg);

  for (let step = 1; step <= 100; step++) {
    const amount = bgIsLight ? -(step / 100) : step / 100;
    const candidate = shade(fg, amount);
    const ratio = contrastRatio(candidate, bg);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
    if (ratio >= target) break;
  }

  // 同色系调不出足够对比度时，退化为纯黑/纯白，保证可读性优先
  if (bestRatio < target) {
    const fallback = bestForeground(bg);
    if (contrastRatio(fallback, bg) > bestRatio) return fallback;
  }
  return best;
}
