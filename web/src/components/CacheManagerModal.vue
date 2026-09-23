<template>
  <Transition name="mi-modal">
    <div v-if="visible" class="modal-backdrop" @click.self="$emit('close')">
      <div class="custom-modal cache-modal mi-surface">
        <!-- 模态框顶部 -->
        <div class="cache-hdr">
          <div class="hdr-left">
            <div class="hdr-badge-icon">💾</div>
            <div class="hdr-text">
              <h4>本地缓存管理</h4>
              <p>查看并清理浏览器中缓存的设备数据、壁纸与离线副本</p>
            </div>
          </div>
          <button class="close-x" @click="$emit('close')" title="关闭">✕</button>
        </div>

        <!-- 总量概览 -->
        <div class="cache-body">
          <div class="overview-card">
            <div class="ov-main">
              <span class="ov-value">{{ formatBytes(stats.totalBytes) }}</span>
              <span class="ov-label">当前缓存占用</span>
            </div>
            <div class="ov-meta">
              <div class="meta-row">
                <span class="meta-k">缓存条目</span>
                <span class="meta-v">{{ stats.items.length }} 项</span>
              </div>
              <div class="meta-row" v-if="quota">
                <span class="meta-k">浏览器配额</span>
                <span class="meta-v">
                  {{ formatBytes(quota.usage) }} / {{ formatBytes(quota.quota) }}
                </span>
              </div>
            </div>
          </div>

          <!-- 分类占用 -->
          <div class="section-card" v-if="categoryList.length">
            <div class="sc-title">分类占用</div>
            <div class="cat-list">
              <div v-for="c in categoryList" :key="c.name" class="cat-row">
                <span class="cat-name">{{ c.name }}</span>
                <div class="cat-bar-track">
                  <div
                    class="cat-bar-fill"
                    :style="{ width: c.percent + '%' }"
                  ></div>
                </div>
                <span class="cat-size">{{ formatBytes(c.bytes) }}</span>
              </div>
            </div>
          </div>

          <!-- 服务端缩略图磁盘缓存 (server/cache) 与强缓存击穿管理 -->
          <div class="section-card server-cache-card">
            <div class="sc-header-row">
              <div class="sc-title">
                🖼️ 服务端缩略图磁盘缓存
                <span class="sc-hint font-mono">server/cache</span>
              </div>
              <button
                class="sc-refresh-btn"
                :disabled="loadingServerCache"
                @click="refreshServerCache"
                title="重新读取服务端磁盘统计"
              >
                {{ loadingServerCache ? '扫描中…' : '🔄 刷新统计' }}
              </button>
            </div>

            <div class="server-cache-stats-grid">
              <div class="sc-stat-pill mi-surface">
                <span class="label">缩略图与转码总占用</span>
                <span class="val highlight">{{ formatBytes(serverStats.totalBytes) }}</span>
              </div>
              <div class="sc-stat-pill mi-surface">
                <span class="label">缓存文件总量</span>
                <span class="val">{{ serverStats.totalFiles }} 项</span>
              </div>
              <div class="sc-stat-pill mi-surface">
                <span class="label">WebDAV 缩略图 (.img)</span>
                <span class="val">{{ serverStats.byCategory?.thumbnails?.count || 0 }} 项 ({{ formatBytes(serverStats.byCategory?.thumbnails?.bytes) }})</span>
              </div>
              <div class="sc-stat-pill mi-surface">
                <span class="label">HEIC 转码副本 (.jpg)</span>
                <span class="val">{{ serverStats.byCategory?.transcoded?.count || 0 }} 项 ({{ formatBytes(serverStats.byCategory?.transcoded?.bytes) }})</span>
              </div>
            </div>

            <div class="server-cache-actions">
              <div class="server-action-desc">
                <p>从 NAS 实时拉取的缩略图会在此落盘。若遇到缩略图不更新或显示异常，可清理此处并自动击穿浏览器 HTTP 磁盘缓存。</p>
                <label class="danger-check">
                  <input type="checkbox" v-model="includeIcons" />
                  <span>同时清理原厂应用/系统图标缓存 (.png)</span>
                </label>
              </div>
              <button
                class="server-clear-btn"
                :disabled="clearingServer || serverStats.totalFiles === 0"
                @click="doClearServerCache"
              >
                {{ clearingServer ? '正在安全清理…' : '🗑️ 一键清空缩略图缓存' }}
              </button>
            </div>
          </div>

          <!-- 明细列表 -->
          <div class="section-card">
            <div class="sc-title">
              缓存明细
              <span class="sc-hint">点击右侧按钮可单独清除</span>
            </div>

            <div v-if="stats.items.length === 0" class="empty-hint">
              暂无本地缓存数据
            </div>

            <!-- 单项清除时让条目自己收缩退场，而不是整行瞬间消失、下方内容跳上来 -->
            <TransitionGroup v-else name="mi-collapse" tag="div" class="item-list">
              <div
                v-for="it in stats.items"
                :key="it.id"
                class="cache-item"
                :class="{ removing: removingId === it.id }"
              >
                <div class="item-main">
                  <span class="item-name">{{ it.name }}</span>
                  <span class="item-tag">{{ it.category }}</span>
                </div>
                <div class="item-right">
                  <span class="item-size">{{ formatBytes(it.bytes) }}</span>
                  <button
                    class="item-del"
                    :disabled="removingId === it.id"
                    @click="removeItem(it)"
                  >{{ removingId === it.id ? '清除中…' : '清除' }}</button>
                </div>
              </div>
            </TransitionGroup>
          </div>

          <!-- 危险操作区：清空全部。壁纸属于用户作品，单独勾选 -->
          <div class="danger-card">
            <div class="danger-text">
              <strong>清空全部缓存</strong>
              <p>清除后再次打开页面会重新从 NAS 拉取数据，不影响 NAS 上的任何文件。</p>
              <div class="danger-check-group">
                <label class="danger-check">
                  <input type="checkbox" v-model="includeServerCacheInAll" />
                  <span>包含服务端缩略图磁盘缓存 (server/cache)</span>
                </label>
                <label class="danger-check">
                  <input type="checkbox" v-model="includeWallpaper" />
                  <span>同时删除自定义壁纸（不可恢复，需重新上传）</span>
                </label>
              </div>
            </div>
            <button class="danger-btn" :disabled="clearing || (stats.items.length === 0 && serverStats.totalFiles === 0)" @click="doClearAll">
              {{ clearing ? '清理中…' : '清空缓存' }}
            </button>
          </div>

          <!-- 操作结果提示：轮换出现时有进出场，避免文字硬替换 -->
          <Transition name="mi-swap">
            <div v-if="notice" class="notice" :class="{ error: noticeError }">
              {{ notice }}
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import {
  getCacheStats,
  getStorageQuota,
  removeCacheItem,
  clearAllCache,
  getServerCacheStats,
  clearServerCache,
  formatBytes
} from '../utils/cache.js';

