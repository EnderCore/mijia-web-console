<template>
  <div class="recent-media-card">
    <div class="card-header">
      <div class="header-left">
        <span class="icon">📸</span>
        <h3>最近照片与媒体流</h3>
      </div>
      <div class="header-right">
        <span class="file-count">共 {{ filteredFiles.length }} 项</span>
      </div>
    </div>

    <!-- 过滤器切换 (全部 / 照片 / 视频 / 文件夹) -->
    <div class="filter-tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab-btn"
        :class="{ active: currentTab === t.key }"
        @click="currentTab = t.key"
      >
        {{ t.name }}
      </button>
    </div>

    <div v-if="filteredFiles.length === 0" class="empty-state">
      <p>暂无此类目文件记录</p>
    </div>

    <!-- 媒体真实缩略图瀑布流 (真图片预览 + 视频时长播放标记) -->
    <div v-else class="media-grid">
      <div
        v-for="file in filteredFiles"
        :key="file.id || file.name"
        class="media-item"
        @click="$emit('preview-media', file)"
      >
        <div class="thumb-container">
          <!-- 真实缩略图与本地缓存直显 -->
          <img
            :src="file.thumbnail"
            :alt="file.name"
            class="media-img"
            loading="lazy"
          />

          <!-- 视频专用标识与时长播放按钮 -->
          <div v-if="file.type === 'video'" class="video-overlay">
            <span class="play-icon">▶</span>
            <span v-if="file.duration" class="duration">{{ file.duration }}</span>
          </div>

          <span v-if="file.dim" class="res-tag">{{ file.dim }}</span>
        </div>

        <div class="media-info">
          <p class="file-name" :title="file.name">{{ file.name }}</p>
          <div class="file-meta">
            <span>{{ formatSize(file.size) }}</span>
            <span>·</span>
            <span>{{ formatDate(file.modified_time) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  files: { type: Array, default: () => [] }
});

defineEmits(['preview-media']);

const currentTab = ref('all');
const tabs = [
  { key: 'all', name: '全部' },
  { key: 'photo', name: '照片' },
  { key: 'video', name: '视频' },
  { key: 'doc', name: '文档与文件夹' }
];

const filteredFiles = computed(() => {
  if (currentTab.value === 'all') return props.files;
  return props.files.filter(f => f.type === currentTab.value);
});

function formatSize(bytes) {
  const b = parseInt(bytes, 10);
  if (!b) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const d = new Date(parseInt(timestamp, 10));
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${m}-${day}`;
}
</script>

<style scoped>
.recent-media-card {
  background: var(--mi-card-bg);
  border-radius: var(--mi-radius-lg);
  padding: 24px;
  box-shadow: var(--mi-shadow);
  border: 1px solid var(--mi-border);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-left .icon {
  font-size: 20px;
}

.header-left h3 {
  font-size: 16px;
  font-weight: 700;
  color: var(--mi-text-main);
}

.file-count {
  font-size: 12px;
  color: var(--mi-text-sub);
  background: #f1f5f9;
  padding: 3px 10px;
  border-radius: 12px;
}

.filter-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.tab-btn {
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-text-sub);
  background: #f5f6f8;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: #edf0f4;
  color: var(--mi-text-main);
}

.tab-btn.active {
  background: var(--mi-orange);
  color: white;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.media-item {
  border-radius: var(--mi-radius-md);
  background: #ffffff;
  border: 1px solid var(--mi-border);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.media-item:hover {
  transform: translateY(-3px);
  box-shadow: var(--mi-shadow-hover);
}

.thumb-container {
  height: 140px;
  position: relative;
  background: #e2e8f0;
  overflow: hidden;
}

.media-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s;
}

.media-item:hover .media-img {
  transform: scale(1.05);
}

.video-overlay {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  padding: 3px 8px;
  border-radius: 6px;
  color: white;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.play-icon {
  font-size: 10px;
  color: #ff6700;
}

.res-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
}

.media-info {
  padding: 10px 12px;
}

.file-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.file-meta {
  font-size: 11px;
  color: var(--mi-text-sub);
  display: flex;
  gap: 6px;
}

.empty-state {
  text-align: center;
  padding: 40px 0;
  color: var(--mi-text-sub);
  font-size: 13px;
}
</style>
