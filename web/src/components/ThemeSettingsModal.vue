<template>
  <div v-if="visible" class="modal-backdrop" @click.self="$emit('close')">
    <div class="custom-modal theme-modal-v2 mi-surface">
      <!-- 模态框顶部 -->
      <div class="modal-hdr-v2">
        <div class="hdr-left">
          <div class="hdr-badge-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
              <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
              <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
              <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2Z"/>
            </svg>
          </div>
          <div class="hdr-text">
            <h4>个性化外观与主题美化</h4>
            <p>定制专属米家数据终端视觉风格与质感滤镜</p>
          </div>
        </div>
        <button class="close-btn-v2" @click="$emit('close')" title="关闭">✕</button>
      </div>

      <!-- 选项卡导航导航条 -->
      <div class="theme-nav-tabs">
        <button
          v-for="tab in navTabs"
          :key="tab.id"
          class="theme-tab-btn"
          :class="{ active: currentTab === tab.id }"
          @click="currentTab = tab.id"
        >
          <span class="tab-icon">{{ tab.icon }}</span>
          <span>{{ tab.label }}</span>
        </button>
      </div>

      <!-- 主设置滚动区域 -->
      <div class="theme-modal-body">
        <!-- 实时微缩预览栏 (Mini Preview Stage) -->
        <div class="preview-mini-stage">
          <div class="stage-label">
            <span>实时视觉预览</span>
            <span class="preview-tag">{{ currentTheme.name }}</span>
          </div>
          <div class="stage-canvas" :class="[`theme-${currentTheme.id}`, { dark: isDarkActive }]">
            <!-- 模拟顶部 -->
            <div class="mock-header">
              <div class="mock-logo"></div>
              <div class="mock-title-bar"></div>
              <div class="mock-pill" :style="{ backgroundColor: currentTheme.accentColor }">在线</div>
            </div>
            <!-- 模拟两列卡片 -->
            <div class="mock-cards-row">
              <div class="mock-card card-left">
                <div class="mock-card-hdr">
                  <div class="mock-card-dot" :style="{ backgroundColor: currentTheme.accentColor }"></div>
                  <div class="mock-bar w-40"></div>
                </div>
                <div class="mock-pie" :style="{ borderColor: currentTheme.accentColor }"></div>
                <div class="mock-bar w-80"></div>
              </div>
              <div class="mock-card card-right">
                <div class="mock-card-hdr">
                  <div class="mock-bar w-60"></div>
                </div>
                <div class="mock-grid">
                  <div class="mock-grid-item" v-for="i in 4" :key="i">
                    <div class="mock-icon-sq" :style="{ backgroundColor: i === 1 ? currentTheme.accentColor : '' }"></div>
                    <div class="mock-bar w-50"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 选项卡 1：预设风格与色调 -->
        <div v-show="currentTab === 'presets'" class="tab-pane">
          <!-- 明暗色彩模式 -->
          <div class="section-card">
            <div class="section-card-title">
              <div class="title-with-badge">
                <span>🌓 色彩光暗模式</span>
                <span class="badge-sub">全组件自适应</span>
              </div>
            </div>
            <div class="mode-cards-grid">
              <div
                class="mode-card"
                :class="{ active: currentTheme.colorMode === 'light' }"
                @click="setColorMode('light')"
              >
                <div class="mode-card-preview light-pv">
                  <div class="pv-bar"></div>
                  <div class="pv-box"></div>
                </div>
                <div class="mode-info">
                  <span class="mode-name">☀️ 浅色明亮</span>
                  <span class="mode-desc">清爽经典极简白</span>
                </div>
              </div>

              <div
                class="mode-card"
                :class="{ active: currentTheme.colorMode === 'dark' }"
                @click="setColorMode('dark')"
              >
                <div class="mode-card-preview dark-pv">
                  <div class="pv-bar"></div>
                  <div class="pv-box"></div>
                </div>
                <div class="mode-info">
                  <span class="mode-name">🌙 深邃暗夜</span>
                  <span class="mode-desc">沉浸黑曜低功耗</span>
                </div>
              </div>

              <div
                class="mode-card"
                :class="{ active: currentTheme.colorMode === 'auto' }"
                @click="setColorMode('auto')"
              >
                <div class="mode-card-preview auto-pv">
                  <div class="pv-half-light"></div>
                  <div class="pv-half-dark"></div>
                </div>
                <div class="mode-info">
                  <span class="mode-name">💻 跟随系统</span>
                  <span class="mode-desc">自动匹配操作系统</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 精选预设风格 -->
          <div class="section-card">
            <div class="section-card-title">
              <div class="title-with-badge">
                <span>✨ 预设视觉风格库</span>
                <span class="badge-sub">专业调色与动效体系</span>
              </div>
            </div>
            <div class="presets-flow-grid">
              <div
                v-for="(p, key) in PRESETS"
                :key="key"
                class="preset-item-card"
                :class="{ active: currentTheme.id === p.id }"
                @click="applyPreset(key)"
              >
                <div class="preset-banner" :class="`banner-${p.id}`">
                  <span class="preset-tag-pill">{{ p.tag }}</span>
                  <div class="preset-banner-content">
                    <span class="banner-accent-dot" :style="{ backgroundColor: p.accentColor }"></span>
                  </div>
                </div>
                <div class="preset-body">
                  <div class="preset-header-row">
                    <span class="preset-title">{{ p.name }}</span>
                    <span v-if="currentTheme.id === p.id" class="using-badge">当前使用</span>
                  </div>
                  <p class="preset-expl">{{ p.description }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 强调色选择器 -->
          <div class="section-card">
            <div class="section-card-title">
              <div class="title-with-badge">
                <span>🎨 主题强调色 (Accent Color)</span>
                <span class="badge-sub">按钮、徽标与高光</span>
              </div>
              <div class="color-picker-wrapper">
                <span class="color-hex-label">{{ currentTheme.accentColor }}</span>
                <input
                  type="color"
                  v-model="currentTheme.accentColor"
                  @input="handleAccentChange"
                  class="native-color-picker"
                  title="选取自定义颜色"
                />
              </div>
            </div>
            <div class="palette-row">
              <button
                v-for="item in ACCENT_PALETTE"
                :key="item.value"
                class="palette-swatch"
                :class="{ active: currentTheme.accentColor.toLowerCase() === item.value.toLowerCase() }"
                :style="{ backgroundColor: item.value }"
                :title="item.name"
                @click="setAccentColor(item.value)"
              >
                <span v-if="currentTheme.accentColor.toLowerCase() === item.value.toLowerCase()" class="check-mark">✓</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 选项卡 2：壁纸与背景 -->
        <div v-show="currentTab === 'wallpaper'" class="tab-pane">
          <!-- 内置精美渐变壁纸库 -->
          <div class="section-card">
            <div class="section-card-title">
              <div class="title-with-badge">
                <span>🌌 内置艺术背景库</span>
                <span class="badge-sub">免下载即点即换</span>
              </div>
            </div>
            <div class="preset-wallpapers-grid">
              <div
                v-for="bg in PRESET_WALLPAPERS"
                :key="bg.id"
                class="wallpaper-item"
                :class="{ active: currentTheme.presetBgId === bg.id && !currentWallpaperUrl }"
                :style="{ background: bg.css }"
                @click="handleSelectPresetBg(bg.id)"
              >
                <span class="wallpaper-name">{{ bg.name }}</span>
                <span v-if="currentTheme.presetBgId === bg.id && !currentWallpaperUrl" class="wallpaper-active-icon">✓</span>
              </div>
            </div>
          </div>

          <!-- 自定义上传本地背景 -->
          <div class="section-card">
            <div class="section-card-title">
              <div class="title-with-badge">
                <span>🖼️ 本地壁纸上传</span>
                <span class="badge-sub">存储在浏览器 IndexedDB，不耗 NAS 空间</span>
              </div>
            </div>

            <div class="upload-area-box" :class="{ 'has-file': !!currentWallpaperUrl }">
              <input
                type="file"
                ref="fileInputRef"
                accept="image/*"
                style="display: none"
                @change="handleImageSelect"
              />
              
              <div v-if="currentWallpaperUrl" class="active-wallpaper-preview">
                <img :src="currentWallpaperUrl" alt="已加载壁纸" class="thumb-img" />
                <div class="thumb-meta">
                  <div class="thumb-status">
                    <span class="status-indicator"></span>
                    <strong>已加载自定义本地壁纸</strong>
                  </div>
                  <p class="thumb-tip">当前正在使用您上传的高清壁纸作为全局底盘。</p>
                  <div class="thumb-actions">
                    <button class="small-action-btn" @click="triggerUpload">🔄 替换壁纸</button>
                    <button class="small-action-btn danger" @click="handleClearBg">🗑️ 移除壁纸</button>
                  </div>
                </div>
              </div>

              <div v-else class="upload-dropzone" @click="triggerUpload">
                <div class="dropzone-icon">📁</div>
                <div class="dropzone-text">
                  <strong>点击选择本地图片作为背景</strong>
                  <span>支持 JPG / PNG / WEBP / AVIF / SVG；iPhone 的 HEIC 需先转成 JPG</span>
                </div>
              </div>

              <!-- 上传结果反馈：格式不支持、已自动压缩等，都要让用户看得见 -->
              <div
                v-if="wallpaperNotice"
                class="notice-banner"
                :class="{ error: wallpaperNoticeError }"
              >
                <span>{{ wallpaperNotice }}</span>
              </div>
            </div>

            <!-- 背景滤镜微调 -->
            <div v-if="currentWallpaperUrl || currentTheme.bgEnabled" class="slider-box-wrapper">
              <div class="slider-row-modern">
                <div class="slider-info">
                  <span class="s-label">背景亮度</span>
                  <span class="s-val">{{ currentTheme.bgBrightness }}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="150"
                  v-model.number="currentTheme.bgBrightness"
                  @input="handleCustomSlider"
                  class="modern-range"
                />
              </div>

              <div class="slider-row-modern">
                <div class="slider-info">
                  <span class="s-label">背景高斯模糊</span>
                  <span class="s-val">{{ currentTheme.bgBlur }}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="35"
                  v-model.number="currentTheme.bgBlur"
                  @input="handleCustomSlider"
                  class="modern-range"
                />
              </div>

              <div class="slider-row-modern">
                <div class="slider-info">
                  <span class="s-label">背景不透明度</span>
                  <span class="s-val">{{ currentTheme.bgOpacity }}%</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  v-model.number="currentTheme.bgOpacity"
                  @input="handleCustomSlider"
                  class="modern-range"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- 选项卡 3：磨砂玻璃与微调 -->
        <div v-show="currentTab === 'glass'" class="tab-pane">
          <!-- 磨砂模式架构选择 -->
          <div class="section-card">
            <div class="section-card-title">
              <div class="title-with-badge">
                <span>💎 磨砂玻璃架构模式</span>
                <span class="badge-sub">选择毛玻璃透光层级</span>
              </div>
            </div>

            <div class="scope-options-grid">
              <div
                class="scope-card"
                :class="{ active: currentTheme.blurScope === 'controls_only' }"
                @click="setBlurScope('controls_only')"
              >
                <div class="scope-radio-row">
                  <input
                    type="radio"
                    value="controls_only"
                    v-model="currentTheme.blurScope"
                    @change="handleCustomSlider"
                  />
                  <strong>仅按钮与功能控件磨砂 (推荐)</strong>
                </div>
                <p class="scope-desc">
                  大容器高透不模糊，底盘壁纸完整高清呈现，所有按钮、标签、浮层具有晶莹剔透的亚克力磨砂质感。
                </p>
              </div>

              <div
                class="scope-card"
                :class="{ active: currentTheme.blurScope === 'all_containers' }"
                @click="setBlurScope('all_containers')"
              >
                <div class="scope-radio-row">
                  <input
                    type="radio"
                    value="all_containers"
                    v-model="currentTheme.blurScope"
                    @change="handleCustomSlider"
                  />
                  <strong>全局卡片整体磨砂</strong>
                </div>
                <p class="scope-desc">
                  仪表盘、监控卡片及应用网格等大面板整体施加深邃的高斯模糊层，营造厚重的悬浮磨砂玻璃视效。
                </p>
              </div>
            </div>
          </div>

          <!-- 质感参数滑块群 -->
          <div class="section-card">
            <div class="section-card-title">
              <div class="title-with-badge">
                <span>🎛️ 亚克力质感参数精确调节</span>
              </div>
            </div>

            <div class="slider-box-wrapper">
              <div class="slider-row-modern" v-if="currentTheme.blurScope === 'controls_only'">
                <div class="slider-info">
                  <span class="s-label">控件磨砂半径 (Control Blur)</span>
                  <span class="s-val">{{ currentTheme.controlBlur ?? 16 }}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="32"
                  v-model.number="currentTheme.controlBlur"
                  @input="handleCustomSlider"
                  class="modern-range"
                />
              </div>

              <div class="slider-row-modern" v-if="currentTheme.blurScope === 'all_containers'">
                <div class="slider-info">
                  <span class="s-label">卡片磨砂半径 (Card Blur)</span>
                  <span class="s-val">{{ currentTheme.cardBlur }}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="32"
                  v-model.number="currentTheme.cardBlur"
                  @input="handleCustomSlider"
                  class="modern-range"
                />
              </div>

              <div class="slider-row-modern">
                <div class="slider-info">
                  <span class="s-label">卡片面板透明度 (Card Opacity)</span>
                  <span class="s-val">{{ currentTheme.cardOpacity }}%</span>
                </div>
                <input
                  type="range"
                  min="15"
                  max="100"
                  v-model.number="currentTheme.cardOpacity"
                  @input="handleCustomSlider"
                  class="modern-range"
                />
              </div>

              <div class="slider-row-modern">
                <div class="slider-info">
                  <span class="s-label">饱和度增强 (Backdrop Saturate)</span>
                  <span class="s-val">{{ currentTheme.cardSaturate }}%</span>
                </div>
                <input
                  type="range"
                  min="100"
                  max="250"
                  v-model.number="currentTheme.cardSaturate"
                  @input="handleCustomSlider"
                  class="modern-range"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- 选项卡 4：导入导出与分享 -->
        <div v-show="currentTab === 'backup'" class="tab-pane">
          <div class="section-card">
            <div class="section-card-title">
              <div class="title-with-badge">
                <span>📦 方案导出与备份</span>
                <span class="badge-sub">生成标准 JSON 文件</span>
              </div>
            </div>
            <p class="section-lead-text">
              您可以将您精心调试的主题参数、色彩搭配甚至整套本地壁纸导出为单文件，方便随时还原或与其他客户端分享。
            </p>

            <div class="backup-actions-grid">
              <div class="backup-action-card" @click="handleExport(false)">
                <div class="action-card-icon">📄</div>
                <div class="action-card-info">
                  <strong>导出主题参数配置</strong>
                  <span>仅导出纯色彩、模糊度与样式规则（体积极小）</span>
                </div>
                <button class="pill-btn">导出 JSON</button>
              </div>

              <div
                class="backup-action-card"
                :class="{ disabled: !currentWallpaperUrl }"
                @click="currentWallpaperUrl ? handleExport(true) : null"
              >
                <div class="action-card-icon">🎁</div>
                <div class="action-card-info">
                  <strong>导出完整配置包 (含高清壁纸)</strong>
                  <span>将个性化背景与所有滤镜整合打包为完整工程文件</span>
                </div>
                <button class="pill-btn" :disabled="!currentWallpaperUrl">导出完整包</button>
              </div>

              <label class="backup-action-card import-card">
                <div class="action-card-icon">📥</div>
                <div class="action-card-info">
                  <strong>从文件导入主题配置</strong>
                  <span>选择已有的 .json 主题方案文件并立即渲染</span>
                </div>
                <span class="pill-btn primary">选择文件</span>
                <input
                  type="file"
                  accept=".json"
                  style="display: none"
                  @change="handleImportFile"
                />
              </label>
            </div>

            <!-- 导入反馈横幅 -->
            <transition name="fade">
              <div v-if="importNotice" class="notice-banner" :class="{ error: importNoticeError }">
                <span>{{ importNotice }}</span>
              </div>
            </transition>
          </div>
        </div>
      </div>

      <!-- 底部操作与重置栏 -->
      <div class="modal-ftr-v2">
        <div class="ftr-left-status">
          <span class="status-dot"></span>
          <span>当前主题：<strong>{{ currentTheme.name }}</strong> ({{ currentTheme.id }})</span>
        </div>
        <div class="ftr-right-buttons">
          <button class="btn-ghost" @click="resetToDefault">恢复默认</button>
          <button class="btn-primary" @click="$emit('close')">完成并保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import {
  PRESETS,
  ACCENT_PALETTE,
  PRESET_WALLPAPERS,
  currentTheme,
  currentWallpaperUrl,
  applyTheme,
  saveThemeConfig,
  saveWallpaper,
  clearWallpaper,
  setPresetWallpaper,
  switchPreset,
  exportThemeJSON,
  importThemeJSON
} from '../utils/theme.js';
import { optimizeWallpaper } from '../utils/image.js';

defineProps({
  visible: { type: Boolean, default: false }
});

defineEmits(['close']);

// 选项卡切换
const currentTab = ref('presets');
const navTabs = [
  { id: 'presets', label: '预设与风格', icon: '🎨' },
  { id: 'wallpaper', label: '壁纸与背景', icon: '🖼️' },
  { id: 'glass', label: '磨砂与亚克力', icon: '💎' },
  { id: 'backup', label: '备份与分享', icon: '💾' }
];

const fileInputRef = ref(null);
const importNotice = ref('');
// 壁纸上传的反馈：格式不被支持、体积被自动压缩等都需要明确告知用户，
// 否则「保存成功但屏幕无变化」会让人完全摸不着头脑
const wallpaperNotice = ref('');
const wallpaperNoticeError = ref(false);
const importNoticeError = ref(false);

const isDarkActive = computed(() => {
  if (currentTheme.colorMode === 'dark') return true;
  if (currentTheme.colorMode === 'auto' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
});

function triggerUpload() {
  fileInputRef.value?.click();
}

async function handleImageSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  // 允许重复选择同一个文件（否则第二次选它不会触发 change）
  const inputEl = e.target;

  wallpaperNotice.value = '';
  wallpaperNoticeError.value = false;

  const readDataUrl = () =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target?.result);
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });

  let dataUrl;
  try {
    dataUrl = await readDataUrl();
  } catch (err) {
    wallpaperNotice.value = '读取文件失败：' + err.message;
    wallpaperNoticeError.value = true;
    inputEl.value = '';
    return;
  }
  if (!dataUrl) { inputEl.value = ''; return; }

  // 关键：先真正解码一次。
  // readAsDataURL 对任何文件都会成功（它只做 base64 编码，不解析内容），
  // 所以「上传成功」并不代表浏览器画得出来 —— HEIC / TIFF 就是这样
  // 保存成功却完全不显示的。这里提前把失败拦下来并如实告知。
  const optimized = await optimizeWallpaper(dataUrl);

  if (optimized.decodeFailed) {
    const ext = (file.name.split('.').pop() || '').toUpperCase();
    wallpaperNotice.value =
      `这个图片浏览器无法解码${ext ? `（${ext}）` : ''}，无法作为壁纸。` +
      `请先转成 JPG / PNG / WebP 再上传。`;
    wallpaperNoticeError.value = true;
    inputEl.value = '';
    return;
  }

  try {
    await saveWallpaper(optimized.dataUrl);
    if (optimized.optimized) {
      const from = (optimized.originalBytes / 1048576).toFixed(1);
      const to = (optimized.bytes / 1048576).toFixed(1);
      wallpaperNotice.value =
        `已应用壁纸，并自动压缩至 ${optimized.size}（${from}MB → ${to}MB）。` +
        `原图 ${optimized.originalSize} 超出浏览器背景图上限，直接使用会无法显示。`;
    } else {
      wallpaperNotice.value = '壁纸已应用';
    }
    wallpaperNoticeError.value = false;
  } catch (err) {
    wallpaperNotice.value = '保存本地壁纸失败：' + err.message;
    wallpaperNoticeError.value = true;
  } finally {
    inputEl.value = '';
  }
}

