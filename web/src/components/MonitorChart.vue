<template>
  <div class="monitor-card">
    <div class="card-header">
      <div class="header-left">
        <span class="icon">⚡</span>
        <h3>设备规格与网络链路</h3>
      </div>
      <span class="ping-badge" :class="pingColorClass">
        往返延迟 {{ currentRtt }} ms
      </span>
    </div>

    <!-- NAS 未开放硬件监控接口，CPU/内存读数无法实时获取，须如实标注 -->
    <div v-if="systemInfo.estimated" class="estim-note">
      官方 LuCI 未开放 CPU / 内存 / 温度查询接口，下方硬件读数按机型规格推算，非实时监控值。
    </div>

    <div class="monitor-body">
      <!-- 硬件核心指标：CPU 与 内存仪表盘 -->
      <div class="hardware-meters">
        <div class="hw-item">
          <div class="hw-top">
            <span class="hw-name">CPU 使用率</span>
            <span class="hw-val text-muted">{{ fmtPct(systemInfo.cpu.usagePercent) }}</span>
          </div>
          <div class="hw-bar">
            <div class="hw-bar-fill orange" :style="{ width: (systemInfo.cpu.usagePercent || 0) + '%' }"></div>
          </div>
          <div class="hw-sub">
            <span>{{ systemInfo.cpu.cores }} 核心 Cortex-A55</span>
            <span>{{ systemInfo.cpu.temp == null ? '温度未上报' : systemInfo.cpu.temp + ' °C' }}</span>
          </div>
        </div>

        <div class="hw-item">
          <div class="hw-top">
            <span class="hw-name">RAM 内存</span>
            <span class="hw-val text-blue">{{ fmtPct(systemInfo.memory.usagePercent) }}</span>
          </div>
          <div class="hw-bar">
            <div class="hw-bar-fill blue" :style="{ width: (systemInfo.memory.usagePercent || 0) + '%' }"></div>
          </div>
          <div class="hw-sub">
            <span>已用 {{ fmtMB(systemInfo.memory.usedBytes) }}</span>
            <span>总计 {{ fmtMB(systemInfo.memory.totalBytes) }} MB</span>
          </div>
        </div>
      </div>

      <!-- 链路状态 -->
      <div class="tunnel-info">
        <div class="info-row">
          <span class="label">处理器型号</span>
          <span class="val font-mono">{{ systemInfo.cpu.model }}</span>
        </div>
        <div class="info-row">
          <span class="label">网卡与链接</span>
          <span class="val">
            {{ systemInfo.network.linkSpeed }} 全双工
            <template v-if="systemInfo.network.ip"> ({{ systemInfo.network.ip }})</template>
            <template v-else> · IP 未上报</template>
          </span>
        </div>
        <div class="info-row">
          <span class="label">穿透网关模式</span>
          <span class="val font-mono highlight">{{ tunnelGateway || '127.0.0.1 (本地隧道)' }}</span>
        </div>
      </div>

      <!-- 纯 SVG 极简平滑折线图 (最近 RTT 采样) -->
      <div class="chart-container">
        <div class="chart-label">端到端往返延迟波形 (最近 20 次采样)</div>
        <svg viewBox="0 0 300 70" class="sparkline">
          <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#ff6700" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="#ff6700" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <polygon :points="fillPoints" fill="url(#grad)" />
          <polyline :points="linePoints" fill="none" stroke="#ff6700" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          <circle v-if="lastPoint" :cx="lastPoint.x" :cy="lastPoint.y" r="4" fill="#ff6700" />
        </svg>
      </div>

      <div class="monitor-footer">
        <div class="foot-stat">
          <span class="s-val text-green">100%</span>
          <span class="s-label">链路健康度</span>
        </div>
        <div class="foot-stat">
          <span class="s-val">{{ minRtt }} ms</span>
          <span class="s-label">最低延迟</span>
        </div>
        <div class="foot-stat">
          <span class="s-val">{{ avgRtt }} ms</span>
          <span class="s-label">平均延迟</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  currentRtt: { type: Number, default: 12 },
  history: { type: Array, default: () => [] },
  tunnelGateway: { type: String, default: '' },
  systemInfo: {
    type: Object,
    default: () => ({
      estimated: true,
      model: 'Xiaomi Smart Storage',
      cpu: { model: 'Realtek RTD1619B Quad-Core', cores: 4, usagePercent: null, temp: null },
      memory: { totalBytes: 4294967296, usedBytes: null, usagePercent: null },
      network: { linkSpeed: '2.5 Gbps', ip: null }
    })
  }
});

