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
            存储池已用 · 格式化总可用约 {{ totalDisplay }}
            <span v-if="personalUsedBytes" class="personal-tag">个人空间 {{ formatGB(personalUsedBytes) }} GB</span>
          </template>
          <template v-else>总容量未上报</template>
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

      <!-- 盘位与阵列配置详情（数据来自 NAS storage/get_storage_info） -->
      <div class="details-grid">
        <div class="detail-item">
          <span class="d-label">存储池</span>
          <span class="d-val font-mono">{{ poolName }}<template v-if="poolType"> ({{ poolType }})</template></span>
        </div>
        <div class="detail-item">
          <span class="d-label">阵列保护等级</span>
          <span class="d-val" :class="healthClass">{{ poolStatusText }}</span>
        </div>
        <div class="detail-item">
          <span class="d-label">文件系统</span>
          <span class="d-val font-mono">Btrfs (支持秒级快照)</span>
        </div>
        <div class="detail-item">
          <span class="d-label">磁盘数量</span>
          <span class="d-val">{{ disks.length ? disks.length + ' 块' : '未上报' }}</span>
        </div>
      </div>

      <!-- 逐块硬盘明细（真实型号/序列号/温度/健康/运行时长） -->
      <div v-if="disks.length" class="disk-list">
        <div v-for="d in disks" :key="d.dev || d.slot" class="disk-row">
          <div class="disk-head">
            <span class="disk-slot">盘位 {{ d.slot ?? '-' }}</span>
            <span class="disk-dev font-mono">{{ d.dev }}</span>
            <span class="disk-health" :class="d.health === 'normal' ? 'ok' : 'warn'">
              {{ healthText(d.health) }}
            </span>
          </div>
          <div class="disk-model font-mono" :title="d.model">{{ d.model || '型号未上报' }}</div>
          <div class="disk-meta">
            <span>{{ d.type || 'HDD' }}</span>
            <span>·</span>
            <span>{{ diskSize(d.totalBytes) }}</span>
            <span>·</span>
            <span :class="tempClass(d.temperature)">{{ d.temperature == null ? '温度未上报' : d.temperature + '°C' }}</span>
            <span v-if="d.runTimeHours != null">· 通电 {{ formatHours(d.runTimeHours) }}</span>
          </div>
          <div v-if="d.serial" class="disk-serial font-mono">S/N {{ mask(d.serial, 'serial') }}</div>
        </div>

        <!-- 官方 API 只提供上面这些字段；写明边界，避免以为是页面没做全 -->
        <p class="disk-note">
          NAS 的接口只上报磁盘型号、序列号、温度、健康状态与通电时长；
          累计写入量、SMART 属性（重映射扇区等）、UPS 电量均无对应接口，故不显示。
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { maskValue } from '../utils/privacy.js';

// 脱敏：maskValue 内部读共享的 masked 状态，开关切换时模板会自动重算
function mask(v, kind) {
  return maskValue(v, kind);
}

const props = defineProps({
  usedBytes: { type: Number, default: 0 },
  totalBytes: { type: Number, default: 0 },
  // 当前账号个人配额用量（user_list.used_size），与整池用量是两个口径
  personalUsedBytes: { type: Number, default: 0 },
  totalIsEstimated: { type: Boolean, default: false },
  uid: { type: String, default: '' },
  poolType: { type: String, default: '' },
  poolName: { type: String, default: '存储空间' },
  poolStatus: { type: String, default: '' },
  // 每块硬盘的明细，来自 storage/get_storage_info
  disks: { type: Array, default: () => [] }
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

const poolStatusText = computed(() => {
  if (!props.poolStatus) return '未上报';
  const map = { normal: '正常 (RAID 冗余保护)', degraded: '降级', rebuilding: '重建中', error: '异常' };
  return map[props.poolStatus] || props.poolStatus;
});

const healthClass = computed(() => (props.poolStatus === 'normal' ? 'text-green' : 'text-warn'));

function healthText(h) {
  const map = { normal: '健康', warning: '警告', error: '异常', abnormal: '异常' };
  return map[h] || (h || '未上报');
}

function tempClass(t) {
  if (t == null) return '';
  if (t >= 55) return 'text-warn';
  if (t >= 45) return 'text-caution';
  return 'text-green';
}

function diskSize(bytes) {
  if (!bytes) return '容量未上报';
  const tb = bytes / 1024 ** 4;
  return tb >= 1 ? `${tb.toFixed(2)} TB` : `${(bytes / 1024 ** 3).toFixed(0)} GB`;
}

function formatHours(h) {
  if (h == null) return '';
  if (h < 24) return `${h} 小时`;
  return `${Math.floor(h / 24)} 天`;
}
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

.text-warn {
  color: #dc2626;
}

.text-caution {
  color: #d97706;
}

.text-muted {
  color: var(--mi-text-sub);
}

/* 逐块硬盘明细 */
.disk-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.disk-row {
  background: #f8fafc;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-md);
  padding: 10px 12px;
}

.disk-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.disk-slot {
  font-size: 11px;
  font-weight: 700;
  color: var(--mi-orange);
}

.disk-dev {
  font-size: 11px;
  color: var(--mi-text-sub);
}

.disk-health {
  margin-left: auto;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 8px;
}

.disk-health.ok {
  color: #047857;
  background: #ecfdf5;
}

.disk-health.warn {
  color: #b91c1c;
  background: #fef2f2;
}

.disk-model {
  font-size: 12px;
  font-weight: 600;
  color: var(--mi-text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.disk-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 10px;
  color: var(--mi-text-sub);
  margin-top: 3px;
}

.disk-serial {
  font-size: 10px;
  color: var(--mi-text-sub);
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.disk-note {
  font-size: 10px;
  line-height: 1.6;
  color: var(--mi-text-sub);
  padding: 2px 2px 0;
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

.personal-tag {
  display: inline-block;
  margin-left: 6px;
  font-size: 10px;
  color: #0369a1;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 8px;
  padding: 1px 6px;
}

.font-mono {
  font-family: monospace;
}
</style>