async function handleClearBg() {
  await clearWallpaper();
}

function handleSelectPresetBg(id) {
  setPresetWallpaper(id);
}

function setColorMode(mode) {
  currentTheme.colorMode = mode;
  applyTheme();
  saveThemeConfig();
}

function applyPreset(key) {
  switchPreset(key);
}

function setAccentColor(color) {
  currentTheme.accentColor = color;
  applyTheme();
  saveThemeConfig();
}

function handleAccentChange() {
  applyTheme();
  saveThemeConfig();
}

function setBlurScope(scope) {
  currentTheme.blurScope = scope;
  handleCustomSlider();
}

function handleCustomSlider() {
  currentTheme.id = 'custom';
  currentTheme.name = '自定义视觉风格';
  applyTheme();
  saveThemeConfig();
}

function resetToDefault() {
  clearWallpaper();
  switchPreset('default');
  currentTheme.colorMode = 'light';
  currentTab.value = 'presets';
}

function handleExport(includeBg) {
  exportThemeJSON(includeBg);
}

async function handleImportFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (ev) => {
    const text = ev.target?.result;
    if (typeof text === 'string') {
      const res = await importThemeJSON(text);
      if (res.ok) {
        importNotice.value = `✓ 成功导入主题「${res.name}」并已应用`;
        importNoticeError.value = false;
      } else {
        importNotice.value = `导入失败: ${res.error}`;
        importNoticeError.value = true;
      }
      setTimeout(() => { importNotice.value = ''; }, 4000);
    }
  };
  reader.readAsText(file);
}
</script>

