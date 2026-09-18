<template>
  <div class="app-grid-section">
    <div class="section-title">
      <div class="title-left">
        <h3>功能中心与小程序</h3>
        <span class="count-tag">{{ apps.length }} 个应用</span>
      </div>
      <div class="category-pills">
        <span class="pill-badge active">全部应用</span>
      </div>
    </div>

    <div class="grid-container">
      <div
        v-for="app in apps"
        :key="app.id"
        class="app-card"
        @click="handleAppClick(app)"
      >
        <div class="icon-wrapper">
          <!-- 优先加载代理与已缓存的原厂图标，失败时无缝切换为米家高保真矢量 Emoji 图标 -->
          <img
            v-if="app.iconUrl"
            :src="app.iconUrl"
            :alt="app.name"
            class="app-img"
            @error="app.iconUrl = null"
          />
          <span v-else class="fallback-emoji">{{ getFallbackEmoji(app.name) }}</span>
        </div>
        <span class="app-label">{{ app.name }}</span>
        <span v-if="app.plugin === 'mediacenter'" class="badge web">Web原生</span>
        <span v-else-if="app.installed" class="badge running">已启用</span>
        <span v-else class="badge uninstalled">可安装</span>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  apps: { type: Array, default: () => [] }
});

const emit = defineEmits(['launch-app']);

function getFallbackEmoji(name) {
  const map = {
    '相册': '🖼️',
    '文件': '📁',
    '影视': '🎬',
    '任务中心': '⚡',
    '系统设置': '⚙️',
    '用户管理': '👥',
    '保险箱': '🔐',
    '网络邻居': '🌐',
    '回收站': '🗑️',
    '迅雷': '⚡',
    '百度网盘': '☁️',
    '容器魔方': '🐳'
  };
  return map[name] || '📦';
}

function handleAppClick(app) {
  emit('launch-app', app);
}
</script>

<style scoped>
.app-grid-section {
  background: var(--mi-card-bg);
  border-radius: var(--mi-radius-lg);
  padding: 24px;
  box-shadow: var(--mi-shadow);
  border: 1px solid var(--mi-border);
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.title-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title-left h3 {
  font-size: 16px;
  font-weight: 700;
  color: var(--mi-text-main);
}

.count-tag {
  font-size: 12px;
  color: var(--mi-text-sub);
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 10px;
}

.category-pills .pill-badge {
  font-size: 12px;
  color: var(--mi-orange);
  background: #fff7ed;
  padding: 4px 12px;
  border-radius: 12px;
  font-weight: 600;
}

.grid-container {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 16px;
}

.app-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 8px;
  border-radius: var(--mi-radius-md);
  background: #fcfdfe;
  border: 1px solid transparent;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
  position: relative;
}

.app-card:hover {
  background: #ffffff;
  border-color: var(--mi-border);
  box-shadow: var(--mi-shadow-hover);
  transform: translateY(-2px);
}

.icon-wrapper {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}

.app-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fallback-emoji {
  font-size: 26px;
}

.app-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-text-main);
  text-align: center;
  margin-bottom: 4px;
}

.badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 500;
}

.badge.web {
  background: #eff6ff;
  color: #2563eb;
}

.badge.running {
  background: #ecfdf5;
  color: #059669;
}

.badge.uninstalled {
  background: #f1f5f9;
  color: #94a3b8;
}

@media (max-width: 1024px) {
  .grid-container {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>