const props = defineProps({
  visible: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'changed']);

const stats = ref({ items: [], totalBytes: 0, byCategory: {} });
const serverStats = ref({ totalFiles: 0, totalBytes: 0, byCategory: {} });
const loadingServerCache = ref(false);
const clearingServer = ref(false);
const includeIcons = ref(false);
const includeServerCacheInAll = ref(true);

const quota = ref(null);
const removingId = ref('');
const clearing = ref(false);
const includeWallpaper = ref(false);
const notice = ref('');
const noticeError = ref(false);

// 分类按占比排序，用于条形图
const categoryList = computed(() => {
  const entries = Object.entries(stats.value.byCategory || {});
  const total = stats.value.totalBytes || 1;
  return entries
    .map(([name, bytes]) => ({
      name,
      bytes,
      percent: Math.max(2, Math.round((bytes / total) * 100))
    }))
    .sort((a, b) => b.bytes - a.bytes);
});

function showNotice(msg, isError = false) {
  notice.value = msg;
  noticeError.value = isError;
  setTimeout(() => {
    if (notice.value === msg) notice.value = '';
  }, 3500);
}

async function refreshServerCache() {
  loadingServerCache.value = true;
  try {
    serverStats.value = await getServerCacheStats();
  } finally {
    loadingServerCache.value = false;
  }
}

async function refresh() {
  stats.value = await getCacheStats();
  quota.value = await getStorageQuota();
  await refreshServerCache();
}