<style scoped>
.theme-modal-v2 {
  width: 720px;
  max-width: 95vw;
  background: var(--mi-card-bg);
  border-radius: 20px;
  border: 1px solid var(--mi-border);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modalScaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modalScaleIn {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* 顶部标题区 */
.modal-hdr-v2 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--mi-border);
}

.hdr-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.hdr-badge-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--mi-accent-soft), var(--mi-accent-soft));
  color: var(--mi-orange);
  display: flex;
  align-items: center;
  justify-content: center;
}

.hdr-text h4 {
  margin: 0 0 4px;
  font-size: 17px;
  font-weight: 700;
  color: var(--mi-text-main);
}

.hdr-text p {
  margin: 0;
  font-size: 12px;
  color: var(--mi-text-sub);
}

.close-btn-v2 {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--mi-text-sub);
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.close-btn-v2:hover {
  background: var(--mi-control-sub-bg);
  color: var(--mi-text-main);
}

/* 选项卡导航条 */
.theme-nav-tabs {
  display: flex;
  padding: 6px 20px;
  gap: 8px;
  background: var(--mi-card-sub-bg);
  border-bottom: 1px solid var(--mi-border);
}

.theme-tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 10px;
  border: none;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-text-sub);
  cursor: pointer;
  transition: all 0.2s;
}

