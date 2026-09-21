<template>
  <div v-if="visible" class="doc-backdrop" @click.self="$emit('close')">
    <div class="doc-container mi-surface">
      <!-- 顶部控制条 -->
      <div class="doc-header">
        <div class="doc-meta">
          <span class="file-icon">{{ getFileTypeIcon() }}</span>
          <span class="file-name" :title="file?.name">{{ file?.name }}</span>
          <span v-if="file?.size" class="size-badge">{{ formatSize(file.size) }}</span>
        </div>

        <div class="header-actions">
          <a :href="fileStreamUrl" :download="file?.name" class="action-btn download-btn" title="下载原文件">
            📥 下载
          </a>
          <button class="close-x" @click="$emit('close')">✕</button>
        </div>
      </div>

      <!-- 预览核心展示区 -->
      <div class="doc-body">
        <!-- 1. PDF 预览 (内存安全 Blob 沙箱直显，阻断浏览器跨域/未知流下载触发) -->
        <div v-if="docCategory === 'pdf'" class="body-frame-box">
          <div v-if="loadingPdf" class="pdf-loading-box">
            <span class="loading-spin">⚡</span>
            <span>正在准备 PDF 安全流预览，请稍候...</span>
          </div>
          <div v-else-if="pdfError" class="pdf-error-box">
            <span class="err-icon">⚠️</span>
            <p>{{ pdfError }}</p>
            <a :href="fileStreamUrl" :download="file?.name" class="download-large-btn">下载后本地查看</a>
          </div>
          <iframe 
            v-else-if="pdfBlobUrl" 
            :src="pdfBlobUrl" 
            class="pdf-frame" 
            frameborder="0"
          ></iframe>
        </div>

        <!-- 2. 文本 / 代码 / Markdown 预览 -->
        <div v-else-if="docCategory === 'text'" class="body-text-box">
          <div v-if="loadingText" class="text-loading">正在拉取文本内容...</div>
          <div v-else-if="textError" class="text-error">{{ textError }}</div>
          <pre v-else class="text-code-view"><code>{{ textContent }}</code></pre>
        </div>

        <!-- 3. 音频音乐播放器 -->
        <div v-else-if="docCategory === 'audio'" class="body-audio-box">
          <div class="audio-disc">
            <span class="music-note">🎵</span>
          </div>
          <div class="audio-info">
            <h4>{{ file?.name }}</h4>
            <p>音频流直连播放 · 支持 MP3 / FLAC / WAV</p>
          </div>
          <audio :src="fileStreamUrl" controls autoplay class="audio-player"></audio>
        </div>

        <!-- 4. 其他不支持在线预览的二进制文件 (APK, ZIP 等) -->
        <div v-else class="body-unknown-box">
          <span class="unknown-icon">📦</span>
          <h3>该文件格式暂不支持直接在线解析</h3>
          <p>{{ file?.name }} · {{ formatSize(file?.size) }}</p>
          <a :href="fileStreamUrl" :download="file?.name" class="download-large-btn">
            直接下载到本地查看
          </a>
        </div>
      </div>

      <!-- 底部路径说明栏 -->
      <div class="doc-footer">
        <span>存储物理路径: <code class="code-path">{{ mask(file?.path, 'path') }}</code></span>
        <span>NAS Range 流直连</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { maskValue } from '../utils/privacy.js';

function mask(v, kind) {
  return maskValue(v, kind);
}

const props = defineProps({
  visible: { type: Boolean, default: false },
  file: { type: Object, default: null }
});

defineEmits(['close']);

const textContent = ref('');
const loadingText = ref(false);
const textError = ref('');

// PDF 专属状态：拉入内存生成 blob: 协议本地沙箱 URL，
// Chrome/Edge/Firefox 会直接调用无损查看器，彻底阻断远程下载拦截
const pdfBlobUrl = ref('');
const loadingPdf = ref(false);
const pdfError = ref('');

async function loadPdfBlob() {
  if (!props.file?.path) return;
  loadingPdf.value = true;
  pdfError.value = '';
  if (pdfBlobUrl.value) {
    URL.revokeObjectURL(pdfBlobUrl.value);
    pdfBlobUrl.value = '';
  }
  try {
    const res = await fetch(fileStreamUrl.value);
    if (!res.ok) throw new Error(`HTTP ${res.status}: 拉取 PDF 失败`);
    const blob = await res.blob();
    // 强制声明为 application/pdf 类型
    const pdfBlob = new Blob([blob], { type: 'application/pdf' });
    pdfBlobUrl.value = URL.createObjectURL(pdfBlob);
  } catch (e) {
    console.error('PDF Blob 加载失败:', e);
    pdfError.value = '在线解析失败：' + (e.message || '网络异常');
  } finally {
    loadingPdf.value = false;
  }
}

const fileStreamUrl = computed(() => {
  if (!props.file?.path) return '';
  return `/api/stream?path=${encodeURIComponent(props.file.path)}`;
});

