/**
 * 设计令牌引擎 (Design Token Engine)
 *
 * 核心思想：把「颜色角色」和「具体色值」彻底分开。
 * 组件只声明自己是什么角色（表面 / 前景 / 强调 / 状态），
 * 具体色值由引擎依据当前主题与深浅模式推导，并且**每个前景都强制通过对比度校验**。
 *
 * 这样即使未来新增主题、或用户把强调色调成任意颜色，
 * 也不可能出现「浅底浅字」「深底深字」——因为引擎在生成阶段就会修正。
 *
 * 推导管线：
 *   1. 解析主题配置（底盘色、卡片色、不透明度、强调色）
 *   2. 合成出每个表面的**实际呈现色**（半透明叠加在底盘之上）
 *   3. 为每个表面推导前景（主/次/弱），逐个 ensureContrast
 *   4. 为强调底、状态底推导其上文字
 *   5. 输出扁平的 CSS 变量表
 */

import {
  parseColor,
  composite,
  contrastRatio,
  ensureContrast,
  isLight,
  readableVariant,
  relativeLuminance,
  shade,
  toHex,
  toRgba
} from './color.js';

// 最小对比度要求（WCAG AA）。4.5 是硬性下限。
export const MIN_RATIO_TEXT = 4.5;
export const MIN_RATIO_LARGE = 3.0;

// 实心强调底上的文字：按钮是纯色实底，4.5 已足够。
export const MIN_RATIO_ON_ACCENT = 4.5;

/**
 * 跨多个表面求一个通用的前景色。
 *
 * 为什么需要它：同一个 --mi-text-main 会同时出现在卡片、次级凹槽、
 * 控件底等多种表面上，这些表面亮度略有差异。若只针对卡片校准，
 * 换到更深的凹槽上就会掉到 4.5 以下。
 * 这里取「最不利表面」作为校准基准，保证令牌在所有已知表面上都达标。
 */
function ensureContrastAcross(fg, backgrounds, minRatio) {
  let best = fg;
  for (let step = 0; step <= 100; step++) {
    const candidate = step === 0 ? fg : null;
    if (candidate) {
      if (backgrounds.every((bg) => contrastRatio(candidate, bg) >= minRatio)) return candidate;
      best = candidate;
      continue;
    }
    const amount = isLight(backgrounds[0]) ? -(step / 100) : step / 100;
    const shaded = shade(fg, amount);
    if (backgrounds.every((bg) => contrastRatio(shaded, bg) >= minRatio)) return shaded;
    best = shaded;
  }
  return best;
}

// 主题色板：每个主题给出底盘/卡片/边框与深浅两套基础参数
const THEME_BASES = {
  default: {
    light: { base: '#f5f6f8', card: '#ffffff', cardSub: '#f8fafc', border: '#eaedf1' },
    dark: { base: '#0b0f19', card: '#151d2f', cardSub: '#1e293b', border: '#283548' }
  },
  mica: {
    light: { base: '#eef2f7', card: 'rgba(255,255,255,0.62)', cardSub: 'rgba(255,255,255,0.45)', border: 'rgba(255,255,255,0.65)' },
    dark: { base: '#0b0f19', card: 'rgba(21,29,47,0.72)', cardSub: 'rgba(30,41,59,0.6)', border: 'rgba(255,255,255,0.14)' }
  },
  aurora: {
    light: { base: '#eef2fb', card: 'rgba(255,255,255,0.72)', cardSub: 'rgba(255,255,255,0.55)', border: 'rgba(255,255,255,0.7)' },
    dark: { base: '#0b0f19', card: 'rgba(23,29,52,0.76)', cardSub: 'rgba(35,42,70,0.6)', border: 'rgba(167,139,250,0.24)' }
  },
  cyberpunk: {
    light: { base: '#e8eef6', card: 'rgba(255,255,255,0.8)', cardSub: 'rgba(255,255,255,0.6)', border: 'rgba(14,165,233,0.28)' },
    dark: { base: '#030712', card: 'rgba(15,23,42,0.86)', cardSub: 'rgba(24,34,54,0.7)', border: 'rgba(14,165,233,0.35)' }
  },
  constructivism: {
    light: { base: '#e8e4d9', card: '#f2efe9', cardSub: '#eae6dd', border: '#0a0a0a' },
    dark: { base: '#09090b', card: '#121215', cardSub: '#18181b', border: '#27272a' }
  }
};