.theme-tab-btn:hover {
  color: var(--mi-text-main);
  background: var(--mi-control-sub-bg);
}

.theme-tab-btn.active {
  background: var(--mi-card-bg);
  color: var(--mi-accent-text);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

/* 主内容滚动区 */
.theme-modal-body {
  padding: 20px 24px;
  max-height: 62vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 实时预览微缩舞台 */
.preview-mini-stage {
  background: var(--mi-card-sub-bg);
  border: 1px solid var(--mi-border);
  border-radius: 14px;
  padding: 12px 14px;
}

.stage-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--mi-text-sub);
  margin-bottom: 10px;
}

.preview-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--mi-accent-soft);
  color: var(--mi-orange);
  font-weight: 600;
}

.stage-canvas {
  height: 100px;
  background: var(--mi-control-sub-bg);
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  overflow: hidden;
  transition: all 0.3s;
}

.stage-canvas.dark {
  background: var(--mi-bg);
  border-color: #1e293b;
}

.mock-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 18px;
}

.mock-logo {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: var(--mi-orange, #ff6700);
}

.mock-title-bar {
  width: 70px;
  height: 8px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.4);
}

.mock-pill {
  margin-left: auto;
  font-size: 9px;
  color: white;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: bold;
}

.mock-cards-row {
  display: grid;
  grid-template-columns: 1fr 1.6fr;
  gap: 8px;
  flex: 1;
}

