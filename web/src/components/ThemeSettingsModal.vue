<template>
  <div v-if="visible" class="modal-backdrop" @click.self="$emit('close')">
    <div class="custom-modal theme-modal">
      <div class="modal-hdr">
        <div class="modal-hdr-title">
          <span class="hdr-icon">🎨</span>
          <h4>个性化与视觉风格定制</h4>
        </div>
        <button class="close-x" @click="$emit('close')">✕</button>
      </div>

      <div class="modal-cnt theme-content">
        <!-- 预设选择器 -->
        <div class="section-box">
          <div class="section-title">
            <span>✨ 预设视觉风格</span>
            <span class="section-tag">快速一键切换</span>
          </div>
          <div class="presets-grid">
            <button
              v-for="(p, key) in PRESETS"
              :key="key"
              class="preset-card"
              :class="{ active: currentTheme.id === p.id }"
              @click="applyPreset(key)"
            >
              <div class="preset-name">{{ p.name }}</div>
              <div class="preset-desc">{{ p.description }}</div>
              <div class="preset-badge" v-if="currentTheme.id === p.id">当前使用</div>
            </button>
          </div>
        </div>

        <!-- 自定义壁纸 -->
        <div class="section-box">
          <div class="section-title">
            <span>🖼️ 本地背景图片 (纯客户端本地保存，不写入NAS)</span>
          </div>

          <div class="bg-upload-row">
            <input
              type="file"
              ref="fileInputRef"
              accept="image/*"
              style="display: none"
              @change="handleImageSelect"
            />
            <button class="action-btn" @click="triggerUpload">
              <span>📁 选择本地图片</span>
            </button>
            <button v-if="currentWallpaperUrl" class="action-btn danger" @click="handleClearBg">
              <span>🗑️ 清除背景</span>
            </button>
            <span v-if="currentWallpaperUrl" class="bg-status-text">✓ 已加载本地专属壁纸</span>
            <span v-else class="bg-status-text text-muted">当前使用系统纯色背景</span>
          </div>

          <!-- 壁纸滤镜控制 -->
          <div v-if="currentWallpaperUrl || currentTheme.bgEnabled" class="slider-group">
            <div class="slider-row">
              <span class="slider-label">背景亮度</span>
              <input
                type="range"
                min="20"
                max="150"
                v-model.number="currentTheme.bgBrightness"
                @input="updateStyles"
              />
              <span class="slider-val">{{ currentTheme.bgBrightness }}%</span>
            </div>

            <div class="slider-row">
              <span class="slider-label">背景模糊</span>
              <input
                type="range"
                min="0"
                max="30"
                v-model.number="currentTheme.bgBlur"
                @input="updateStyles"
              />
              <span class="slider-val">{{ currentTheme.bgBlur }}px</span>
            </div>

            <div class="slider-row">
              <span class="slider-label">背景不透明度</span>
              <input
                type="range"
                min="20"
                max="100"
                v-model.number="currentTheme.bgOpacity"
                @input="updateStyles"
              />
              <span class="slider-val">{{ currentTheme.bgOpacity }}%</span>
            </div>
          </div>
        </div>

        <!-- 亚克力 / 云母磨砂半透明质感 -->
        <div class="section-box">
          <div class="section-title">
            <span>💎 云母与磨砂质感 (Mica & Glassmorphism)</span>
            <span class="section-tag">半透明与毛玻璃</span>
          </div>

          <div class="slider-group">
            <div class="slider-row">
              <span class="slider-label">卡片半透明度</span>
              <input
                type="range"
                min="30"
                max="100"
                v-model.number="currentTheme.cardOpacity"
                @input="updateStyles"
              />
              <span class="slider-val">{{ currentTheme.cardOpacity }}%</span>
            </div>

            <div class="slider-row">
              <span class="slider-label">磨砂模糊半径</span>
              <input
                type="range"
                min="0"
                max="30"
                v-model.number="currentTheme.cardBlur"
                @input="updateStyles"
              />
              <span class="slider-val">{{ currentTheme.cardBlur }}px</span>
            </div>

            <div class="slider-row">
              <span class="slider-label">饱和度增强</span>
              <input
                type="range"
                min="100"
                max="250"
                v-model.number="currentTheme.cardSaturate"
                @input="updateStyles"
              />
              <span class="slider-val">{{ currentTheme.cardSaturate }}%</span>
            </div>
          </div>
        </div>

        <!-- 导入与导出主题 -->
        <div class="section-box">
          <div class="section-title">
            <span>💾 主题方案分享与备份 (JSON 格式)</span>
          </div>
          <div class="io-actions-row">
            <button class="io-btn" @click="handleExport(false)">
              <span>📤 导出主题配置 (.json)</span>
            </button>
            <button v-if="currentWallpaperUrl" class="io-btn" @click="handleExport(true)">
              <span>📦 导出包含壁纸的完整包</span>
            </button>
            <label class="io-btn">
              <span>📥 导入主题配置</span>
              <input
                type="file"
                accept=".json"
                style="display: none"
                @change="handleImportFile"
              />
            </label>
          </div>
          <p v-if="importNotice" class="import-msg" :class="{ error: importNoticeError }">
            {{ importNotice }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import {
  PRESETS,
  currentTheme,
  currentWallpaperUrl,
  applyTheme,
  saveThemeConfig,
  saveWallpaper,
  clearWallpaper,
  switchPreset,
  exportThemeJSON,
  importThemeJSON
} from '../utils/theme.js';

defineProps({
  visible: { type: Boolean, default: false }
});

defineEmits(['close']);

const fileInputRef = ref(null);
const importNotice = ref('');
const importNoticeError = ref(false);

function triggerUpload() {
  fileInputRef.value?.click();
}

// 选择本地图片
async function handleImageSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const dataUrl = ev.target?.result;
      if (dataUrl) {
        await saveWallpaper(dataUrl);
      }
    } catch (err) {
      alert('保存本地壁纸失败: ' + err.message);
    }
  };
  reader.readAsDataURL(file);
}