// 状态语义角色
const STATUS_ROLES = {
  green: '#10b981',
  red: '#ef4444',
  orange: '#f59e0b',
  blue: '#3b82f6',
  cyan: '#0ea5e9',
  violet: '#8b5cf6'
};

// 安全兜底色：当主题未声明底盘/卡片时的回退
const FALLBACK = {
  light: { base: '#f5f6f8', card: '#ffffff', cardSub: '#f8fafc', border: '#eaedf1' },
  dark: { base: '#0b0f19', card: '#151d2f', cardSub: '#1e293b', border: '#283548' }
};

/**
 * 求一组「实心底色 + 其上文字」的达标配对。
 *
 * 难点：某些中明度颜色（如 #8b5cf6、#ef4444）无论配白字还是墨字都到不了 4.5:1。
 * 这时不能只换文字色，而要同时把底色朝远离文字的方向推一点，
 * 直到配对达标为止 —— 保证「底色与文字永远成套」，不会各自为政。
 */
function ensureSolidPair(baseColor, minRatio = MIN_RATIO_ON_ACCENT) {
  const white = [255, 255, 255, 1];
  const ink = [31, 35, 41, 1];
  const pickFg = (bg) =>
    contrastRatio(white, bg) >= contrastRatio(ink, bg) ? white : ink;

  let bg = baseColor;
  let fg = pickFg(bg);
  if (contrastRatio(fg, bg) >= minRatio) return { bg, fg };

  const towardDark = fg === white;
  let best = { bg, fg, ratio: contrastRatio(fg, bg) };
  for (let step = 1; step <= 60; step++) {
    const amount = towardDark ? -(step / 100) : step / 100;
    const candidateBg = shade(baseColor, amount);
    const candidateFg = pickFg(candidateBg);
    const ratio = contrastRatio(candidateFg, candidateBg);
    if (ratio > best.ratio) best = { bg: candidateBg, fg: candidateFg, ratio };
    if (ratio >= minRatio + 0.15) return { bg: candidateBg, fg: candidateFg };
  }
  return { bg: best.bg, fg: best.fg };
}

/**
 * 计算某个表面叠加在底盘上的实际呈现色。
 * 表面可能是半透明（如云母卡片），必须真正合成后才能判定该配深字还是浅字。
 */
function resolveSurface(surfaceColor, opacityPercent, baseRgb) {
  const parsed = parseColor(surfaceColor) || { 0: 255, 1: 255, 2: 255, 3: 1 };
  const alpha = (parsed[3] ?? 1) * (opacityPercent / 100);
  return composite([parsed[0], parsed[1], parsed[2], alpha], baseRgb);
}

/**
 * 由主题配置推导完整令牌表。
 * @param {object} theme  当前主题配置（含 id / accentColor / colorMode / 各不透明度）
 * @param {boolean} isDark 是否暗色模式
 * @returns {object} CSS 变量名 → 值 的扁平映射
 */
