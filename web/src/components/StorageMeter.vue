<template>
  <div class="storage-card">
    <div class="card-header">
      <div class="header-title">
        <span class="icon">💾</span>
        <h3>存储空间与盘位健康</h3>
      </div>
      <span class="pool-tag">{{ poolType }}</span>
    </div>

    <div class="storage-body">
      <!-- 存储容量核心数值 (精准显示已用与总容量) -->
      <div class="stat-main">
        <div class="used-val">
          <span class="num">{{ formatGB(usedBytes) }}</span>
          <span class="unit">GB</span>
        </div>
        <p class="sub-desc">
          <template v-if="totalBytes > 0">
            已用存储容量 · 格式化总可用约 {{ totalDisplay }}
            <span v-if="totalIsEstimated" class="estim-tag">总容量按机型规格推算，NAS 未上报</span>
          </template>
          <template v-else>已用存储容量 · 总容量未上报</template>
        </p>
      </div>

      <!-- 米家经典进度条 -->
      <div class="progress-container" v-if="totalBytes > 0">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: percent + '%' }"></div>
        </div>
        <div class="progress-meta">
          <span>已用 <b>{{ percent }}%</b></span>
          <span>剩余可用 <b>{{ freeDisplay }}</b></span>
        </div>
      </div>

      <!-- 盘位与阵列配置详情 -->
      <div class="details-grid">
        <div class="detail-item">
          <span class="d-label">存储池</span>
          <span class="d-val font-mono">pool0</span>
        </div>
        <div class="detail-item">
          <span class="d-label">阵列保护等级</span>
          <span class="d-val text-green">Dual-Backup (双盘镜像冗余)</span>
        </div>
        <div class="detail-item">
          <span class="d-label">文件系统</span>
          <span class="d-val font-mono">Btrfs (支持秒级快照/防腐)</span>
        </div>
        <div class="detail-item">
          <span class="d-label">盘位健康 / 温度</span>
          <span class="d-val text-muted">未上报 (LuCI 无对应接口)</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  usedBytes: { type: Number, default: 0 },
  totalBytes: { type: Number, default: 0 },
  // 总容量是否为按机型规格推算（NAS 未上报配额时）
  totalIsEstimated: { type: Boolean, default: false },
  uid: { type: String, default: '' },
  poolType: { type: String, default: '存储池 pool0 (双盘镜像)' }
});

function formatGB(bytes) {
  if (!bytes) return '0.00';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}

const percent = computed(() => {
  if (!props.totalBytes) return 0;
  const p = (props.usedBytes / props.totalBytes) * 100;
  return p < 0.1 ? '0.1' : p.toFixed(1);
});

const totalDisplay = computed(() => {
  const tb = props.totalBytes / (1024 * 1024 * 1024 * 1024);
  return `${tb.toFixed(2)} TB`;
});

const freeDisplay = computed(() => {
  const free = Math.max(0, props.totalBytes - props.usedBytes);
  const tb = free / (1024 * 1024 * 1024 * 1024);
  return `${tb.toFixed(2)} TB`;
});
</script>

<style scoped>
.storage-card {
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
  margin-bottom: 20px;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-title .icon {
  font-size: 20px;
}

.header-title h3 {
  font-size: 16px;
  font-weight: 700;
  color: var(--mi-text-main);
}

.pool-tag {
  font-size: 12px;
  color: #047857;
  background: #ecfdf5;
  padding: 4px 10px;
  border-radius: 10px;
  font-weight: 600;
}

.stat-main {
  margin-bottom: 18px;
}

.used-val {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.used-val .num {
  font-size: 38px;
  font-weight: 800;
  color: var(--mi-text-main);
  line-height: 1;
  letter-spacing: -1px;
}

.used-val .unit {
  font-size: 18px;
  font-weight: 600;
  color: var(--mi-text-sub);
}

.sub-desc {
  font-size: 13px;
  color: var(--mi-text-sub);
  margin-top: 6px;
}

.progress-container {
  margin-bottom: 24px;
}

.progress-bar {
  height: 10px;
  background: #eaedf1;
  border-radius: 5px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #ff6700 0%, #ff8533 100%);
  border-radius: 5px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

.progress-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--mi-text-sub);
}

.progress-meta b {
  color: var(--mi-text-main);
}

.details-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  background: #f8fafc;
  padding: 14px;
  border-radius: var(--mi-radius-md);
  border: 1px solid var(--mi-border);
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.d-label {
  font-size: 11px;
  color: var(--mi-text-sub);
}

.d-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--mi-text-main);
}

.text-green {
  color: #10b981;
}

.text-muted {
  color: var(--mi-text-sub);
}

.estim-tag {
  display: inline-block;
  margin-left: 6px;
  font-size: 10px;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 1px 6px;
}

.font-mono {
  font-family: monospace;
}
</style>