.mock-card {
  background: white;
  border-radius: 8px;
  padding: 6px 8px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stage-canvas.dark .mock-card {
  background: #1e293b;
  border-color: #334155;
}

.mock-card-hdr {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mock-card-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.mock-bar {
  height: 6px;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.3);
}

.w-40 { width: 40%; }
.w-50 { width: 50%; }
.w-60 { width: 60%; }
.w-80 { width: 80%; }

.mock-pie {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 3px solid var(--mi-orange, #ff6700);
  border-right-color: transparent;
}

.mock-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}

.mock-grid-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.mock-icon-sq {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.3);
}

/* 模块卡片 */
.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-card {
  background: var(--mi-card-bg);
  border: 1px solid var(--mi-border);
  border-radius: 14px;
  padding: 16px;
}

.section-card-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.title-with-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  color: var(--mi-text-main);
}

.badge-sub {
  font-size: 11px;
  font-weight: normal;
  color: var(--mi-text-sub);
}

.section-lead-text {
  font-size: 12px;
  color: var(--mi-text-sub);
  margin: 0 0 14px;
  line-height: 1.5;
}

/* 颜色模式选择卡 */
.mode-cards-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.mode-card {
  background: var(--mi-card-sub-bg);
  border: 2px solid var(--mi-border);
  border-radius: 12px;
  padding: 10px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mode-card:hover {
  border-color: var(--mi-orange);
  transform: translateY(-2px);
}

.mode-card.active {
  border-color: var(--mi-orange);
  background: var(--mi-accent-soft);
  box-shadow: 0 4px 14px rgba(255, 103, 0, 0.12);
}

.mode-card-preview {
  height: 48px;
  border-radius: 8px;
  border: 1px solid var(--mi-control-sub-bg);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.light-pv {
  background: #ffffff;
}

.light-pv .pv-bar {
  width: 40%;
  height: 5px;
  background: #cbd5e1;
  border-radius: 3px;
}

.light-pv .pv-box {
  width: 100%;
  flex: 1;
  background: #f1f5f9;
  border-radius: 4px;
}

.dark-pv {
  background: #0b0f19;
  border-color: #1e293b;
}

.dark-pv .pv-bar {
  width: 40%;
  height: 5px;
  background: #475569;
  border-radius: 3px;
}

.dark-pv .pv-box {
  width: 100%;
  flex: 1;
  background: #1e293b;
  border-radius: 4px;
}

.auto-pv {
  display: flex;
  flex-direction: row;
  padding: 0;
  overflow: hidden;
}

.pv-half-light {
  flex: 1;
  background: #f8fafc;
}

.pv-half-dark {
  flex: 1;
  background: #0f172a;
}

.mode-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mode-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--mi-text-main);
}

