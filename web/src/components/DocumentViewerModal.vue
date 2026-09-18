<template>
  <div v-if="visible" class="doc-backdrop" @click.self="$emit('close')">
    <div class="doc-container">
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
        <!-- 1. PDF 预览 (浏览器原生无损渲染器) -->
        <div v-if="docCategory === 'pdf'" class="body-frame-box">
          <iframe :src="fileStreamUrl" class="pdf-frame" frameborder="0"></iframe>
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
        <span>存储物理路径: <code class="code-path">{{ file?.path }}</code></span>
        <span>NAS Range 流直连</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  file: { type: Object, default: null }
});

defineEmits(['close']);

const textContent = ref('');
const loadingText = ref(false);
const textError = ref('');

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
  if (val && docCategory.value === 'text') {
    fetchText();
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
  background: #ffffff;
  border-radius: var(--mi-radius-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.4);
}

.doc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 24px;
  border-bottom: 1px solid var(--mi-border);
  background: #f8fafc;
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
  background: #e2e8f0;
  color: #475569;
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
  background: #fff7ed;
  padding: 5px 12px;
  border-radius: 6px;
  transition: all 0.15s;
}

.download-btn:hover {
  background: #ffedd5;
}

.close-x {
  font-size: 18px;
  color: #94a3b8;
  padding: 4px;
}

.close-x:hover {
  color: var(--mi-text-main);
}

.doc-body {
  flex: 1;
  overflow: hidden;
  background: #f1f5f9;
  display: flex;
}

.body-frame-box {
  width: 100%;
  height: 100%;
}

.pdf-frame {
  width: 100%;
  height: 100%;
  background: #ffffff;
}

.body-text-box {
  width: 100%;
  height: 100%;
  background: #1e293b;
  overflow: auto;
  padding: 24px 32px;
}

.text-code-view {
  font-family: Consolas, Monaco, "Courier New", monospace;
  font-size: 13px;
  color: #e2e8f0;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.text-loading, .text-error {
  color: #94a3b8;
  padding: 40px;
  text-align: center;
}

/* 音频播放 */
.body-audio-box {
  width: 100%;
  height: 100%;
  background: #ffffff;
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
  background: #ffffff;
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
  color: #ffffff;
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
  background: #f8fafc;
  border-top: 1px solid var(--mi-border);
  font-size: 11px;
  color: #94a3b8;
}

.code-path {
  font-family: monospace;
  background: #e2e8f0;
  padding: 2px 6px;
  border-radius: 4px;
  color: #334155;
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}
</style>
