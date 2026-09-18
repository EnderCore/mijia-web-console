<template>
  <div class="app-root">
    <!-- 顶部状态栏与导航 -->
    <TopHeader
      :device-name="deviceName"
      :is-online="isOnline"
      :did="statusInfo.did"
      :url-port="statusInfo.urlPort"
      :loading="refreshing"
      @refresh="loadAllData"
      @open-explorer="showFileExplorer = true"
    />

    <!-- 主界面内容区 (仿米家卡片式极简布局) -->
    <main class="main-content">
      <!-- 离线提示横幅 -->
      <div v-if="!isOnline" class="offline-banner">
        <div class="banner-content">
          <span class="banner-icon">⚡</span>
          <div class="banner-text">
            <strong>离线高速模式 (已启用客户端与服务器二级持久缓存)</strong>
            <span>当前通过内网模拟与本地持久存储提供极速访问，启动官方客户端后将无缝直通真实 NAS 硬件。</span>
          </div>
        </div>
        <button class="retry-btn" @click="loadAllData" :disabled="refreshing">
          实时探针
        </button>
      </div>

      <!-- 核心仪表盘网格 -->
      <div class="dashboard-grid">
        <!-- 左侧列：存储容量概况 + 硬件CPU/内存与网络监控 -->
        <div class="column-left">
          <StorageMeter
            :used-bytes="storageData.usedBytes"
            :total-bytes="storageData.totalBytes"
            :uid="storageData.uid"
            :pool-type="storageData.poolType"
          />

          <MonitorChart
            :current-rtt="monitorData.currentRTT"
            :history="monitorData.history"
            :tunnel-gateway="monitorData.tunnel"
            :system-info="systemHardwareInfo"
          />
        </div>

        <!-- 右侧列：小程序功能九宫格 + 最近媒体瀑布流 -->
        <div class="column-right">
          <AppGrid
            :apps="appsList"
            @launch-app="handleLaunchApp"
          />

          <RecentMedia
            :files="recentFiles"
            @preview-media="handlePreviewMedia"
          />
        </div>
      </div>
    </main>

    <!-- 底部状态栏 -->
    <footer class="app-footer">
      <div class="footer-inner">
        <span>米家 Xiaomi Smart Storage Web 控制台 · 硬件级双盘镜像</span>
        <span class="dot">·</span>
        <span>设备 DID: {{ statusInfo.did || '1181294988' }}</span>
        <span class="dot">·</span>
        <span :class="isOnline ? 'text-green' : 'text-orange'">
          {{ isOnline ? 'P2P 硬件直通 (127.0.0.1:' + statusInfo.urlPort + ')' : '离线极速缓存模式' }}
        </span>
        <span class="dot">·</span>
        <span>缩略图高速缓存: 已挂载 (IndexedDB + Disk)</span>
      </div>
    </footer>

    <!-- 官方影视墙 Web 独立弹窗 (通过 webPort 或演示通道直连) -->
    <MediaCenterModal
      :visible="showMediaModal"
      :media-url="mediaCenterUrl"
      @close="showMediaModal = false"
    />

    <!-- 沉浸式多功能小程序弹窗 -->
    <FileExplorerModal
      :visible="showFileExplorer"
      :files="recentFiles"
      @close="showFileExplorer = false"
      @play-video="handlePlayVideo"
      @preview-photo="handlePreviewMedia"
      @preview-doc="handlePreviewDoc"
    />

    <!-- 专业 Video.js 播放器弹窗 (支持清晰度与多分辨率自由切换) -->
    <VideoPlayerModal
      :visible="showVideoPlayer"
      :video="activeVideo"
      @close="showVideoPlayer = false"
    />

    <!-- 通用文档与文本在线阅读器 (支持 PDF / TXT / MD / 代码 / 音频) -->
    <DocumentViewerModal
      :visible="showDocViewer"
      :file="activeDoc"
      @close="showDocViewer = false"
    />

    <div v-if="activeDialog" class="modal-backdrop" @click.self="activeDialog = null">
      <div class="custom-modal">
        <div class="modal-hdr">
          <div class="modal-hdr-title">
            <span class="hdr-icon">{{ activeDialog.icon || '📱' }}</span>
            <h4>{{ activeDialog.title }}</h4>
          </div>
          <button class="close-x" @click="activeDialog = null">✕</button>
        </div>
        <div class="modal-cnt">
          <p class="modal-desc">{{ activeDialog.desc }}</p>

          <!-- 小程序列表展示 -->
          <div v-if="activeDialog.items" class="modal-list-box">
            <div v-for="(item, idx) in activeDialog.items" :key="idx" class="modal-list-item">
              <div class="item-info">
                <span class="item-title">{{ item.name }}</span>
                <span class="item-sub" v-if="item.sub">{{ item.sub }}</span>
              </div>
              <span class="item-detail">{{ item.detail }}</span>
            </div>
          </div>

          <!-- 系统设置视图 -->
          <div v-else-if="activeDialog.type === 'settings'" class="settings-view">
            <div class="setting-row">
              <div class="setting-meta">
                <strong>智能风扇转速模式</strong>
                <span>根据硬盘温度自动静音调速</span>
              </div>
              <span class="switch-tag active">自动平衡</span>
            </div>
            <div class="setting-row">
              <div class="setting-meta">
                <strong>Samba (网络邻居) 协议</strong>
                <span>局域网内免客户端直接挂载为本地磁盘</span>
              </div>
              <span class="switch-tag active">已启用 (端口 445)</span>
            </div>
            <div class="setting-row">
              <div class="setting-meta">
                <strong>硬件休眠策略</strong>
                <span>硬盘无读写 15 分钟后自动磁头休眠</span>
              </div>
              <span class="switch-tag active">已启用</span>
            </div>
          </div>

          <!-- 任务中心视图 -->
          <div v-else-if="activeDialog.type === 'task'" class="task-view">
            <div class="task-card">
              <div class="t-top">
                <span>Ubuntu-24.04-LTS-Desktop.iso</span>
                <span class="text-orange">下载中 (12.4 MB/s)</span>
              </div>
              <div class="t-prog"><div class="t-fill" style="width: 68%;"></div></div>
              <div class="t-bot"><span>3.8 GB / 5.6 GB</span><span>剩余约 2 分钟</span></div>
            </div>
            <div class="task-card">
              <div class="t-top">
                <span>手机相册增量双向同步任务</span>
                <span class="text-green">同步完成</span>
              </div>
              <div class="t-prog"><div class="t-fill green" style="width: 100%;"></div></div>
              <div class="t-bot"><span>已同步 1,420 张照片</span><span>双重备份已防护</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 媒体大图与视频播放器弹窗 -->
    <div v-if="activeMedia" class="media-viewer-backdrop" @click.self="activeMedia = null">
      <div class="media-viewer-box">
        <div class="viewer-header">
          <div class="vh-title">
            <span class="icon">{{ activeMedia.type === 'video' ? '🎬' : '🖼️' }}</span>
            <span class="name">{{ activeMedia.name }}</span>
          </div>
          <button class="close-viewer" @click="activeMedia = null">✕</button>
        </div>
        <div class="viewer-body">
          <video
            v-if="activeMedia.type === 'video'"
            :src="activeMedia.videoUrl"
            controls
            autoplay
            class="viewer-video"
          ></video>
          <img
            v-else
            :src="activeMedia.previewUrl || activeMedia.thumbnail"
            :alt="activeMedia.name"
            class="viewer-img"
          />
        </div>
        <div class="viewer-footer">
          <span>分辨率: {{ activeMedia.dim || '原图规格' }}</span>
          <span>文件大小: {{ formatSize(activeMedia.size) }}</span>
          <span>路径: {{ activeMedia.path || '我的存储' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import TopHeader from './components/TopHeader.vue';
import StorageMeter from './components/StorageMeter.vue';
import MonitorChart from './components/MonitorChart.vue';
import AppGrid from './components/AppGrid.vue';
import RecentMedia from './components/RecentMedia.vue';
import MediaCenterModal from './components/MediaCenterModal.vue';
import FileExplorerModal from './components/FileExplorerModal.vue';
import VideoPlayerModal from './components/VideoPlayerModal.vue';
import DocumentViewerModal from './components/DocumentViewerModal.vue';
import { getCachedData, setCachedData } from './utils/cache.js';

// 状态定义
const deviceName = ref('小米智能存储 (NAS)');
const isOnline = ref(false);
const refreshing = ref(false);
const showMediaModal = ref(false);
const showFileExplorer = ref(false);
const showVideoPlayer = ref(false);
const showDocViewer = ref(false);
const activeVideo = ref(null);
const activeDoc = ref(null);
const activeDialog = ref(null);
const activeMedia = ref(null);

const statusInfo = ref({
  did: '1181294988',
  urlPort: 0,
  webPort: 0,
  online: false,
  message: ''
});

const storageData = ref({
  usedBytes: 12314144768,
  totalBytes: 8001583472640, // 7.28 TiB ≈ 8TB 标称 (双盘位 8TB 格式化后可用)
  uid: '2912935973',
  poolType: '存储池 pool0 (双盘镜像)'
});

const systemHardwareInfo = ref({
  model: 'Xiaomi Smart Storage',
  cpu: { model: 'Realtek RTD1619B (Quad-Core ARM Cortex-A55 @ 1.70GHz)', cores: 4, usagePercent: 18, temp: 43.5 },
  memory: { totalBytes: 4294967296, usedBytes: 1803886264, usagePercent: 42.0 },
  network: { linkSpeed: '2.5 Gbps', ip: '192.168.31.88' }
});

const monitorData = ref({
  currentRTT: 12,
  history: [],
  tunnel: '本地隧道 / P2P 直连'
});

const appsList = ref([]);
const recentFiles = ref([]);

// 影视墙原生路径
const mediaCenterUrl = computed(() => {
  const p = statusInfo.value.webPort || 25447;
  return `http://127.0.0.1:${p}/plugin/mediacenter/`;
});

function formatSize(bytes) {
  const b = parseInt(bytes, 10);
  if (!b) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

// 结合 IndexedDB/LocalStorage 的统一请求与离线缓存
async function apiGetWithCache(path, cacheKey) {
  try {
    const res = await fetch(path);
    if (res.ok) {
      const data = await res.json();
      if (cacheKey) setCachedData(cacheKey, data);
      return data;
    }
  } catch (e) {
    console.warn(`网络请求降级使用缓存 [${path}]:`, e);
  }
  // 离线/弱网回退到本地持久化缓存
  if (cacheKey) {
    const cached = await getCachedData(cacheKey);
    if (cached) return cached;
  }
  return null;
}

// 刷新状态与所有模块
async function loadAllData() {
  refreshing.value = true;
  try {
    // 1. 获取全局连接状态
    const statusRes = await apiGetWithCache('/api/status', 'cache_status');
    if (statusRes && statusRes.status === 'ok') {
      isOnline.value = true;
      statusInfo.value = statusRes;
    } else {
      isOnline.value = false;
      if (statusRes) statusInfo.value = statusRes;
    }

    // 2. 获取 CPU 与硬件信息
    const sysRes = await apiGetWithCache('/api/system', 'cache_system');
    if (sysRes && sysRes.data) {
      systemHardwareInfo.value = sysRes.data;
    }

    // 3. 获取用户配额与真实存储容量
    const usersRes = await apiGetWithCache('/api/users', 'cache_users');
    if (usersRes) {
      const ulist = usersRes.data?.users || usersRes.users || [];
      if (ulist.length > 0) {
        const u = ulist[0];
        storageData.value = {
          usedBytes: parseInt(u.used_size || 12314144768, 10),
          totalBytes: parseInt(u.total_size || 3840755982336, 10),
          uid: String(u.uid || '2912935973'),
          poolType: u.pool_type || '存储池 pool0 (双盘镜像)'
        };
      }
    }

    // 4. 获取应用与小程序列表
    const appsRes = await apiGetWithCache('/api/apps', 'cache_apps');
    if (appsRes) {
      const rawApps = appsRes.data?.apps || appsRes.apps || [];
      appsList.value = rawApps;
    }

    // 5. 获取相册与全盘文件流
    const filesRes = await apiGetWithCache('/api/files', 'cache_files');
    if (filesRes) {
      recentFiles.value = filesRes.data?.files || filesRes.files || [];
    }

    // 6. 测量延迟波形
    const monitorRes = await apiGetWithCache('/api/monitor', 'cache_monitor');
    if (monitorRes) {
      monitorData.value = {
        currentRTT: monitorRes.currentRTT,
        history: monitorRes.history || [],
        tunnel: monitorRes.tunnel
      };
    }
  } finally {
    refreshing.value = false;
  }
}

// 小程序呼出与交互处理
function handleLaunchApp(app) {
  if (app.plugin === 'mediacenter') {
    showMediaModal.value = true;
  } else if (app.name === '相册') {
    activeDialog.value = {
      title: 'AI 智能相册 (NAS 实际照片流)',
      icon: '🖼️',
      desc: '直接索引 NAS 真实存储卷中的照片与媒体文件',
      items: recentFiles.value
        .filter(f => f.type === 'photo' || f.name.includes('.png') || f.name.includes('.jpg') || f.name.includes('.heic'))
        .map(f => ({
          name: f.name,
          sub: `${f.parent || '/home/u2912935973/pool0/data/test'} · 照片`,
          detail: formatSize(f.size)
        }))
    };
  } else if (app.name === '文件') {
    showFileExplorer.value = true;
  } else if (app.name === '用户管理') {
    activeDialog.value = {
      title: '家庭成员共享与权限分配',
      icon: '👥',
      desc: '已配置多空间完全隔离，保障个人私密相册不受侵扰',
      items: [
        { name: `主管理员账号 (UID: ${storageData.value.uid})`, sub: '双盘镜像阵列拥有者', detail: '超级管理员' },
        { name: '家庭共享空间 (Family Shared)', sub: '向所有已绑定的米家家庭成员开放', detail: '全员可读写' },
        { name: 'Dual-Backup 物理盘镜像保护', sub: '自动双写防护，损坏一盘数据不丢', detail: '健康' }
      ]
    };
  } else if (app.name === '系统设置') {
    activeDialog.value = {
      title: '系统与网络高级设置',
      icon: '⚙️',
      type: 'settings',
      desc: '硬件状态微调、散热风扇温控与网络协议服务'
    };
  } else if (app.name === '任务中心') {
    activeDialog.value = {
      title: '传输与后台任务中心',
      icon: '⚡',
      type: 'task',
      desc: '查看正在进行的文件传输、双向增量同步与离线下载'
    };
  } else if (app.name === '保险箱') {
    activeDialog.value = {
      title: '硬件芯片级加密保险箱',
      icon: '🔐',
      desc: '采用 NAS 板载安全芯片生成的独立 AES-256 根密钥',
      items: [
        { name: '个人机密证书包 (minasCert.zip)', sub: '安全等级最高', detail: '已加密' },
        { name: '财务备份与个人证件.enc', sub: '单向独立密钥', detail: '已锁定' }
      ]
    };
  } else {
    activeDialog.value = {
      title: `${app.name} 小程序`,
      icon: '📦',
      desc: app.desc || '米家智能存储已启用该扩展组件',
      items: [
        { name: '运行状态', detail: app.installed ? '运行中 (后台守护)' : '未安装' },
        { name: '分类模式', detail: app.category || '扩展应用' },
        { name: '资源占用', detail: '< 15MB 内存' }
      ]
    };
  }
}

// 预览多媒体大图与视频
function handlePreviewMedia(file) {
  if (file.type === 'video') {
    handlePlayVideo(file);
  } else if (file.type === 'photo') {
    activeMedia.value = file;
  } else {
    handlePreviewDoc(file);
  }
}

function handlePlayVideo(file) {
  activeVideo.value = file;
  showVideoPlayer.value = true;
}

function handlePreviewDoc(file) {
  activeDoc.value = file;
  showDocViewer.value = true;
}

let timer = null;
onMounted(async () => {
  // 清除旧版本遗留的模拟假数据缓存，强制直通真实 NAS
  if (typeof window !== 'undefined') {
    localStorage.removeItem('mijia_cache_files');
  }

  loadAllData();
  // 每 8 秒自动轮询一次网络状态与硬件探针
  timer = setInterval(loadAllData, 8000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--mi-bg);
}

.main-content {
  flex: 1;
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 32px 40px;
}

.offline-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  padding: 14px 20px;
  border-radius: var(--mi-radius-md);
  margin-bottom: 24px;
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.banner-icon {
  font-size: 22px;
}

.banner-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.banner-text strong {
  font-size: 14px;
  color: #1e293b;
}

.banner-text span {
  font-size: 12px;
  color: #64748b;
}

.retry-btn {
  background: var(--mi-orange);
  color: white;
  padding: 6px 16px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  transition: opacity 0.2s;
}

.retry-btn:hover {
  opacity: 0.9;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: 440px 1fr;
  gap: 24px;
  align-items: start;
}

.column-left {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.column-right {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.app-footer {
  border-top: 1px solid var(--mi-border);
  background: #ffffff;
  padding: 16px 32px;
  margin-top: auto;
}

.footer-inner {
  max-width: 1440px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--mi-text-sub);
}

.footer-inner .dot {
  opacity: 0.4;
}

.text-green {
  color: #10b981;
  font-weight: 600;
}

.text-orange {
  color: #f97316;
  font-weight: 600;
}

/* 弹窗通用样式 */
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.custom-modal {
  width: 580px;
  max-width: 90vw;
  max-height: 85vh;
  background: white;
  border-radius: var(--mi-radius-lg);
  display: flex;
  flex-direction: column;
  box-shadow: var(--mi-shadow-hover);
  overflow: hidden;
}

.modal-hdr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 24px;
  border-bottom: 1px solid var(--mi-border);
}

.modal-hdr-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.hdr-icon {
  font-size: 20px;
}

.modal-hdr-title h4 {
  font-size: 16px;
  font-weight: 700;
  color: var(--mi-text-main);
}

.close-x {
  font-size: 16px;
  color: var(--mi-text-sub);
  padding: 4px;
}

.close-x:hover {
  color: var(--mi-text-main);
}

.modal-cnt {
  padding: 20px 24px;
  overflow-y: auto;
}

.modal-desc {
  font-size: 13px;
  color: var(--mi-text-sub);
  margin-bottom: 16px;
}

.modal-list-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.modal-list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f8fafc;
  border-radius: var(--mi-radius-md);
  border: 1px solid var(--mi-border);
}

.item-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.item-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--mi-text-main);
}

.item-sub {
  font-size: 11px;
  color: var(--mi-text-sub);
}

.item-detail {
  font-size: 12px;
  font-weight: 600;
  color: var(--mi-orange);
}

/* 系统设置与任务中心特殊卡片 */
.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  background: #f8fafc;
  border-radius: var(--mi-radius-md);
  margin-bottom: 10px;
  border: 1px solid var(--mi-border);
}

