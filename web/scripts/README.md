# 主题与配色架构

## 为什么不推荐引入模板引擎

本次适配问题的根源**不在渲染层**。前端已经是 Vue 3 组件化结构，
模板本身没有问题；问题在于 300 多处颜色被**逐个组件写死**
（`color: #fff`、`background: #f1f5f9`），主题或深浅模式切换时它们不会跟随变化。

换用 Handlebars / Nunjucks / EJS 等模板引擎并不能解决这一点 ——
模板引擎只负责把数据填进字符串，对 CSS 层叠、继承、主题变量一无所知，
写死的颜色照样写死。反而是**降级**：Vue 已有的响应式、组件作用域样式、
构建期优化都会丢掉。

真正有效的做法是「设计令牌 + 对比度守卫」，已在下面落地。

## 目录

| 文件 | 职责 |
|---|---|
| `src/theme/color.js` | 纯色彩运算：解析、合成、WCAG 亮度/对比度、达标修正 |
| `src/theme/tokens.js` | 设计令牌引擎：合成真实表面色 → 推导前景 → 强制对比度校验 |
| `src/utils/theme.js` | 主题状态与持久化；调用引擎把令牌写进 DOM |
| `scripts/contrast-guard.mjs` | 构建期守卫：令牌自检 + 源码硬编码巡检 |
| `scripts/codemod-tokens*.mjs` | 一次性迁移脚本（已执行完毕，保留供追溯） |

## 令牌引擎如何保证不再出问题

1. **合成真实表面色**
   半透明卡片（云母 55%）不能只看配置里的颜色，必须按不透明度
   叠加到底盘上，算出用户实际看到的颜色。

2. **跨表面统一校准**
   同一个 `--mi-text-main` 会出现在卡片、凹槽、控件底等多种表面上。
   引擎对**所有已知表面**求一个都达标的前景色，取最不利的那个作准，
   避免「在卡片上刚好达标、换个容器就不够」。

3. **成对生成底色与字色**
   `--mi-orange` 与 `--mi-on-accent` 一起产出。遇到中明度颜色
   （如 `#8b5cf6`、`#ef4444`）无论配白字还是墨字都不够 4.5:1 时，
   引擎会把底色朝远离文字的方向推一点，直到配对达标 ——
   而不是各改各的、最后对不上。

4. **构建期守卫**
   `npm run build` 会先跑 `contrast-guard.mjs`：
   - 遍历 10 个主题 × 2 种模式（含亮黄、近白等对抗性强调色），
     校验每个前景/背景配对；
   - 静态扫描 `.vue`/`.css`，找出绕过令牌直接写死的颜色，
     只对「深色遮罩/播放器皮肤/装饰图形」等确属固定的场景豁免。

   任何一处不达标都会**构建失败**，把视觉缺陷变成可断言的错误。

## 令牌命名

| 令牌 | 用途 |
|---|---|
| `--mi-bg` / `--mi-card-bg` / `--mi-card-sub-bg` | 底盘、卡片、次级卡片 |
| `--mi-control-bg` / `--mi-control-sub-bg` | 控件实底、凹槽 |
| `--mi-control-bg-glass` / `--mi-control-border-glass` | 磨砂控件底与描边（携带透明度） |
| `--mi-text-main` / `--mi-text-sub` | 常规前景（主/次） |
| `--mi-control-text` / `--mi-control-text-sub` | 磨砂控件内前景 |
| `--mi-orange` / `--mi-orange-hover` | 强调色实底 |
| `--mi-on-accent` | **强调实底之上**的文字色（与 `--mi-orange` 成对） |
| `--mi-accent-text` / `--mi-accent-text-on-soft` | 强调色当文字用时（浅底压深、深底提亮） |
| `--mi-status-{green,red,orange,blue,cyan,violet}` | 语义状态文字色 |
| `--mi-status-*-soft` | 语义状态淡底 |
| `--mi-danger-solid` / `--mi-on-danger-solid` | 危险操作实心按钮底与字（清空缓存、删除等，成对） |
| `--mi-construct-ink` / `--mi-construct-red` / `--mi-on-construct-red` | 构成主义墨色与革命红（及其配套字色） |
| `--mi-player-shell-bg` / `--mi-player-shell-text` / `--mi-player-shell-text-sub` | 视频播放器外壳（标题栏/底部栏），跟随主题 |
| `--mi-player-scrim` / `--mi-player-scrim-text` / `--mi-player-scrim-text-dim` | 视频控制条遮罩与其上文字。遮罩**刻意固定深色**：视频画面内容不可预知，浅色遮罩会让控件在亮画面上消失 |
| `--mi-player-accent` | 进度条/音量条填充色（跟随主题强调色，按 3:1 图形标准校验） |

## 卡片容器声明协议：`.mi-surface`

**新增任何卡片/面板容器时，给它的类名后面加上 `mi-surface`。**

```html
<!-- StorageMeter.vue -->
<div class="storage-card mi-surface">…</div>
```

原因：磨砂与卡片样式过去靠 CSS 里一份**硬编码的类名清单**施加，例如：

```css
html.theme-mica-all-containers .storage-card,
html.theme-mica-all-containers .chart-card,   /* 组件里没有这个类 */
html.theme-mica-all-containers .grid-card,    /* 也没有 */
html.theme-mica-all-containers .recent-card,  /* 实际叫 recent-media-card */
```

这类清单有两种必然的失效方式，而且都是**静默**的：