.mode-desc {
  font-size: 11px;
  color: var(--mi-text-sub);
}

/* 预设风格瀑布流 */
.presets-flow-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.preset-item-card {
  border: 2px solid var(--mi-border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--mi-card-bg);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
}

.preset-item-card:hover {
  border-color: var(--mi-orange);
  transform: translateY(-2px);
}

.preset-item-card.active {
  border-color: var(--mi-orange);
  box-shadow: 0 6px 20px rgba(255, 103, 0, 0.15);
}

.preset-banner {
  height: 48px;
  padding: 8px 10px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  position: relative;
}

.banner-default {
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
}

.banner-mica {
  background: linear-gradient(135deg, #0284c7 0%, #38bdf8 100%);
}

.banner-aurora {
  background: linear-gradient(135deg, #7c3aed 0%, #ec4899 50%, #3b82f6 100%);
}

.banner-cyberpunk {
  background: linear-gradient(135deg, #09090b 0%, #e11d48 70%, #06b6d4 100%);
}

.banner-constructivism {
  background: repeating-linear-gradient(45deg, #111111, #111111 8px, #d92027 8px, #d92027 16px);
}

.preset-tag-pill {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.5);
  color: #ffffff;
  font-weight: 600;
  backdrop-filter: blur(4px);
}

.banner-accent-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid white;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

.preset-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preset-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.preset-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--mi-text-main);
}

.using-badge {
  font-size: 10px;
  color: var(--mi-orange);
  background: var(--mi-accent-soft);
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.preset-expl {
  font-size: 11px;
  color: var(--mi-text-sub);
  margin: 0;
  line-height: 1.4;
}

/* 强调色板 */
.color-picker-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-hex-label {
  font-size: 12px;
  font-family: monospace;
  color: var(--mi-text-sub);
}

.native-color-picker {
  -webkit-appearance: none;
  appearance: none;
  border: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  cursor: pointer;
  background: none;
  padding: 0;
}

.native-color-picker::-webkit-color-swatch-wrapper {
  padding: 0;
}

.native-color-picker::-webkit-color-swatch {
  border: 2px solid var(--mi-border);
  border-radius: 50%;
}

.palette-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.palette-swatch {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.palette-swatch:hover {
  transform: scale(1.15);
}

.palette-swatch.active {
  border-color: #ffffff;
  box-shadow: 0 0 0 2px var(--mi-orange, #ff6700);
}

.check-mark {
  color: #ffffff;
  font-size: 14px;
  font-weight: bold;
}

/* 预设壁纸网格 */
.preset-wallpapers-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.wallpaper-item {
  height: 64px;
  border-radius: 10px;
  position: relative;
  cursor: pointer;
  border: 2px solid transparent;
  padding: 8px;
  display: flex;
  align-items: flex-end;
  transition: all 0.2s;
  overflow: hidden;
}

.wallpaper-item:hover {
  transform: translateY(-2px);
}

.wallpaper-item.active {
  border-color: var(--mi-orange, #ff6700);
  box-shadow: 0 4px 14px rgba(255, 103, 0, 0.2);
}

.wallpaper-name {
  font-size: 11px;
  font-weight: 700;
  color: #ffffff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}

.wallpaper-active-icon {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--mi-orange);
  color: var(--mi-on-accent);
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
}

/* 本地壁纸上传区 */
.upload-area-box {
  background: var(--mi-card-sub-bg);
  border: 1px dashed var(--mi-border);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s;
}

.upload-dropzone {
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  text-align: center;
}

.upload-dropzone:hover {
  background: rgba(255, 103, 0, 0.04);
}

.dropzone-icon {
  font-size: 28px;
}

.dropzone-text strong {
  display: block;
  font-size: 13px;
  color: var(--mi-text-main);
  margin-bottom: 2px;
}

.dropzone-text span {
  font-size: 11px;
  color: var(--mi-text-sub);
}

.active-wallpaper-preview {
  display: flex;
  gap: 14px;
  padding: 14px;
  align-items: center;
}

.thumb-img {
  width: 90px;
  height: 60px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--mi-border);
}

.thumb-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.thumb-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mi-status-green);
}

.thumb-status strong {
  font-size: 13px;
  color: var(--mi-text-main);
}

.thumb-tip {
  margin: 0;
  font-size: 11px;
  color: var(--mi-text-sub);
}

.thumb-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.small-action-btn {
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 6px;
  border: 1px solid var(--mi-border);
  background: var(--mi-card-bg);
  color: var(--mi-text-main);
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

.small-action-btn:hover {
  background: var(--mi-control-sub-bg);
}

.small-action-btn.danger {
  color: var(--mi-status-red);
}

.small-action-btn.danger:hover {
  background: var(--mi-status-red-soft);
  border-color: var(--mi-status-red);
}

/* 磨砂范围单选框 */
.scope-options-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.scope-card {
  background: var(--mi-card-sub-bg);
  border: 2px solid var(--mi-border);
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.scope-card:hover {
  border-color: var(--mi-orange);
}

.scope-card.active {
  border-color: var(--mi-orange);
  background: var(--mi-accent-soft);
}

.scope-radio-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.scope-radio-row strong {
  font-size: 13px;
  color: var(--mi-text-main);
}

.scope-desc {
  font-size: 11px;
  color: var(--mi-text-sub);
  margin: 0;
  line-height: 1.4;
}

/* 现代滑块组件 */
.slider-box-wrapper {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 14px;
}

.slider-row-modern {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slider-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.s-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--mi-text-main);
}

.s-val {
  font-size: 12px;
  font-family: monospace;
  color: var(--mi-orange);
  font-weight: 600;
}

.modern-range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: var(--mi-control-sub-bg);
  outline: none;
  cursor: pointer;
}

.modern-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--mi-orange);
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(255, 103, 0, 0.3);
  transition: all 0.15s;
}