export function buildTokens(theme, isDark) {
  const mode = isDark ? 'dark' : 'light';
  const baseSet = THEME_BASES[theme.id]?.[mode] || FALLBACK[mode];

  const baseRgb = parseColor(baseSet.base) || parseColor(FALLBACK[mode].base);

  // 卡片不透明度：直接采用用户设置的数值。
  //
  // 这里曾经把卡片写死成 92% 不透明（toRgba(cardRgb, 0.92)），
  // 等于把「卡片面板透明度」滑块彻底架空：无论调到多透，卡片恒为 92%，
  // 壁纸只能以约 8% 的强度透出来，表现就是「设置了壁纸却看不到」。
  // 重构前的旧代码对云母用的是 45%，壁纸清晰可见。
  //
  // 约定：--mi-card-bg 是「卡片自身颜色 + 自身不透明度」。
  // 颜色必须按深浅模式取（浅色白、深色石板），不能直接用预设的 cardBg ——
  // 那是单一值、不分模式，深色下会把卡片写成白色。
  const cardAlpha = Math.min(1, Math.max(0, (theme.cardOpacity ?? 100) / 100));

  const cardOwn = parseColor(baseSet.card) || { 0: 255, 1: 255, 2: 255, 3: 1 };
  const cardOwnRgb = [cardOwn[0], cardOwn[1], cardOwn[2], cardAlpha];

  const cardSubOwn = parseColor(baseSet.cardSub) || cardOwn;
  const cardSubOwnRgb = [cardSubOwn[0], cardSubOwn[1], cardSubOwn[2], cardAlpha];

  // 合成色（叠在底盘上）——仅供对比度推导使用，不写进 CSS
  const cardRgb = composite(cardOwnRgb, baseRgb);
  const cardSubRgb = composite(cardSubOwnRgb, cardRgb);

  // 控件玻璃层：以「控件不透明度」再叠一层，得到按钮实际底色
  const controlOpacity = theme.controlOpacity ?? 100;
  const controlRgb = resolveSurface(
    isLight(cardRgb) ? 'rgba(255,255,255,1)' : 'rgba(30,41,59,1)',
    controlOpacity,
    cardRgb
  );

  // ---- 底盘与表面 ----
  // 注意 --mi-control-sub-bg 是**不透明**的成品色（用于实色凹槽）。
  // 而磨砂玻璃层需要携带透明度才能真正"透出"底层，因此单独给一个
  // glass 令牌；两者混用会导致暗色模式下玻璃层不透明、
  // 文字配错色（曾出现深色玻璃底配浅字/浅底配浅字）。
  const glassAlpha = isDark ? 0.72 : 0.72;
  const controlGlassRgb = isLight(cardRgb) ? [255, 255, 255] : [30, 41, 59];
  const glassBorder = isLight(cardRgb)
    ? 'rgba(255, 255, 255, 0.7)'
    : 'rgba(255, 255, 255, 0.15)';

  const tokenMap = {
    '--mi-bg': toHex(baseRgb),
    // 卡片底必须保留透明度，壁纸才能透出来（见上方 cardAlpha 说明）
    '--mi-card-bg': toRgba(cardOwnRgb, +cardAlpha.toFixed(3)),
    '--mi-card-sub-bg': toRgba(cardSubOwnRgb, +cardAlpha.toFixed(3)),
    '--mi-control-bg': toHex(controlRgb),
    '--mi-control-sub-bg': toRgba(composite([controlRgb[0], controlRgb[1], controlRgb[2], 0.75], cardRgb), 1),
    '--mi-control-bg-glass': toRgba(controlGlassRgb, glassAlpha),
    '--mi-control-border-glass': glassBorder,
    '--mi-border': baseSet.border,
    '--mi-card-border': baseSet.border
  };

  // ---- 前景 ----
  // 关键改进：主/次文字令牌会被用在本主题的多种表面上（卡片、次级凹槽、
  // 控件底），这些表面亮度不同。因此针对「所有已知表面」统一校准，
  // 取最不利的那个作准，避免换个容器就掉到 4.5 以下。
  const allSurfaces = [baseRgb, cardRgb, cardSubRgb, controlRgb];
  const lightest = allSurfaces.reduce((a, b) => (relativeLuminance(a) >= relativeLuminance(b) ? a : b));
  const darkerSide = relativeLuminance(cardRgb) > 0.5;

  const mainFg = ensureContrastAcross(
    darkerSide ? [31, 35, 41, 1] : [241, 245, 249, 1],
    allSurfaces,
    MIN_RATIO_TEXT
  );
  const subFg = ensureContrastAcross(
    darkerSide ? [71, 85, 105, 1] : [163, 177, 198, 1],
    allSurfaces,
    MIN_RATIO_TEXT
  );

  // 控件玻璃层叠加在卡片上的真实呈现色：这才是控件里文字实际的底色
  const glassOverCard = composite(
    [controlGlassRgb[0], controlGlassRgb[1], controlGlassRgb[2], glassAlpha],
    cardRgb
  );

  tokenMap['--mi-text-main'] = toHex(mainFg);
  tokenMap['--mi-text-sub'] = toHex(subFg);
  // 控件文字以「玻璃层实际呈现色」为校准基准，保证磨砂按钮上的字一定达标
  tokenMap['--mi-control-text'] = toHex(ensureContrast(mainFg, glassOverCard, MIN_RATIO_TEXT));
  tokenMap['--mi-control-text-sub'] = toHex(ensureContrast(subFg, glassOverCard, MIN_RATIO_TEXT));

  // ---- 强调色 ----
  const accent = parseColor(theme.accentColor) || parseColor('#ff6700');
  const accentHex = toHex(accent);

  tokenMap['--mi-orange-hover'] = toHex(readableVariant(accent, baseRgb, MIN_RATIO_LARGE));

  // 实心强调底 + 其上文字，由统一的配对求解器保证两者成套达标
  // （中明度强调色如 #8b5cf6 会连带微调底色，而不是只换字色）
  const accentPair = ensureSolidPair(accent);
  tokenMap['--mi-orange'] = toHex(accentPair.bg);
  tokenMap['--mi-on-accent'] = toHex(accentPair.fg);

  // 强调色作为「文字」使用：按最不利表面校准（它常用于统计数字、
  // 高亮数值、盘位标号，可能出现在卡片或更深的凹槽上）
  tokenMap['--mi-accent-text'] = toHex(
    ensureContrastAcross(accent, allSurfaces, MIN_RATIO_TEXT)
  );
  const accentSoftRgb = composite([accent[0], accent[1], accent[2], 0.12], cardRgb);
  tokenMap['--mi-accent-soft'] = toRgba(accent, 0.12);
  tokenMap['--mi-accent-text-on-soft'] = toHex(ensureContrast(accent, accentSoftRgb, MIN_RATIO_TEXT));

  // ---- 状态色 ----
  // 状态文字（.text-warn / .text-blue / 高亮数值）常出现在次级信息行里，
  // 那些行本身是带透明度的磨砂表面，文字实际落在「玻璃层叠在卡片上」的结果色上。
  // 因此必须用与 CSS 完全一致的不透明度来复现这个合成色，否则校准与实况会差一点点。
  const glassSurface = composite(
    [controlRgb[0], controlRgb[1], controlRgb[2], 0.75],
    cardRgb
  );
  // 次级信息行：--mi-card-sub-bg 以 0.9 叠在卡片上
  const infoRowSurface = composite(
    [cardSubRgb[0], cardSubRgb[1], cardSubRgb[2], 0.9],
    cardRgb
  );
  const statusSurfaces = [
    baseRgb,
    cardRgb,
    cardSubRgb,
    controlRgb,
    glassSurface,
    infoRowSurface
  ];
  for (const [role, hex] of Object.entries(STATUS_ROLES)) {
    const c = parseColor(hex);
    tokenMap[`--mi-status-${role}`] = toHex(
      ensureContrastAcross(c, statusSurfaces, MIN_RATIO_TEXT)
    );
    tokenMap[`--mi-status-${role}-soft`] = toRgba(c, isDark ? 0.18 : 0.12);
  }

  // ---- 构成主义专属「墨色」与「革命红」----
  // 该主题用粗黑描边与几何色块做视觉语言：
  //  · 墨色在暗色底上不可见，必须随模式翻转（不能固定 #0a0a0a）。
  //  · 革命红在暗色下需提亮；一旦底色变了，其上文字必须重新配套，
  //    否则会沿用为另一个红算出的字色，出现「亮红底白字仅 3.7:1」的问题。
  const constructInk = isDark ? [244, 244, 245, 1] : [10, 10, 10, 1];
  // 用统一的配对求解，红底与字色永远成套（亮红 #ef4444 白字只有 3.7:1，
  // 求解器会把底色压深到白字达标，而不是沿用别的红算出来的字色）
  const constructRedPair = ensureSolidPair(parseColor(isDark ? '#ef4444' : '#d92027'));
  const constructRed = constructRedPair.bg;

  tokenMap['--mi-construct-ink'] = toHex(constructInk);
  tokenMap['--mi-construct-ink-soft'] = toRgba(constructInk, 0.16);
  tokenMap['--mi-construct-red'] = toHex(constructRed);
  tokenMap['--mi-on-construct-red'] = toHex(constructRedPair.fg);

  // ---- 视频播放器令牌 ----
  // 播放器外壳（标题栏 / 底部信息栏）是普通容器，完全可以跟随主题，
  // 这里给出成套的底/字令牌 —— 早期它们写死成 #090e1a，
  // 浅色主题下 --mi-text-main(#1f2329) 落在 #090e1a 上只有 1.22:1，
  // 标题几乎不可见。
  tokenMap['--mi-player-shell-bg'] = toHex(cardRgb);
  tokenMap['--mi-player-shell-text'] = toHex(ensureContrast(mainFg, cardRgb, MIN_RATIO_TEXT));
  tokenMap['--mi-player-shell-text-sub'] = toHex(ensureContrast(subFg, cardRgb, MIN_RATIO_TEXT));

  // 控制条悬浮在视频画面之上，画面内容不可预知，
  // 因此压暗的遮罩层在浅深两种模式下都必须保持深色（这是正确做法，不是偷懒）。
  // 但遮罩**之上的文字与进度条**仍要跟随主题：强调色换成主题色后，
  // 这里必须重新校验它与遮罩的对比度，否则浅色强调色（如亮黄）会糊成一片。
  const scrim = [10, 14, 24, 0.88];
  const scrimSurface = composite(scrim, baseRgb);
  const scrimWhite = [255, 255, 255, 1];
  const scrimInk = [15, 20, 30, 1];
  const scrimFg =
    contrastRatio(scrimWhite, scrimSurface) >= contrastRatio(scrimInk, scrimSurface)
      ? scrimWhite
      : scrimInk;
  tokenMap['--mi-player-scrim'] = toRgba([10, 14, 24], 0.88);
  tokenMap['--mi-player-scrim-text'] = toHex(scrimFg);
  tokenMap['--mi-player-scrim-text-dim'] = toHex(
    composite([scrimFg[0], scrimFg[1], scrimFg[2], 0.75], scrimSurface)
  );
  // 进度条/音量条填充色：跟随主题强调色，并在遮罩上校验
  tokenMap['--mi-player-accent'] = toHex(ensureContrast(accent, scrimSurface, MIN_RATIO_LARGE));

  // ---- 危险实心按钮（清空缓存 / 删除等）----
  // 与强调色同理：底与字必须成套求解。直接拿「状态红」当底、
  // 再随便配一个前景色，很容易落到 4.5:1 以下（中明度红配白字只有约 3.7:1）。
  const dangerPair = ensureSolidPair(parseColor(STATUS_ROLES.red));
  tokenMap['--mi-danger-solid'] = toHex(dangerPair.bg);
  tokenMap['--mi-on-danger-solid'] = toHex(dangerPair.fg);

  // ---- 自检元数据（供构建期/运行时守卫使用）----
  tokenMap['--mi-token-mode'] = mode;
  tokenMap['--mi-token-base'] = toHex(baseRgb);
  tokenMap['--mi-token-card'] = toHex(cardRgb);
  tokenMap['--mi-token-control'] = toHex(controlRgb);
  // 播放器控制条令牌的校验基准：压暗遮罩的实际呈现色
  tokenMap['--mi-token-scrim'] = toHex(
    composite([10, 14, 24, 0.88], baseRgb)
  );

  return tokenMap;
}