async function doClearServerCache() {
  clearingServer.value = true;
  try {
    const kind = includeIcons.value ? 'all' : 'thumbnails';
    const res = await clearServerCache(kind);
    await refresh();
    emit('changed');
    if (res.status === 'ok') {
      showNotice(res.message || '已清空服务端缩略图缓存并刷新版本');
    } else {
      showNotice(`清理失败: ${res.message}`, true);
    }
  } finally {
    clearingServer.value = false;
  }
}

async function removeItem(it) {
  removingId.value = it.id;
  const ok = await removeCacheItem(it);
  removingId.value = '';
  if (ok) {
    await refresh();
    emit('changed');
    showNotice(`已清除「${it.name}」`);
  } else {
    showNotice(`清除「${it.name}」失败`, true);
  }
}

async function doClearAll() {
  clearing.value = true;
  try {
    let serverNotice = '';
    if (includeServerCacheInAll.value) {
      const sRes = await clearServerCache('all');
      if (sRes.status === 'ok') {
        serverNotice = `、服务端 ${sRes.clearedCount} 个文件`;
      }
    }

    const res = await clearAllCache({ includeWallpaper: includeWallpaper.value });
    await refresh();
    emit('changed');
    const extra = includeWallpaper.value ? '（含自定义壁纸）' : '';
    showNotice(
      res.failed > 0
        ? `已清理本地 ${res.cleared} 项${serverNotice}${extra}，${res.failed} 项失败`
        : `已清空全部本地缓存${serverNotice}${extra}，并自动击穿浏览器强缓存`,
      res.failed > 0
    );
  } finally {
    clearing.value = false;
  }
}

// 每次打开都重新统计，避免显示上次的过期数字
watch(() => props.visible, (val) => {
  if (val) {
    notice.value = '';
    includeWallpaper.value = false;
    includeIcons.value = false;
    includeServerCacheInAll.value = true;
    refresh();
  }
});
</script>

<style scoped>
.cache-modal {
  width: 680px;
  max-width: 95vw;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--mi-card-bg);
  border: 1px solid var(--mi-card-border);
  border-radius: var(--mi-radius-lg);
}

.cache-hdr {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 20px 24px;
  border-bottom: 1px solid var(--mi-card-border);
}

.hdr-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hdr-badge-icon {
  font-size: 22px;
  line-height: 1;
}

.hdr-text h4 {
  margin: 0 0 2px;
  font-size: 16px;
  font-weight: 700;
  color: var(--mi-text-main);
}

.hdr-text p {
  margin: 0;
  font-size: 12px;
  color: var(--mi-text-sub);
}

.close-x {
  font-size: 16px;
  width: 30px;
  height: 30px;
  border-radius: var(--mi-radius-sm);
  color: var(--mi-text-sub);
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-x:hover {
  background: var(--mi-control-sub-bg);
  color: var(--mi-text-main);
}

.cache-body {
  padding: 18px 24px 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 总量概览 */
.overview-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  padding: 16px 20px;
  border-radius: var(--mi-radius-md);
  background: var(--mi-accent-soft);
  border: 1px solid var(--mi-card-border);
}

.ov-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ov-value {
  font-size: 26px;
  font-weight: 800;
  color: var(--mi-accent-text-on-soft, var(--mi-accent-text));
  line-height: 1.1;
}

.ov-label {
  font-size: 12px;
  color: var(--mi-text-sub);
}

.ov-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: 12px;
}

.meta-k {
  color: var(--mi-text-sub);
}

.meta-v {
  color: var(--mi-text-main);
  font-weight: 600;
}

/* 分区卡片 */
.section-card {
  padding: 14px 18px;
  border-radius: var(--mi-radius-md);
  background: var(--mi-card-sub-bg);
  border: 1px solid var(--mi-card-border);
}

.sc-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--mi-text-main);
  margin-bottom: 12px;
}

.sc-hint {
  font-size: 11px;
  font-weight: 400;
  color: var(--mi-text-sub);
}

/* 分类条形图 */
.cat-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cat-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.cat-name {
  width: 92px;
  flex-shrink: 0;
  color: var(--mi-text-main);
}

.cat-bar-track {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: var(--mi-control-sub-bg);
  overflow: hidden;
}

.cat-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--mi-orange);
  transition: width 0.3s ease;
}

