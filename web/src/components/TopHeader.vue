<template>
  <header class="top-header">
    <div class="header-left">
      <div class="logo-box">
        <svg viewBox="0 0 100 100" class="mi-icon">
          <rect width="100" height="100" rx="25" fill="#ff6700"/>
          <path d="M28 32 H72 V48 H58 V68 H42 V48 H28 Z" fill="white"/>
        </svg>
      </div>
      <div class="device-meta">
        <div class="title-row">
          <h1 class="device-name">{{ deviceName }}</h1>
          <span class="online-badge" :class="{ online: isOnline }">
            <span class="pulse-dot"></span>
            {{ isOnline ? '在线' : '离线' }}
          </span>
        </div>
        <p class="did-info">DID: {{ did || '正在探测设备...' }} · 穿透模式</p>
      </div>
    </div>

    <div class="header-right">
      <!-- 显式的 OpenList 文件中心快捷按钮 -->
      <button class="openlist-nav-btn" @click="$emit('open-explorer')">
        <span class="btn-icon">📁</span>
        <span>OpenList 文件中心</span>
      </button>

      <div class="stat-pill" v-if="urlPort">
        <span class="label">内网映射</span>
        <span class="val">127.0.0.1:{{ urlPort }}</span>
      </div>
      <button class="refresh-btn" @click="$emit('refresh')" :disabled="loading">
        <svg :class="{ spinning: loading }" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 4v6h-6M1 20v-6h6M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
        </svg>
      </button>
    </div>
  </header>
</template>

<script setup>
defineProps({
  deviceName: { type: String, default: '小米智能存储' },
  isOnline: { type: Boolean, default: false },
  did: { type: String, default: '' },
  urlPort: { type: Number, default: 0 },
  loading: { type: Boolean, default: false }
});

defineEmits(['refresh', 'open-explorer']);
</script>

<style scoped>
.openlist-nav-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, #ff6700, #ff8533);
  color: #ffffff;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(255, 103, 0, 0.25);
  transition: all 0.2s;
}

.openlist-nav-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(255, 103, 0, 0.35);
}

.btn-icon {
  font-size: 15px;
}
.top-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 32px;
  background: #ffffff;
  border-bottom: 1px solid var(--mi-border);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.logo-box {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mi-icon {
  width: 100%;
  height: 100%;
  border-radius: 12px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.device-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--mi-text-main);
  letter-spacing: -0.3px;
}

.online-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  background: #f0f2f5;
  color: var(--mi-text-sub);
}

.online-badge.online {
  background: #e8f8f0;
  color: #10b981;
}

.pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #cbd5e1;
}

.online-badge.online .pulse-dot {
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
}

.did-info {
  font-size: 13px;
  color: var(--mi-text-sub);
  margin-top: 2px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stat-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f5f6f8;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
}

.stat-pill .label {
  color: var(--mi-text-sub);
}

.stat-pill .val {
  font-family: monospace;
  font-weight: 600;
  color: var(--mi-text-main);
}

.refresh-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #f5f6f8;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--mi-text-main);
  transition: all 0.2s;
}

.refresh-btn:hover {
  background: #eaedf1;
  color: var(--mi-orange);
}

.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .top-header {
    padding: 16px;
  }
  .stat-pill {
    display: none;
  }
}
</style>
