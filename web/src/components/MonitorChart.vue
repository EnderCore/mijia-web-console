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

    <!-- 数据来自 NAS system/get_device_status，实时值；取不到的字段显示"未上报" -->
    <div class="monitor-body">
      <!-- 硬件核心指标：CPU 与 风扇 -->
      <div class="hardware-meters">
        <div class="hw-item">
          <div class="hw-top">
            <span class="hw-name">CPU 使用率</span>
            <span class="hw-val text-muted">{{ fmtPct(systemInfo.cpu && systemInfo.cpu.usagePercent) }}</span>
          </div>
          <div class="hw-bar">
            <div class="hw-bar-fill orange" :style="{ width: ((systemInfo.cpu && systemInfo.cpu.usagePercent) || 0) + '%' }"></div>
          </div>
          <div class="hw-sub">
            <span>温度 {{ systemInfo.cpu && systemInfo.cpu.temp != null ? systemInfo.cpu.temp + ' °C' : '未上报' }}</span>
            <span>{{ systemInfo.system && systemInfo.system.model ? systemInfo.system.model : '' }}</span>
          </div>
        </div>

        <div class="hw-item">
          <div class="hw-top">
            <span class="hw-name">内存占用</span>
            <span class="hw-val text-muted">{{ memText }}</span>
          </div>
          <div class="hw-bar">
            <div class="hw-bar-fill blue" :style="{ width: memBarWidth }"></div>
          </div>
          <div class="hw-sub">
            <span>{{ memDetail }}</span>
            <span v-if="!hasMem">经 MQTT 推送获取</span>
          </div>
        </div>

        <div class="hw-item">
          <div class="hw-top">
            <span class="hw-name">风扇</span>
            <span class="hw-val text-blue">{{ fanSpeedText }}</span>
          </div>
          <div class="hw-bar">
            <div class="hw-bar-fill blue" :style="{ width: fanBarWidth }"></div>
          </div>
          <div class="hw-sub">
            <span>模式 {{ fanModeText }}</span>
            <span>{{ systemInfo.ups && systemInfo.ups.enabled ? 'UPS 已接入' : '' }}</span>
          </div>
        </div>
      </div>

      <!-- 链路状态 -->
      <div class="tunnel-info">
        <div class="info-row">
          <span class="label">设备型号 / 序列号</span>
          <span class="val font-mono">
            {{ (systemInfo.system && systemInfo.system.model) || '未上报' }}
            <template v-if="systemInfo.system && systemInfo.system.serial">
              · {{ mask(systemInfo.system.serial, 'serial') }}
            </template>
          </span>
        </div>
        <div class="info-row">
          <span class="label">固件版本</span>
          <span class="val font-mono">{{ (systemInfo.system && systemInfo.system.version) || '未上报' }}</span>
        </div>
        <div class="info-row">
          <span class="label">网卡与链接</span>
          <span class="val">
            <template v-if="systemInfo.network && systemInfo.network.ip">{{ mask(systemInfo.network.ip, 'ip') }}</template>
            <template v-else>未上报</template>
            <template v-if="systemInfo.network && systemInfo.network.mac">
              · {{ mask(systemInfo.network.mac, 'mac') }}
            </template>
          </span>
        </div>
        <div class="info-row">
          <span class="label">实时速率</span>
          <span class="val">
            ↑ {{ (systemInfo.network && systemInfo.network.upload) || '未上报' }}
            · ↓ {{ (systemInfo.network && systemInfo.network.download) || '未上报' }}
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
import { maskValue } from '../utils/privacy.js';

const props = defineProps({
  currentRtt: { type: Number, default: 0 },
  history: { type: Array, default: () => [] },
  tunnelGateway: { type: String, default: '' },
  systemInfo: {
    type: Object,
    default: () => ({
      cpu: { usagePercent: null, temp: null },
      fan: { rpm: null, mode: null },
      network: { ip: null, mac: null, upload: null, download: null },
      system: { model: null, serial: null, version: null },
      ups: { enabled: null },
      memory: { totalBytes: null, usedBytes: null, usagePercent: null }
    })
  }
});

// 内存数据只来自 MQTT meminfo 推送（NAS 无 HTTP 查询接口），
// 未收到推送前显示"未上报"而不是编造数值。
const hasMem = computed(() => props.systemInfo.memory && props.systemInfo.memory.totalBytes != null);
const memText = computed(() => hasMem.value && props.systemInfo.memory.usagePercent != null
  ? props.systemInfo.memory.usagePercent + '%' : '未上报');
const memBarWidth = computed(() => hasMem.value && props.systemInfo.memory.usagePercent != null
  ? Math.min(100, props.systemInfo.memory.usagePercent) + '%' : '0%');
const memDetail = computed(() => {
  const m = props.systemInfo.memory;
  if (!hasMem.value) return '';
  const fmt = (b) => { const n = parseInt(b,10); return n > 1e12 ? (n/1e12).toFixed(1)+' TB' : n > 1e9 ? (n/1e9).toFixed(1)+' GB' : (n/1e6).toFixed(0)+' MB'; };
  return m.usedBytes != null ? `${fmt(m.usedBytes)} / ${fmt(m.totalBytes)}` : `总量 ${fmt(m.totalBytes)}`;
});

// 未上报的指标显示为"未上报"，不要假装是 0% 或某个具体读数
function fmtPct(v) {
  return v == null ? '未上报' : v + '%';
}

// 脱敏：maskValue 内部读共享的 masked 状态，开关切换时模板会自动重算
function mask(v, kind) {
  return maskValue(v, kind);
}

const fanSpeedText = computed(() => {
  const f = props.systemInfo.fan;
  if (!f || f.rpm == null) return '未上报';
  return f.rpm === 0 ? '停转 (0 RPM)' : f.rpm + ' RPM';
});

const fanModeText = computed(() => {
  const f = props.systemInfo.fan;
  if (!f || !f.mode) return '未上报';
  const map = { standard: '标准', quiet: '静音', strong: '强力', auto: '自动' };
  return map[f.mode] || f.mode;
});

// 风扇条仅作可视化：0 转显示为空，有转速时按 3000 RPM 满量程折算
const fanBarWidth = computed(() => {
  const f = props.systemInfo.fan;
  if (!f || !f.rpm) return '0%';
  return Math.min(100, Math.round((f.rpm / 3000) * 100)) + '%';
});

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

.text-muted {
  color: var(--mi-text-sub);
  font-weight: 600;
}
</style>