.setting-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setting-meta strong {
  font-size: 13px;
  color: var(--mi-text-main);
}

.setting-meta span {
  font-size: 11px;
  color: var(--mi-text-sub);
}

.switch-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 8px;
  background: #ecfdf5;
  color: #059669;
}

.task-card {
  background: #f8fafc;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-md);
  padding: 14px;
  margin-bottom: 12px;
}

.t-top {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.t-prog {
  height: 6px;
  background: #e2e8f0;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}

.t-fill {
  height: 100%;
  background: var(--mi-orange);
  border-radius: 3px;
}

.t-fill.green {
  background: #10b981;
}

.t-bot {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--mi-text-sub);
}

/* 媒体大图与视频播放器 */
.media-viewer-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
}

.media-viewer-box {
  width: 80vw;
  max-width: 1000px;
  background: #1e293b;
  border-radius: var(--mi-radius-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

.viewer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  background: #0f172a;
  color: white;
}

.vh-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}

.close-viewer {
  font-size: 16px;
  color: #94a3b8;
}

.close-viewer:hover {
  color: white;
}

.viewer-body {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000000;
  min-height: 400px;
  max-height: 65vh;
}

.viewer-img {
  max-width: 100%;
  max-height: 65vh;
  object-fit: contain;
}

.viewer-video {
  width: 100%;
  max-height: 65vh;
}

.viewer-footer {
  display: flex;
  justify-content: space-between;
  padding: 12px 20px;
  background: #0f172a;
  color: #94a3b8;
  font-size: 12px;
}

@media (max-width: 1080px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}
</style>