// 清除背景
async function handleClearBg() {
  await clearWallpaper();
}

// 切换预设
function applyPreset(key) {
  switchPreset(key);
}

// 手动滑动滑块微调
function updateStyles() {
  currentTheme.id = 'custom';
  applyTheme();
  saveThemeConfig();
}

// 导出配置
function handleExport(includeBg) {
  exportThemeJSON(includeBg);
}

// 导入配置
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
.theme-modal {
  width: 620px;
  max-width: 95vw;
}

.theme-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-height: 75vh;
}

.section-box {
  background: rgba(248, 250, 252, 0.7);
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-md);
  padding: 16px;
  backdrop-filter: blur(8px);
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: 700;
  color: var(--mi-text-main);
  margin-bottom: 12px;
}

.section-tag {
  font-size: 11px;
  font-weight: normal;
  color: var(--mi-text-sub);
}

/* 预设卡片网格 */
.presets-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.preset-card {
  position: relative;
  text-align: left;
  background: white;
  border: 2px solid var(--mi-border);
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
  overflow: hidden;
}

.preset-card:hover {
  border-color: var(--mi-orange);
  transform: translateY(-2px);
}

.preset-card.active {
  border-color: var(--mi-orange);
  background: rgba(255, 103, 0, 0.04);
  box-shadow: 0 4px 16px rgba(255, 103, 0, 0.15);
}

.preset-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--mi-text-main);
  margin-bottom: 4px;
}

.preset-desc {
  font-size: 11px;
  color: var(--mi-text-sub);
  line-height: 1.4;
}

.preset-badge {
  position: absolute;
  top: 0;
  right: 0;
  background: var(--mi-orange);
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-bottom-left-radius: 8px;
}

/* 上传行 */
.bg-upload-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #ffffff;
  border: 1px solid var(--mi-border);
  color: var(--mi-text-main);
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.action-btn:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.action-btn.danger {
  color: #ef4444;
}

.action-btn.danger:hover {
  background: #fee2e2;
  border-color: #fca5a5;
}

.bg-status-text {
  font-size: 12px;
  color: #10b981;
  font-weight: 600;
}

.text-muted {
  color: var(--mi-text-sub);
  font-weight: normal;
}

/* 滑块组 */
.slider-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}

.slider-row {
  display: grid;
  grid-template-columns: 100px 1fr 50px;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.slider-label {
  color: var(--mi-text-main);
  font-weight: 600;
}

.slider-row input[type="range"] {
  accent-color: var(--mi-orange);
  cursor: pointer;
}

.slider-val {
  font-family: monospace;
  color: var(--mi-text-sub);
  text-align: right;
}

/* 导入导出 */
.io-actions-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.io-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: white;
  border: 1px solid var(--mi-border);
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  color: var(--mi-text-main);
}

.io-btn:hover {
  background: #f8fafc;
  border-color: var(--mi-orange);
}

.import-msg {
  margin-top: 10px;
  font-size: 12px;
  color: #10b981;
  font-weight: 600;
}

.import-msg.error {
  color: #ef4444;
}
</style>