const docCategory = computed(() => {
  const name = (props.file?.name || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (/\.(txt|md|json|js|ts|py|sh|bat|yaml|yml|xml|html|css|ini|log|conf)$/i.test(name)) return 'text';
  if (/\.(mp3|flac|wav|aac|m4a|ogg)$/i.test(name)) return 'audio';
  return 'unknown';
});

function getFileTypeIcon() {
  const cat = docCategory.value;
  if (cat === 'pdf') return '📕';
  if (cat === 'text') return '📄';
  if (cat === 'audio') return '🎵';
  return '📦';
}

function formatSize(bytes) {
  const b = parseInt(bytes, 10);
  if (!b) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

// 自动加载纯文本内容
async function fetchText() {
  if (docCategory.value !== 'text' || !props.file?.path) return;
  loadingText.value = true;
  textError.value = '';
  textContent.value = '';
  try {
    const res = await fetch(fileStreamUrl.value);
    if (!res.ok) throw new Error('拉取文本失败 HTTP ' + res.status);
    const txt = await res.text();
    textContent.value = txt;
  } catch (e) {
    textError.value = e.message;
  } finally {
    loadingText.value = false;
  }
}

watch(() => props.visible, (val) => {
  if (val) {
    if (docCategory.value === 'text') {
      fetchText();
    } else if (docCategory.value === 'pdf') {
      loadPdfBlob();
    }
  } else {
    if (pdfBlobUrl.value) {
      URL.revokeObjectURL(pdfBlobUrl.value);
      pdfBlobUrl.value = '';
    }
  }
});
</script>

<style scoped>
.doc-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1350;
  animation: fadeIn 0.2s ease-out;
}

.doc-container {
  width: 86vw;
  max-width: 1100px;
  height: 85vh;
  background: var(--mi-card-bg);
  border-radius: var(--mi-radius-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.4);
  border: 1px solid var(--mi-border);
}

.doc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 24px;
  border-bottom: 1px solid var(--mi-border);
  background: var(--mi-card-sub-bg);
}

.doc-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.file-icon {
  font-size: 20px;
}

.file-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--mi-text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 600px;
}

.size-badge {
  font-size: 11px;
  background: var(--mi-control-sub-bg);
  color: var(--mi-text-sub);
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.download-btn {
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-orange);
  text-decoration: none;
  background: var(--mi-accent-soft);
  padding: 5px 12px;
  border-radius: 6px;
  transition: all 0.15s;
}

.download-btn:hover {
  background: var(--mi-accent-soft);
}

.close-x {
  font-size: 18px;
  color: var(--mi-text-sub);
  padding: 4px;
}

.close-x:hover {
  color: var(--mi-text-main);
}

.doc-body {
  flex: 1;
  overflow: hidden;
  background: var(--mi-card-bg);
  display: flex;
}

.body-frame-box {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #525659;
}

.pdf-loading-box, .pdf-error-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--mi-text-main);
  font-size: 13px;
}

.loading-spin {
  font-size: 28px;
  animation: pulse 1.2s infinite ease-in-out;
}

.err-icon {
  font-size: 32px;
}

.pdf-frame {
  width: 100%;
  height: 100%;
  background: var(--mi-card-bg);
}

.body-text-box {
  width: 100%;
  height: 100%;
  background: var(--mi-card-sub-bg);
  overflow: auto;
  padding: 24px 32px;
}

.text-code-view {
  font-family: Consolas, Monaco, "Courier New", monospace;
  font-size: 13px;
  color: var(--mi-text-main);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.text-loading, .text-error {
  color: var(--mi-text-sub);
  padding: 40px;
  text-align: center;
}

/* 音频播放 */
.body-audio-box {
  width: 100%;
  height: 100%;
  background: var(--mi-card-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.audio-disc {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: linear-gradient(135deg, #38bdf8, #0284c7);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 25px rgba(2, 132, 199, 0.3);
}

.music-note {
  font-size: 48px;
}

.audio-info {
  text-align: center;
}

.audio-info h4 {
  font-size: 16px;
  color: var(--mi-text-main);
  margin-bottom: 6px;
}

.audio-info p {
  font-size: 12px;
  color: var(--mi-text-sub);
}

.audio-player {
  width: 480px;
  max-width: 90%;
}

/* 未知格式卡片 */
.body-unknown-box {
  width: 100%;
  height: 100%;
  background: var(--mi-card-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.unknown-icon {
  font-size: 54px;
}

.body-unknown-box h3 {
  font-size: 16px;
  color: var(--mi-text-main);
}

.body-unknown-box p {
  font-size: 13px;
  color: var(--mi-text-sub);
}

.download-large-btn {
  margin-top: 10px;
  background: var(--mi-orange);
  color: var(--mi-on-accent);
  padding: 10px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  box-shadow: 0 4px 14px rgba(255, 103, 0, 0.3);
}

.doc-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 24px;
  background: var(--mi-card-sub-bg);
  border-top: 1px solid var(--mi-border);
  font-size: 11px;
  color: var(--mi-text-sub);
}

.code-path {
  font-family: monospace;
  background: var(--mi-control-sub-bg);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--mi-text-main);
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}
</style>
