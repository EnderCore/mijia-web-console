<template>
  <header class="top-header mi-surface">
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
        <p class="did-info">DID: {{ mask(did, 'did') || '正在探测设备...' }} · 穿透模式</p>
      </div>
    </div>

    <div class="header-right">
      <!-- 隐私遮罩：截图分享前隐藏 DID / 序列号 / IP / 路径等标识 -->
      <button
        class="mask-btn"
        :class="{ active: masked }"
        :title="masked ? '当前已脱敏，点击显示真实信息' : '点击隐藏 IP / 序列号 / DID 等敏感信息'"
        @click="toggle"
      >
        <span class="btn-icon">{{ masked ? '🙈' : '👁️' }}</span>
        <span>{{ masked ? '已脱敏' : '脱敏' }}</span>
      </button>

      <!-- 文件管理器快捷入口 -->
      <button class="explorer-nav-btn" @click="$emit('open-explorer')">
        <span class="btn-icon">📁</span>
        <span>文件管理</span>
      </button>

      <!-- 个性化与视觉风格设置入口 -->
      <button class="theme-nav-btn" @click="$emit('open-theme')" title="个性化外观与主题设置">
        <span class="btn-icon">🎨</span>
        <span>外观</span>
      </button>

      <!-- 本地缓存管理入口 -->
      <button class="cache-nav-btn" @click="$emit('open-cache')" title="查看与清理浏览器本地缓存">
        <span class="btn-icon">💾</span>
        <span>缓存</span>
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
import { usePrivacy, maskValue } from '../utils/privacy.js';

defineProps({
  deviceName: { type: String, default: '小米智能存储' },
  isOnline: { type: Boolean, default: false },
  did: { type: String, default: '' },
  urlPort: { type: Number, default: 0 },
  loading: { type: Boolean, default: false }
});

defineEmits(['refresh', 'open-explorer', 'open-theme', 'open-cache']);

const { masked, toggle } = usePrivacy();

// maskValue 内部读 masked，所以模板里调用它会随开关自动重算
function mask(v, kind) {
  return maskValue(v, kind);
}
</script>

<style scoped>
.explorer-nav-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, var(--mi-orange), var(--mi-orange-hover));
  color: var(--mi-on-accent);
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(255, 103, 0, 0.25);
  transition: all 0.2s;
}

.theme-nav-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--mi-card-bg);
  border: 1px solid var(--mi-border);
  color: var(--mi-text-main);
  padding: 8px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition: all 0.2s;
}

.theme-nav-btn:hover {
  border-color: var(--mi-orange);
  color: var(--mi-orange);
  transform: translateY(-1px);
}

.cache-nav-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--mi-card-bg);
  border: 1px solid var(--mi-border);
  color: var(--mi-text-main);
  padding: 8px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition: all 0.2s;
}

.cache-nav-btn:hover {
  border-color: var(--mi-orange);
  color: var(--mi-orange);
  transform: translateY(-1px);
}

.mask-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  background: var(--mi-control-sub-bg);
  color: var(--mi-text-sub);
  border: 1px solid transparent;
  transition: all 0.2s;
}

.mask-btn:hover {
  background: var(--mi-control-bg);
  color: var(--mi-text-main);
}

/* 开启脱敏时用醒目色，避免用户忘了自己开着遮罩 */
.mask-btn.active {
  background: var(--mi-status-red-soft);
  border-color: var(--mi-status-red-soft);
  color: var(--mi-status-red);
}

.explorer-nav-btn:hover {
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
  background: var(--mi-card-bg);
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
  background: var(--mi-control-sub-bg);
  color: var(--mi-text-sub);
}

.online-badge.online {
  background: var(--mi-status-green-soft);
  color: var(--mi-status-green);
}

.pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mi-text-sub);
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
  background: var(--mi-control-sub-bg);
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
  background: var(--mi-control-sub-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--mi-text-main);
  transition: all 0.2s;
}

.refresh-btn:hover {
  background: var(--mi-control-bg);
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
