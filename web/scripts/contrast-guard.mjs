/**
 * 对比度守卫 (Contrast Guard)
 *
 * 目的：把「浅底浅字 / 深底深字」这类视觉缺陷，从"靠人眼看出来"
 * 变成"构建时自动失败"。这样以后任何人（或任何 Agent）往组件里
 * 写死颜色，都会在 CI / 本地构建阶段被拦下。
 *
 * 两类检查：
 *   1. 令牌自检：遍历「全部主题 × 深浅模式」，校验引擎产出的每个
 *      前景/背景配对是否满足 WCAG AA。
 *   2. 源码巡检：静态扫描 .vue/.css，找出绕过令牌、直接写死颜色的
 *      声明（白名单内允许，例如视频播放器皮肤）。
 *
 * 用法：node scripts/contrast-guard.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

const { buildTokens, auditTokens, MIN_RATIO_TEXT } = await import(
  new URL('../src/theme/tokens.js', import.meta.url).href
);

// ---------------------------------------------------------------------------
// 1. 令牌自检
// ---------------------------------------------------------------------------

const THEMES = [
  { id: 'default', name: '经典默认', accentColor: '#ff6700', cardOpacity: 100, controlOpacity: 100 },
  { id: 'mica', name: '云母磨砂', accentColor: '#0ea5e9', cardOpacity: 55, controlOpacity: 70 },
  { id: 'aurora', name: '梦幻极光', accentColor: '#8b5cf6', cardOpacity: 70, controlOpacity: 80 },
  { id: 'cyberpunk', name: '赛博暗霓', accentColor: '#f43f5e', cardOpacity: 85, controlOpacity: 90 },
  { id: 'constructivism', name: '构成主义', accentColor: '#d92027', cardOpacity: 100, controlOpacity: 100 },
  // 对抗性用例：用户可以自由取色，这些最容易出问题
  { id: 'mica', name: '云母 + 亮黄强调', accentColor: '#fde047', cardOpacity: 55, controlOpacity: 70 },
  { id: 'default', name: '默认 + 近白强调', accentColor: '#f8fafc', cardOpacity: 100, controlOpacity: 100 },
  { id: 'default', name: '默认 + 近黑强调', accentColor: '#0a0a0a', cardOpacity: 100, controlOpacity: 100 },
  { id: 'mica', name: '云母 + 中明度紫', accentColor: '#8b5cf6', cardOpacity: 40, controlOpacity: 55 },
  { id: 'aurora', name: '极光 + 高透卡片', accentColor: '#10b981', cardOpacity: 20, controlOpacity: 30 }
];

let tokenChecks = 0;
let tokenFailures = [];

for (const theme of THEMES) {
  for (const isDark of [false, true]) {
    const results = auditTokens(theme, isDark);
    tokenChecks += results.length;
    for (const r of results) {
      if (!r.pass) {
        tokenFailures.push({ theme: `${theme.name} / ${isDark ? '暗色' : '浅色'}`, ...r });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. 源码巡检：找出绕过设计令牌的硬编码颜色
// ---------------------------------------------------------------------------

// 允许写死颜色的场景（插件皮肤、第三方 UI、装饰性图形、刻意的深色舞台）
const ALLOWED_PATTERNS = [
  /\.video-js/,           // video.js 官方皮肤
  /\.vjs-/,               // video.js 内部类
  /\.vjs-big-play/,
  /@keyframes/,
  /::(-webkit-)?(scrollbar|slider)/,
  /\.gazette-/,           // 构成主义报头装饰
  /\.preset-banner/,      // 主题预览色板（本就用于展示各主题固有色）
  /\.banner-/,
  /\.palette-swatch/,     // 色板样本
  /\.wallpaper-item/,     // 壁纸缩略图
  /fill="#/,
  /stroke="#/,
  // 主题外观面板里的「主题缩略预览」——它天生要展示各主题固有色，
  // 与当前主题无关，写死是正确的。
  /\.mock-/,
  /\.stage-canvas/,
  /\.preview-mini-stage/,
  /\.pv-half/,
  /\.light-pv/,
  /\.dark-pv/,
  /\.mode-card-preview/,
  /\.banner-/,
  // 视频播放器/灯箱自身的暗色外壳：全屏观影场景固定深色才正确
  /\.player-/,
  /\.res-menu/,
  /\.res-btn/,
  /\.q-badge/,
  /\.transcode-toast/,
  /\.viewer-/,
  /\.tb-btn/,
  /\.close-viewer/,
  /\.media-viewer/,
  /\.audio-disc/,
  /\.heic-/,
  // 图片/视频缩略图上的黑底角标与白字：为了在任意缩略图上可读，
  // 必须用固定的半透明黑底 + 白字，跟随主题反而会失去可读性。
  /\.video-play-tag/,
  /\.video-overlay/,
  /\.res-tag/,
  /\.preset-tag-pill/,
  /\.wallpaper-name/,
  /\.preset-tag/,
  // 刻意固定的深色舞台：
  //  · body-frame-box   —— 内嵌 PDF 阅读器的灰色垫底（PDF 页面为白色）
  //  · modal-body(#000) —— 影视墙 iframe 的黑底（与外站内容衔接）
  //  · close-btn:hover  —— 视频播放器上的悬停高亮
  /body-frame-box/,
  /\.modal-body/,
  /close-btn/
];

const COLOR_DECL = /(?:^|[;{]\s*)(color|background|background-color|border-color|border)\s*:\s*([^;}]+)/gi;
const LITERAL_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:white|black)\b|rgba?\(/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full, out);
    } else if (['.vue', '.css'].includes(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 源码巡检：区分「可接受」与「真实风险」
//
// 硬编码颜色并不都等于 bug。要分开看：
//   · 可接受：深色遮罩/灯箱底（rgba(0,0,0,*)）、视频播放器皮肤、
//     装饰性图形、主题预览色板——它们本来就该固定。
//   · 真实风险：中性表面色或文字色被写死，会随主题/深浅切换而失配。
// 只把后者计为失败，前者计入「已豁免」，避免守卫变成噪音而被人忽略。
// ---------------------------------------------------------------------------

// 深色遮罩 / 灯箱 / 纯黑舞台：浅深模式下都保持深色，固定值是正确做法
const ACCEPTABLE_DARK_OVERLAY = /^rgba?\(\s*(0|10|15|30|31|15, 23, 42|10, 15, 29)\s*,?/i;
const DARK_BACKDROP_HINT = /backdrop|overlay|viewer|player|lightbox|stage-canvas\.dark|video-overlay|res-tag|modal-body|body-frame-box|body-text-box|doc-backdrop/i;

const RULE_RE = /([^{}]+)\{([^{}]*)\}/g;
const sourceFindings = [];
const acceptableFindings = [];

for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).replace(/\\/g, '/');

  for (const m of text.matchAll(RULE_RE)) {
    const selector = m[1].trim();
    const body = m[2];
    const selNorm = selector.replace(/\s+/g, ' ');

    if (ALLOWED_PATTERNS.some((re) => re.test(selector) || re.test(body))) continue;

    for (const decl of body.matchAll(COLOR_DECL)) {
      const prop = decl[1];
      const value = decl[2].trim();

      if (value.startsWith('var(--mi-')) continue;
      // 值里只要已经引用了令牌（可能带兜底值），就算合规：
      // 令牌是运行时注入的，兜底值永远只在异常情况下生效。
      if (/var\(--mi-/.test(value)) continue;
      if (value === 'transparent' || value === 'inherit' || value === 'currentColor') continue;
      if (!LITERAL_COLOR.test(value)) continue;

      const lineNo = text.slice(0, m.index + (decl.index ?? 0)).split('\n').length;
      const entry = {
        file: rel,
        line: lineNo,
        selector: selNorm.slice(0, 52),
        decl: `${prop}: ${value}`.slice(0, 58)
      };

      // 判定是否可接受
      const isBackdrop = DARK_BACKDROP_HINT.test(selNorm);
      const isDarkValue = ACCEPTABLE_DARK_OVERLAY.test(value);
      const isDecorative = /::(before|after|backdrop)/.test(selNorm) ||
        /gazette|masthead|stamp|slogan|power-tag|decorat/i.test(selNorm);
      const isShadowOrGradientStop = /shadow$/i.test(prop);

      if ((isBackdrop && isDarkValue) || isDecorative || isShadowOrGradientStop) {
        acceptableFindings.push(entry);
      } else {
        sourceFindings.push(entry);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. 非颜色约束检查
//
// 颜色之外的坑同样会造成「功能完全不可用」，而且更难从界面上看出原因。
// 目前守五类已经真实踩过的坑：
//   a) background-image 里写末尾纯色值 —— 整条声明会被浏览器丢弃
//   b) 视频流 MIME 与容器不匹配 —— video.js 起播失败且控制条永不显示
//   c) 卡片底色丢掉透明度 —— 用户设置的壁纸被半透明卡片盖住，看起来「没生效」
//   d) 壁纸未经压缩直接入库 —— 超过 CSS 变量长度上限后被静默丢弃，完全不显示
//   e) 卡片容器忘记声明 .mi-surface —— 磨砂与卡片样式静默失效，只有部分卡片生效
// ---------------------------------------------------------------------------

const nonColorIssues = [];

// e) 卡片容器的声明式协议。
//
// 历史上磨砂是靠一份硬编码类名清单施加的，而清单必然会与实际类名脱节
// （chart-card vs monitor-card、recent-card vs recent-media-card），
// 结果是「全局卡片磨砂只有一个卡片生效，其余仍是半透明」且无人察觉。
// 现在约定：凡是用 --mi-card-bg 当背景的容器，必须同时声明 .mi-surface。
const STYLE_CSS = join(SRC, 'assets', 'style.css');
{
  const css = readFileSync(STYLE_CSS, 'utf8');

  // 清单式写法一旦复活，说明有人又在往 CSS 里堆一长串类名
  const listStyle = css.match(
    /html\.theme-mica-(?:controls-only|all-containers)\s+((?:\.[\w-]+,\s*){3,})/
  );
  if (listStyle) {
    const lineNo = css.slice(0, listStyle.index).split('\n').length;
    nonColorIssues.push({
      file: 'src/assets/style.css',
      line: lineNo,
      what: '云母磨砂又用了硬编码类名清单（多个类名并列），组件改名或新增卡片时会静默失效',
      fix: '统一用 .mi-surface 声明式类，由组件自己标注'
    });
  }

  // 组件里给卡片容器加样式时，必须挂上 .mi-surface
  const vueFiles = [];
  (function walkVue(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        walkVue(full);
      } else if (entry.endsWith('.vue')) vueFiles.push(full);
    }
  })(SRC);

  // 这些容器按设计不使用 .mi-surface：
  //   · 弹窗/面板内部的子块（由外层统一承载磨砂）
  //   · 控件类（按钮、标签、输入框）—— 它们由「控件磨砂」规则负责，
  //     走的是 --mi-control-bg-glass，与卡片是两个不同层级
  //   · 视频播放器外壳 —— 有自己的主题令牌（--mi-player-shell-*），
  //     全屏观影场景需要独立配色，不参与卡片磨砂
  const EXEMPT = /cache-item|theme-tab-btn|section-card|preset-item-card|small-action-btn|pill-btn|btn-ghost|res-menu|ca-btn|crumb-dropdown-menu|miller-column|mount-box|doc-body|pdf-frame|body-audio-box|body-unknown-box|task-refresh|gazette|theme-nav-btn|cache-nav-btn|mask-btn|refresh-btn|tab-btn|player-container/;

  for (const file of vueFiles) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*background:\s*var\(--mi-card-bg\)[^{}]*)\}/g)) {
      // 选择器可能被 <style scoped> 的开标签污染（如 'scoped> .foo'），
      // 取最后一个 '>' 之后的部分即可得到真正的选择器。
      // 注意：不能只按 '<style' 切分——那样会剩下 'scoped> .foo'，
      // 导致「单一类选择器」判定失效、整条检查被静默跳过（实测踩过）。
      let sel = m[1].replace(/\s+/g, ' ').trim();
      sel = sel.slice(sel.lastIndexOf('>') + 1).trim();
      if (!/^\.[\w-]+$/.test(sel)) continue; // 只查单一类选择器
      const cls = sel.slice(1);
      if (EXEMPT.test(cls)) continue;

      // 该组件的模板里，这个类是否与 mi-surface 同时出现
      const usedTogether = new RegExp(
        `class="[^"]*\\b${cls}\\b[^"]*\\bmi-surface\\b|class="[^"]*\\bmi-surface\\b[^"]*\\b${cls}\\b`
      ).test(text);
      if (!usedTogether) {
        const lineNo = text.slice(0, m.index).split('\n').length;
        nonColorIssues.push({
          file: rel,
          line: lineNo,
          what: `卡片容器 .${cls} 用了 --mi-card-bg 作背景，但未声明 .mi-surface，磨砂模式下不会生效`,
          fix: `给该容器补上 .mi-surface（如 class="${cls} mi-surface"）`
        });
      }
    }
  }
}

// d) 壁纸必须经过压缩再入库。
//
// CSS 自定义属性有长度上限（实测约 2MB），超限后 setProperty 不报错但直接失效。
// 一张 15MB 的手机截图转成 data URL 是 19.9MB，远超上限：
// 存入 IndexedDB 成功、解码也成功，画面上却什么都没有。
// 因此上传路径必须先过 optimizeWallpaper。
const THEME_UI = join(SRC, 'components', 'ThemeSettingsModal.vue');
const IMAGE_UTIL = join(SRC, 'utils', 'image.js');
{
  const ui = readFileSync(THEME_UI, 'utf8');

  if (!/from\s+'\.\.\/utils\/image\.js'/.test(ui)) {
    nonColorIssues.push({
      file: 'src/components/ThemeSettingsModal.vue',
      line: 0,
      what: '壁纸上传未引入 utils/image.js，大图会因超出 CSS 变量上限而静默失效',
      fix: "引入 optimizeWallpaper 并在保存前调用"
    });
  } else if (!/optimizeWallpaper\s*\(/.test(ui)) {
    nonColorIssues.push({
      file: 'src/components/ThemeSettingsModal.vue',
      line: 0,
      what: '引入了 optimizeWallpaper 但未调用，壁纸没有被压缩',
      fix: '在 saveWallpaper 之前调用 optimizeWallpaper(dataUrl)'
    });
  }

  // 解码失败必须被识别：readAsDataURL 对任何文件都会成功，
  // 只有真正解码一次才能发现浏览器不支持该格式（HEIC / TIFF）
  if (/handleImageSelect/.test(ui) && !/decodeFailed/.test(ui)) {
    nonColorIssues.push({
      file: 'src/components/ThemeSettingsModal.vue',
      line: 0,
      what: '上传流程未检查解码失败，HEIC 等无法解码的格式会被"成功"保存却永不显示',
      fix: '检查 optimizeWallpaper 返回的 decodeFailed 并提示用户'
    });
  }

  if (!/wallpaperNotice/.test(ui)) {
    nonColorIssues.push({
      file: 'src/components/ThemeSettingsModal.vue',
      line: 0,
      what: '上传结果没有用户可见反馈，压缩或失败都会被静默吞掉',
      fix: '把结果写入 wallpaperNotice 并在界面上展示'
    });
  }

  // 压缩工具本身必须有体积上限，否则形同虚设
  if (!/MAX_WALLPAPER_BYTES/.test(readFileSync(IMAGE_UTIL, 'utf8'))) {
    nonColorIssues.push({
      file: 'src/utils/image.js',
      line: 0,
      what: '缺少 MAX_WALLPAPER_BYTES 体积上限，压缩可能仍产出超限结果',
      fix: '定义并依据 MAX_WALLPAPER_BYTES 控制输出体积'
    });
  }

  // theme.js 里的兜底校验：写入后读回，失效则告警
  const themeJs = readFileSync(join(SRC, 'utils', 'theme.js'), 'utf8');
  if (!/getPropertyValue\('--mi-custom-bg-image'\)/.test(themeJs)) {
    nonColorIssues.push({
      file: 'src/utils/theme.js',
      line: 0,
      what: 'applyTheme 未对 --mi-custom-bg-image 做写入校验，超大壁纸会静默失效',
      fix: '写入后 getPropertyValue 读回校验，失败则告警并降级'
    });
  }
}

// c) 卡片底色的不透明度必须真的来自用户设置。
//
// 曾经这里被写死成 0.92，把「卡片面板透明度」滑块彻底架空：
// 无论用户调到多透，卡片恒为 92% 不透明，壁纸只有约 8% 能透出来。
// 实测：修复前后壁纸对屏幕的贡献从 30.3 提升到 44.1（平均像素差）。
const TOKENS_FILE = join(SRC, 'theme', 'tokens.js');
{
  const text = readFileSync(TOKENS_FILE, 'utf8');
  // 取整行再解析：表达式里含逗号（toRgba(a, b)），
  // 用 [^,\n]+ 截取会在第一个逗号处断掉，导致误判。
  const cardLine = text.match(/^\s*'(--mi-card-bg)':\s*(.+?),\s*$/m);
  if (!cardLine) {
    nonColorIssues.push({
      file: 'src/theme/tokens.js',
      line: 0,
      what: '未找到 --mi-card-bg 的定义',
      fix: '确认卡片底色令牌仍然存在'
    });
  } else {
    const expr = cardLine[2];
    // 允许：toRgba(cardOwnRgb, cardAlpha) 这类引用变量；
    // 禁止：写死的字面量透明度，如 toRgba(cardRgb, 0.92)
    const hardcoded = expr.match(/,\s*(0?\.\d+|1(?:\.0+)?)\s*\)/);
    if (hardcoded) {
      const lineNo = text.slice(0, cardLine.index).split('\n').length;
      nonColorIssues.push({
        file: 'src/theme/tokens.js',
        line: lineNo,
        what: `--mi-card-bg 的不透明度被写死为 ${hardcoded[1]}，会架空「卡片面板透明度」设置，导致壁纸透不出来`,
        fix: '使用 cardAlpha（由 theme.cardOpacity 推导）而不是字面量'
      });
    }
    if (!/cardAlpha/.test(expr)) {
      const lineNo = text.slice(0, cardLine.index).split('\n').length;
      nonColorIssues.push({
        file: 'src/theme/tokens.js',
        line: lineNo,
        what: '--mi-card-bg 未引用 cardAlpha，卡片透明度可能不再跟随用户设置',
        fix: '写成 toRgba(cardOwnRgb, +cardAlpha.toFixed(3))'
      });
    }
  }
}

// a) background-image 里出现「渐变, #色值」这种非法组合
const PRESET_FILE = join(SRC, 'utils', 'theme.js');
{
  const text = readFileSync(PRESET_FILE, 'utf8');
  for (const m of text.matchAll(/css:\s*'([^']*)'/g)) {
    const value = m[1];
    if (!/gradient\(/i.test(value)) continue;
    // 合法：radial-gradient(...) 里带色值。非法：渐变列表之后再挂一个裸色值
    const tail = value.match(/\)\s*,\s*(#[0-9a-fA-F]{3,8}|[a-z]+)\s*$/);
    if (tail) {
      const lineNo = text.slice(0, m.index).split('\n').length;
      nonColorIssues.push({
        file: 'src/utils/theme.js',
        line: lineNo,
        what: `background-image 末尾出现裸色值 → ${tail[1]}（整条声明会被丢弃，背景不显示）`,
        fix: '把底色写进渐变自身，如 linear-gradient(#0f172a, #0f172a)'
      });
    }
  }
}

// b) 视频源声明的 MIME 必须与容器真实匹配
const VIDEO_MODAL = join(SRC, 'components', 'VideoPlayerModal.vue');
{
  const text = readFileSync(VIDEO_MODAL, 'utf8');

  // 检查每个「给 video 赋源」的代码块：块内若出现硬编码的 video/mp4
  // 而没有走 mimeForVideo，就会把 MKV/AVI 等按 MP4 容器交给 VHS 解析，
  // 起播必然失败，且控制条不会出现。
  //
  // 注意不能只匹配 `type: 'video/mp4'`：真实写法常见三元表达式
  //   type: isHls ? 'application/x-mpegURL' : 'video/mp4'
  // 那样纯字面量匹配会漏判（这个漏判本身就被实测抓到过）。
  const sourceBlocks = [
    ...text.matchAll(/player\.src\(\{[\s\S]{0,400}?\}\)/g),
    ...text.matchAll(/sources:\s*\[[\s\S]{0,400}?\]/g)
  ].map((m) => ({ block: m[0], index: m.index }));

  for (const { block, index } of sourceBlocks) {
    if (!/['"]video\/mp4['"]/.test(block)) continue;
    if (/mimeForVideo/.test(block)) continue;

    nonColorIssues.push({
      file: 'src/components/VideoPlayerModal.vue',
      line: text.slice(0, index).split('\n').length,
      what: "视频源在赋源处硬编码 'video/mp4'（MKV/AVI 等会被 VHS 按 MP4 解析，起播失败且不显示控制条）",
      fix: '改用 mimeForVideo(video?.path) 按真实扩展名给出 MIME'
    });
  }

  if (!/function mimeForVideo/.test(text)) {
    nonColorIssues.push({
      file: 'src/components/VideoPlayerModal.vue',
      line: 0,
      what: '缺少 mimeForVideo 辅助函数，无法按真实容器类型声明 MIME',
      fix: '恢复按扩展名映射 MIME 的实现'
    });
  }
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

console.log('='.repeat(74));
console.log('对比度守卫 (Contrast Guard)');
console.log('='.repeat(74));

console.log(`\n[1/3] 设计令牌自检 —— ${THEMES.length} 主题 × 2 模式 = ${tokenChecks} 项`);
if (tokenFailures.length === 0) {
  console.log(`      全部通过（要求 ≥ ${MIN_RATIO_TEXT}:1）`);
} else {
  console.log(`      失败 ${tokenFailures.length} 项：`);
  for (const f of tokenFailures) {
    console.log(`        ${f.theme.padEnd(22)} ${f.label.padEnd(22)} ${f.ratio}  (${f.fg} on ${f.bg})`);
  }
}

console.log(`\n[2/3] 源码巡检 —— 真实风险 ${sourceFindings.length} 处，已豁免 ${acceptableFindings.length} 处`);
console.log('      （豁免 = 深色遮罩 / 播放器皮肤 / 装饰图形，这些本就应固定）');
if (sourceFindings.length) {
  console.log('\n      以下声明未使用设计令牌，主题或深浅切换时不会跟随变化：');
  const byFile = {};
  for (const f of sourceFindings) (byFile[f.file] ||= []).push(f);
  for (const [file, items] of Object.entries(byFile)) {
    console.log(`\n      ${file}  (${items.length} 处)`);
    for (const it of items.slice(0, 8)) {
      console.log(`        :${it.line}  ${it.selector.padEnd(50)} ${it.decl}`);
    }
    if (items.length > 8) console.log(`        … 另有 ${items.length - 8} 处`);
  }
  console.log('\n      替换建议：');
  console.log('        color: #fff        → color: var(--mi-on-accent)   （强调实心底上）');
  console.log('        color: #334155     → color: var(--mi-text-main)');
  console.log('        color: #94a3b8     → color: var(--mi-text-sub)');
  console.log('        background: #f1f5f9 → background: var(--mi-control-sub-bg)');
  console.log('        background: #fff    → background: var(--mi-card-bg)');
}

console.log(`\n[3/3] 非颜色约束 —— ${nonColorIssues.length} 处问题`);
if (nonColorIssues.length === 0) {
  console.log('      background-image、视频 MIME、卡片不透明度、壁纸压缩、卡片声明协议均已检查');
} else {
  for (const it of nonColorIssues) {
    console.log(`\n      ${it.file}:${it.line}`);
    console.log(`        ${it.what}`);
    console.log(`        修法：${it.fix}`);
  }
}

console.log('\n' + '='.repeat(74));
const ok =
  tokenFailures.length === 0 && sourceFindings.length === 0 && nonColorIssues.length === 0;
if (ok) {
  console.log('结果：全部通过。主题适配由令牌引擎保证，无硬编码泄漏。');
} else {
  console.log(
    `结果：令牌自检失败 ${tokenFailures.length} 项；` +
      `硬编码待清理 ${sourceFindings.length} 处；` +
      `非颜色约束 ${nonColorIssues.length} 处。`
  );
}
console.log('='.repeat(74));

process.exit(ok ? 0 : 1);