1. 组件改了类名（`chart-card` → `monitor-card`），清单不会跟着变；
2. 新增卡片时忘了回来补名字。

真实后果是「全局卡片磨砂只有一个卡片生效，其余仍是半透明」——`storage-card`
碰巧对上了，其余五个全部漏掉。

现在改为**声明式**：组件自己标注 `.mi-surface`，CSS 只认这一个类。
新增卡片是「加了类就有磨砂」，而不是「忘了改 style.css 就没效果」。
把容易漏的远端清单，换成近处的显式声明。

构成主义主题的编号角标同样改为声明式，用 CSS 变量传入：

```html
<div class="monitor-card mi-surface" style="--mi-surface-label: '№ 02'">
```

未声明则不生成角标。这样新增卡片时编号不会错位，也不用回来改 CSS。

## 新增组件时的约定

- 颜色**只**使用上表中的令牌，不写 `#xxx` / `white` / `rgba(...)`。
- 要「强调色当文字用」→ `var(--mi-accent-text)`，不要 `var(--mi-orange)`。
- 在强调实心底上放文字 → `color: var(--mi-on-accent)`，不要 `color: white`。
- 危险操作按钮 → 底 `var(--mi-danger-solid)`、字 `var(--mi-on-danger-solid)`，并给它加上 `danger-btn` 类，
  否则云母主题的磨砂规则会把它刷成浅色玻璃、丢掉危险暗示。
- **卡片/面板容器 → 加 `mi-surface` 类**（见上一节）。
- 视频播放器内的控件：写入 `src/assets/style.css` 的播放器段落，**不要**依赖 scoped 样式
  （video.js 的节点是运行时插入的，scoped 选择器匹配不到）。
- 写完后跑 `npm run guard` 确认通过。

## 自动化守卫覆盖了哪些东西

`npm run guard` 会对 10 组「主题 × 深浅模式」组合逐一校验上表中每一对前景/背景，
覆盖 360 项断言；其中包含对抗性用例（亮黄 `#fde047`、近白 `#f8fafc`、近黑 `#0a0a0a`、
中明度紫 `#8b5cf6` 等用户可能选到的极端强调色）。

除了颜色，守卫还反映四类**非颜色**约束：

- `background-image` 只接受 `<image>` 列表，**不接受末尾纯色值**。
  `radial-gradient(...), #0f172a` 是无效声明，整条会被浏览器丢弃 ——
  内置壁纸曾因此完全不显示。底色必须写进渐变自身。
- 视频流的 MIME 类型必须与容器真实匹配。NAS 上的 MKV/AVI/RMVB 若被声明为
  `video/mp4`，video.js 的 VHS 会按 MP4 容器去解析，起播必然失败，
  且因为 `vjs-has-started` 不会被置位，控制条也永远不出现（表现为「黑屏且没有进度条」）。
- `--mi-card-bg` / `--mi-card-sub-bg` 的不透明度必须真的来自 `theme.cardOpacity`。
  这两个令牌曾被写死成 0.92，把「卡片面板透明度」滑块彻底架空：
  卡片恒为 92% 不透明，壁纸只有约 8% 能透出来，用户看到的就是「设了壁纸但没显示」。
  实测修复前后，壁纸对屏幕的贡献（逐像素平均差）从 30.3 提升到 44.1。
- **壁纸必须先压缩再入库**。CSS 自定义属性有长度上限（实测约 2MB），
  超过后 `setProperty` 不报错却直接失效。一张 15MB 的 PNG 截图转成 data URL 是 19.9MB，
  存进 IndexedDB 成功、解码也成功，画面上却什么都没有。
  上传路径必须过 `utils/image.js` 的 `optimizeWallpaper`。

## 图片格式与体积

壁纸能否显示取决于浏览器能否解码该格式，与文件大小无关的部分：

| 浏览器可解码 | 不可解码 |
|---|---|
| PNG（含 16 位灰度、透明）、JPEG（含 CMYK、渐进式）、WebP、GIF、BMP、AVIF、SVG | **HEIC / HEIF**（iPhone 默认格式）、**TIFF** |

注意 `accept="image/*"` 只是文件选择器的过滤提示，`readAsDataURL` 对**任何**文件
都会成功（它只做 base64 编码，不解析内容），所以「保存成功」从不代表「画得出来」。
上传时必须真正解码一次再决定是否接受。

体积方面的实测上限（Chromium）：

| 承载方式 | 上限 |
|---|---|
| CSS 自定义属性 | 约 2MB |
| 元素直接样式 `el.style.backgroundImage` | 约 28MB |

壁纸走的是前者，所以 `MAX_WALLPAPER_BYTES` 定为 1.5MB（留安全余量），
长边限制 2560px（主流屏幕已足够，再大对背景图没有可见收益）。

## 判断视觉问题时的注意事项

「属性被设置」不等于「用户看得见」。排查壁纸类问题时：

- `getComputedStyle(...).backgroundImage` 返回 `url(...)` 只说明属性合法，
  **不能**证明屏幕上能看到它 —— 它可能被上层不透明容器完全盖住。
- 判断真实可见性要用**差值法**：把目标图层改成两种反差色各截一张图，
  逐像素求差；差异幅度就是它到达屏幕的实际强度。
- 注意 `background-image` 不接受末尾纯色值、`getComputedStyle().backgroundColor`
  不会解析渐变 —— 这两点都曾导致误判。
- 排查时先停掉 transition/animation，否则会截到过渡中间态。