.cat-size {
  width: 66px;
  text-align: right;
  flex-shrink: 0;
  color: var(--mi-text-sub);
}

/* 明细列表 */
.item-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cache-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--mi-radius-sm);
  background: var(--mi-card-bg);
  border: 1px solid var(--mi-card-border);
}

.cache-item.removing {
  opacity: 0.6;
}

.item-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-tag {
  flex-shrink: 0;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--mi-control-sub-bg);
  color: var(--mi-text-sub);
}

.item-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.item-size {
  font-size: 12px;
  color: var(--mi-text-sub);
  font-variant-numeric: tabular-nums;
}

.item-del {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: var(--mi-radius-sm);
  background: var(--mi-control-sub-bg);
  color: var(--mi-text-main);
  border: 1px solid var(--mi-card-border);
}

.item-del:hover:not(:disabled) {
  background: var(--mi-status-red-soft);
  color: var(--mi-status-red);
  border-color: var(--mi-status-red);
}

.item-del:disabled {
  opacity: 0.6;
  cursor: default;
}

.empty-hint {
  font-size: 12px;
  color: var(--mi-text-sub);
  text-align: center;
  padding: 8px 0;
}

/* 服务端缩略图缓存卡片 */
.server-cache-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sc-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sc-header-row .sc-title {
  margin-bottom: 0;
}

.sc-refresh-btn {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: var(--mi-radius-sm);
  background: var(--mi-control-sub-bg);
  color: var(--mi-text-main);
  border: 1px solid var(--mi-card-border);
  cursor: pointer;
  transition: all 0.2s;
}

.sc-refresh-btn:hover:not(:disabled) {
  background: var(--mi-control-bg);
  color: var(--mi-orange);
}

.server-cache-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.sc-stat-pill {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border-radius: var(--mi-radius-sm);
  background: var(--mi-card-bg);
  border: 1px solid var(--mi-card-border);
}

.sc-stat-pill .label {
  font-size: 11px;
  color: var(--mi-text-sub);
}

.sc-stat-pill .val {
  font-size: 13px;
  font-weight: 700;
  color: var(--mi-text-main);
}

.sc-stat-pill .val.highlight {
  color: var(--mi-orange);
  font-size: 15px;
}

.server-cache-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding-top: 8px;
  border-top: 1px dashed var(--mi-border);
}

.server-action-desc p {
  margin: 0 0 6px;
  font-size: 11px;
  color: var(--mi-text-sub);
  line-height: 1.4;
}

.server-clear-btn {
  flex-shrink: 0;
  padding: 8px 14px;
  border-radius: var(--mi-radius-sm);
  font-size: 12px;
  font-weight: 700;
  background: var(--mi-status-red-soft);
  color: var(--mi-status-red);
  border: 1px solid var(--mi-status-red);
  cursor: pointer;
  transition: all 0.2s;
}

.server-clear-btn:hover:not(:disabled) {
  background: var(--mi-status-red);
  color: var(--mi-on-danger-solid, #ffffff);
}

.server-clear-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.danger-check-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 危险操作区 */
.danger-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  padding: 14px 18px;
  border-radius: var(--mi-radius-md);
  background: var(--mi-status-red-soft);
  border: 1px solid var(--mi-status-red);
}

.danger-text strong {
  font-size: 13px;
  color: var(--mi-text-main);
  display: block;
  margin-bottom: 4px;
}

.danger-text p {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--mi-text-sub);
}

.danger-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--mi-text-main);
  cursor: pointer;
}

.danger-check input {
  cursor: pointer;
}

.danger-btn {
  flex-shrink: 0;
  padding: 9px 18px;
  border-radius: var(--mi-radius-sm);
  font-size: 13px;
  font-weight: 700;
  background: var(--mi-danger-solid, var(--mi-status-red));
  color: var(--mi-on-danger-solid, var(--mi-card-bg));
  border: 1px solid transparent;
}

.danger-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.danger-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.notice {
  font-size: 12px;
  padding: 9px 14px;
  border-radius: var(--mi-radius-sm);
  background: var(--mi-status-green-soft);
  color: var(--mi-status-green);
  border: 1px solid var(--mi-status-green);
}

.notice.error {
  background: var(--mi-status-red-soft);
  color: var(--mi-status-red);
  border-color: var(--mi-status-red);
}
</style>