/**
 * 校验一组令牌是否全部满足对比度要求。
 * 用于自动化测试与运行时自检，把「视觉问题」变成「可断言的失败」。
 */
export function auditTokens(theme, isDark) {
  const tokens = buildTokens(theme, isDark);
  const p = (v) => parseColor(v);

  // 每项可带自己的最低要求：文字 4.5，图形控件（进度条填充等）3.0。
  // 早期这里对一切都用 4.5，导致「进度条填充」这种非文字元素
  // 要么被误判为失败，要么为了凑 4.5 被改成一个偏得离谱的颜色。
  const pairs = [
    ['主文字 / 卡片', tokens['--mi-text-main'], tokens['--mi-token-card'], MIN_RATIO_TEXT],
    ['次级文字 / 卡片', tokens['--mi-text-sub'], tokens['--mi-token-card'], MIN_RATIO_TEXT],
    ['控件文字 / 控件底', tokens['--mi-control-text'], tokens['--mi-token-control'], MIN_RATIO_TEXT],
    ['控件次文字 / 控件底', tokens['--mi-control-text-sub'], tokens['--mi-token-control'], MIN_RATIO_TEXT],
    ['强调文字 / 卡片', tokens['--mi-accent-text'], tokens['--mi-token-card'], MIN_RATIO_TEXT],
    ['强调底上的文字', tokens['--mi-on-accent'], tokens['--mi-orange'], MIN_RATIO_TEXT],
    ['危险按钮文字 / 危险底', tokens['--mi-on-danger-solid'], tokens['--mi-danger-solid'], MIN_RATIO_TEXT],
    ['主文字 / 底盘', tokens['--mi-text-main'], tokens['--mi-token-base'], MIN_RATIO_TEXT],
    // 播放器外壳与视频控制条 —— 这两组过去完全没被守卫覆盖，
    // 也正是「浅色主题下标题看不见、控制条颜色不跟主题」的漏网之处。
    ['播放器标题 / 外壳', tokens['--mi-player-shell-text'], tokens['--mi-token-card'], MIN_RATIO_TEXT],
    ['播放器底部文字 / 外壳', tokens['--mi-player-shell-text-sub'], tokens['--mi-token-card'], MIN_RATIO_TEXT],
    ['控制条文字 / 遮罩', tokens['--mi-player-scrim-text'], tokens['--mi-token-scrim'], MIN_RATIO_TEXT],
    // 进度条/音量条填充属于 WCAG 1.4.11 的「非文字图形控件」，要求 3:1
    ['进度条填充 / 遮罩', tokens['--mi-player-accent'], tokens['--mi-token-scrim'], MIN_RATIO_LARGE]
  ];

  for (const role of Object.keys(STATUS_ROLES)) {
    pairs.push([
      `状态色 ${role} / 卡片`,
      tokens[`--mi-status-${role}`],
      tokens['--mi-token-card'],
      MIN_RATIO_TEXT
    ]);
  }

  return pairs.map(([label, fg, bg, minRatio = MIN_RATIO_TEXT]) => {
    const f = p(fg);
    const b = p(bg);
    const ratio = f && b ? contrastRatio(f, b) : 0;
    return {
      label,
      fg,
      bg,
      minRatio,
      ratio: Math.round(ratio * 100) / 100,
      pass: ratio >= minRatio
    };
  });
}

export { STATUS_ROLES };