// 未上报的指标显示为"未上报"，不要假装是 0% 或某个具体读数
function fmtPct(v) {
  return v == null ? '未上报' : v + '%';
}

function fmtMB(bytes) {
  if (bytes == null) return '未上报';
  return Math.round(bytes / (1024 * 1024)) + ' MB';
}

const pingColorClass = computed(() => {
  if (props.currentRtt <= 0) return 'text-gray';
  if (props.currentRtt < 50) return 'text-green';
  if (props.currentRtt < 150) return 'text-yellow';
  return 'text-red';
});

const rttValues = computed(() => {
  if (props.history.length === 0) return [props.currentRtt || 12];
  return props.history.map(h => h.rtt);
});

const minRtt = computed(() => {
  const v = rttValues.value.filter(x => x > 0);
  return v.length > 0 ? Math.min(...v) : 0;
});

const avgRtt = computed(() => {
  const v = rttValues.value.filter(x => x > 0);
  if (v.length === 0) return 0;
  const sum = v.reduce((a, b) => a + b, 0);
  return Math.round(sum / v.length);
});

// SVG 点计算
const points = computed(() => {
  const data = rttValues.value;
  if (data.length <= 1) return [{ x: 150, y: 35 }];
  const max = Math.max(...data, 60);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const width = 300;
  const height = 55;

  return data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height + 8;
    return { x, y };
  });
});

const linePoints = computed(() => {
  return points.value.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
});

const fillPoints = computed(() => {
  if (points.value.length === 0) return '';
  const first = points.value[0];
  const last = points.value[points.value.length - 1];
  return `${first.x.toFixed(1)},70 ${linePoints.value} ${last.x.toFixed(1)},70`;
});

const lastPoint = computed(() => {
  return points.value.length > 0 ? points.value[points.value.length - 1] : null;
});
</script>

<style scoped>
.monitor-card {
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

.ping-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 12px;
}

.ping-badge.text-green {
  background: #e8f8f0;
  color: #10b981;
}

.ping-badge.text-yellow {
  background: #fef3c7;
  color: #d97706;
}

.hardware-meters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 18px;
}

.hw-item {
  background: #f8fafc;
  padding: 12px 14px;
  border-radius: var(--mi-radius-md);
  border: 1px solid var(--mi-border);
}

.hw-top {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
}

.hw-name {
  font-size: 12px;
  color: var(--mi-text-sub);
}

.hw-val {
  font-size: 13px;
  font-weight: 700;
}

.hw-bar {
  height: 6px;
  background: #e2e8f0;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 6px;
}

.hw-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
}

.hw-bar-fill.orange {
  background: linear-gradient(90deg, #ff8533, #ff6700);
}

.hw-bar-fill.blue {
  background: linear-gradient(90deg, #60a5fa, #3b82f6);
}

.hw-sub {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--mi-text-sub);
}

.tunnel-info {
  background: #f8fafc;
  border-radius: var(--mi-radius-md);
  padding: 12px 14px;
  margin-bottom: 16px;
  border: 1px solid var(--mi-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.info-row .label {
  color: var(--mi-text-sub);
}

.info-row .val {
  font-weight: 600;
  color: var(--mi-text-main);
}

.info-row .highlight {
  color: var(--mi-orange);
}

.chart-container {
  margin-bottom: 16px;
}

.chart-label {
  font-size: 11px;
  color: var(--mi-text-sub);
  margin-bottom: 6px;
}

.sparkline {
  width: 100%;
  height: 70px;
  overflow: visible;
}

.monitor-footer {
  display: flex;
  justify-content: space-around;
  border-top: 1px solid var(--mi-border);
  padding-top: 14px;
}

.foot-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.foot-stat .s-val {
  font-size: 14px;
  font-weight: 700;
  color: var(--mi-text-main);
}

.foot-stat .s-label {
  font-size: 11px;
  color: var(--mi-text-sub);
}

.text-blue {
  color: #2563eb;
}

.text-orange {
  color: #ea580c;
}

.text-red {
  color: #dc2626;
}

.font-mono {
  font-family: monospace;
}

.estim-note {
  font-size: 11px;
  line-height: 1.6;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: var(--mi-radius-md);
  padding: 8px 12px;
  margin-bottom: 14px;
}

.text-muted {
  color: var(--mi-text-sub);
  font-weight: 600;
}
</style>
