<template>
  <div class="app-grid-section mi-surface" style="--mi-surface-label: '№ 03'">
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
        v-for="(app, idx) in apps"
        :key="app.id"
        class="app-card"
        :style="{ '--i': idx }"
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
  background: var(--mi-control-sub-bg);
  padding: 2px 8px;
  border-radius: 10px;
}

.category-pills .pill-badge {
  font-size: 12px;
  color: var(--mi-accent-text-on-soft);
  background: var(--mi-accent-soft);
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
  background: var(--mi-card-sub-bg);
  border: 1px solid var(--mi-border, transparent);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
  position: relative;
  /* 九宫格逐格淡入上浮；延迟由模板注入的 --i 决定。
     用 backwards：both 会让结束帧的 transform 常驻，把 .app-card:hover
     的 translateY(-2px) 顶掉，卡片就没有悬停反馈了。 */
  animation: miRiseIn var(--mi-dur-slow) var(--mi-ease-out) backwards;
  animation-delay: calc(var(--i, 0) * 22ms);
}

.app-card:hover {
  background: var(--mi-control-bg);
  border-color: var(--mi-orange);
  box-shadow: var(--mi-shadow-hover);
  transform: translateY(-2px);
}

.icon-wrapper {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: var(--mi-control-sub-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  border: 1px solid var(--mi-border, transparent);
  transition: all 0.2s ease;
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
  padding: 2px 8px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 0.2s ease;
}

.badge.web {
  background: rgba(37, 99, 235, 0.12);
  color: var(--mi-status-blue);
  border: 1px solid var(--mi-status-blue-soft);
}

.badge.running {
  background: var(--mi-status-green-soft);
  color: var(--mi-status-green);
  border: 1px solid var(--mi-status-green-soft);
}

.badge.uninstalled {
  background: var(--mi-control-sub-bg);
  color: var(--mi-text-sub);
  border: 1px solid var(--mi-border, transparent);
}

@media (max-width: 1024px) {
  .grid-container {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>