.modern-range::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

/* 备份与导入卡片 */
.backup-actions-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.backup-action-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--mi-card-sub-bg);
  border: 1px solid var(--mi-border);
  cursor: pointer;
  transition: all 0.2s;
}

.backup-action-card:hover:not(.disabled) {
  border-color: var(--mi-orange);
  background: var(--mi-accent-soft);
}

.backup-action-card.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-card-icon {
  font-size: 24px;
}

.action-card-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.action-card-info strong {
  font-size: 13px;
  color: var(--mi-text-main);
}

.action-card-info span {
  font-size: 11px;
  color: var(--mi-text-sub);
}

.pill-btn {
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 8px;
  border: 1px solid var(--mi-border);
  background: var(--mi-card-bg);
  color: var(--mi-text-main);
  cursor: pointer;
  transition: all 0.2s;
}

.pill-btn.primary {
  background: var(--mi-orange);
  color: var(--mi-on-accent);
  border-color: var(--mi-orange);
}

.notice-banner {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 12px;
  background: var(--mi-status-green-soft);
  color: var(--mi-status-green);
  font-weight: 600;
  border: 1px solid var(--mi-status-green-soft);
}

.notice-banner.error {
  background: var(--mi-status-red-soft);
  color: var(--mi-status-red);
  border-color: var(--mi-status-red-soft);
}

/* 底部操作条 */
.modal-ftr-v2 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  background: var(--mi-card-sub-bg);
  border-top: 1px solid var(--mi-border);
}

.ftr-left-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--mi-text-sub);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mi-orange);
}

.ftr-right-buttons {
  display: flex;
  gap: 10px;
}

.btn-ghost {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--mi-border);
  background: var(--mi-card-bg);
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-text-main);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-ghost:hover {
  background: var(--mi-control-sub-bg);
}

.btn-primary {
  padding: 8px 18px;
  border-radius: 8px;
  border: none;
  background: var(--mi-orange);
  color: var(--mi-on-accent);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(255, 103, 0, 0.25);
}

.btn-primary:hover {
  background: var(--mi-orange-hover);
  color: var(--mi-on-accent);
  transform: translateY(-1px);
}
</style>
