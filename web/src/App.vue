<template>
  <div class="app-root" :class="{ 'has-custom-bg': currentWallpaperUrl || currentTheme.bgEnabled }">
    <!-- 客户端本地全景动态壁纸图层 (与 NAS 完全隔离) -->
    <div
      v-if="currentWallpaperUrl || currentTheme.bgEnabled"
      class="app-bg-layer"
      :style="{
        backgroundImage: currentWallpaperUrl ? `url(${currentWallpaperUrl})` : 'none',
        filter: `brightness(var(--mi-bg-brightness)) blur(var(--mi-bg-blur))`,
        opacity: `var(--mi-bg-opacity)`
      }"
    ></div>
    <!-- 壁纸调色遮罩层 -->
    <div
      v-if="currentWallpaperUrl || currentTheme.bgEnabled"
      class="app-bg-overlay"
      :style="{ background: currentTheme.bgTint }"
    ></div>

    <!-- 顶部状态栏与导航 -->
    <TopHeader
      :device-name="deviceName"
      :is-online="isOnline"
      :did="statusInfo.did"
      :url-port="statusInfo.urlPort"
      :loading="refreshing"
      @refresh="loadAllData"
      @open-explorer="showFileExplorer = true"
      @open-theme="showThemeModal = true"
    />

    <!-- 苏联/先锋构成主义风格专属：头条号外与工业生产力标语报头 -->
    <div v-if="currentTheme.isConstructivism" class="constructivist-gazette-masthead">
      <div class="gazette-flag">ПРАВДА // ВСЯ ВЛАСТЬ ДАННЫМ</div>
      <div class="gazette-headline">
        <span class="gazette-stamp">СССР-2026</span>
        <h2>小米智能存储：双盘镜像分布式数据终端</h2>
        <span class="gazette-slogan">« НАДЁЖНОСТЬ • АВТОНОМИЯ • БЫСТРОДЕЙСТВИЕ »</span>
      </div>
      <div class="gazette-meta-strip">
        <span>ВЫПУСК № 1181294988</span>
        <span>|</span>
        <span>РАЗДЕЛ: АРХИТЕКТУРА P2P/mTLS</span>
        <span>|</span>
        <span>СТАТУС: {{ isOnline ? 'АКТИВЕН (НА СВЯЗИ)' : 'АВТОНОМНЫЙ РЕЖИМ' }}</span>
        <span>|</span>
        <span>СКОРОСТЬ ПЕРЕДАЧИ: БЕЗ ОГРАНИЧЕНИЙ</span>
      </div>
    </div>

    <!-- 主界面内容区 (仿米家卡片式极简布局) -->
    <main class="main-content">
      <!-- 实时推送通知条（MQTT 经 SSE 转发） -->
      <div v-if="notifications.length" class="notify-stack">
        <div v-for="n in notifications" :key="n.ts + n.text" class="notify-item">{{ n.text }}</div>
      </div>

      <!-- 离线提示横幅 -->
      <div v-if="!isOnline" class="offline-banner">
        <div class="banner-content">
          <span class="banner-icon">⚠️</span>
          <div class="banner-text">
            <strong>未连接到 NAS</strong>
            <span>{{ statusInfo.message || '请确认小米智能存储官方客户端已在后台运行并登录。' }}</span>
          </div>
        </div>
        <button class="retry-btn" @click="loadAllData" :disabled="refreshing">
          {{ refreshing ? '探测中...' : '重新连接' }}
        </button>
      </div>

      <!-- 核心仪表盘网格 -->
      <div class="dashboard-grid">
        <!-- 左侧列：存储容量概况 + 硬件CPU/内存与网络监控 -->
        <div class="column-left">
          <StorageMeter
            :used-bytes="storageData.usedBytes"
            :total-bytes="storageData.totalBytes"
            :personal-used-bytes="storageData.personalUsedBytes"
            :total-is-estimated="storageData.totalIsEstimated"
            :uid="storageData.uid"
            :pool-type="storageData.poolType"
            :pool-name="storageData.poolName"
            :pool-status="storageData.poolStatus"
            :disks="systemHardwareInfo.disks || []"
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
        <span>设备 DID: {{ mask(statusInfo.did, 'did') || '未连接' }}</span>
        <span class="dot">·</span>
        <span :class="isOnline ? 'text-green' : 'text-orange'">
          {{ isOnline ? 'P2P 直通 (127.0.0.1:' + statusInfo.urlPort + ')' : '未连接官方客户端' }}
        </span>
        <span class="dot">·</span>
        <span :class="mqttConnected ? 'text-green' : 'text-muted'">
          {{ mqttConnected ? '推送通道已连接' : '推送通道未连接' }}
        </span>
        <span class="dot">·</span>
        <span>缩略图缓存: 本地磁盘 (server/cache)</span>
        <span class="dot">·</span>
        <span class="power-tag font-mono">Power by: Ender_Core</span>
      </div>
    </footer>

    <!-- 官方影视墙 Web 独立弹窗 (通过 webPort 或演示通道直连) -->
    <MediaCenterModal
      :visible="showMediaModal"
      :media-url="mediaCenterUrl"
      :error="mediaCenterError"
      @close="showMediaModal = false"
    />

    <!-- 沉浸式多功能小程序弹窗 -->
    <FileExplorerModal
      :visible="showFileExplorer"
      :files="recentFiles"
      :root-path="statusInfo.dataRoot || ''"
      @close="showFileExplorer = false"
      @play-video="handlePlayVideo"
      @preview-photo="handlePreviewMedia"
      @preview-doc="handlePreviewDoc"
      @refresh="loadAllData"
      @file-detail="openFileDetail"
      @open-history="openRecentHistory"
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

    <!-- 个性化与视觉风格设置模态框 (纯客户端本地保存) -->
    <ThemeSettingsModal
      :visible="showThemeModal"
      @close="showThemeModal = false"
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

          <!-- 系统设置视图：能力开关 + 电源/升级/SMB 真实只读数据 -->
          <div v-else-if="activeDialog.type === 'settings'" class="settings-view">
            <div class="set-row"><span>电源状态</span><b>{{ sysExtra.power || '未上报' }}</b></div>
            <div class="set-row"><span>固件版本</span><b>{{ systemHardwareInfo.system?.version || '未上报' }}</b></div>
            <div class="set-row"><span>升级状态</span><b>{{ upgradeText }}</b></div>
            <div class="set-row"><span>SMB 服务名</span><b>{{ sysExtra.sambaName || '未上报' }}</b></div>
            <div class="set-row"><span>SMBv1 兼容</span><b>{{ sysExtra.sambaV1 == null ? '未上报' : (sysExtra.sambaV1 ? '已开启' : '已关闭') }}</b></div>
            <div class="set-row"><span>风扇调速接口</span><b>{{ featureEnabled('mifan','fan_mode') ? '支持' : '本机不支持 (fan_mode:0)' }}</b></div>
            <div class="set-row"><span>迅雷插件</span><b>{{ featureEnabled('plugincenter','plugin_xunlei') ? '已启用' : '未启用' }}</b></div>
            <p class="unavailable-note">
              以上为 NAS 只读查询结果；风扇策略 / SMB / 休眠的修改接口按当前约束未接入，
              请使用小米智能存储官方客户端进行配置。
            </p>
          </div>

          <!-- 相册视图：真实 album/list_album + list_member -->
          <div v-else-if="activeDialog.type === 'album'" class="album-view">
            <div class="album-head">
              <div class="album-list">
                <button
                  v-for="a in albumList" :key="a.album_uuid"
                  class="album-item" :class="{ active: activeAlbum === a.album_uuid }"
                  @click="selectAlbum(a)"
                >
                  <span class="a-name">{{ albumDisplayName(a) }}</span>
                  <span class="a-count">{{ a.photo_count + a.video_count }} 项</span>
                </button>
              </div>
              <div class="album-photos">
                <p v-if="albumLoading" class="task-empty">加载中…</p>
                <p v-else-if="albumError" class="task-empty">{{ albumError }}</p>
                <p v-else-if="albumPhotos.length === 0" class="task-empty">该相册暂无内容</p>
                <div v-else class="album-grid">
                  <div v-for="p in albumPhotos" :key="p.member_id" class="aph" @click="openAlbumPhoto(p)">
                    <img :src="`/api/thumbnail?path=${encodeURIComponent(p.path)}&size=small`" :alt="p.name" loading="lazy" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 最近打开历史视图 -->
          <div v-else-if="activeDialog.type === 'openHistory'" class="task-view">
            <p v-if="histLoading" class="task-empty">加载中…</p>
            <p v-else-if="openHistory.length === 0" class="task-empty">暂无最近打开记录</p>
            <div v-else class="task-list">
              <div v-for="(h, i) in openHistory" :key="i" class="task-card hist-card" @click="openHistoryFile(h)">
                <div class="t-top">
                  <span class="t-name" :title="h.parent + '/' + h.name">{{ h.name }}</span>
                  <span class="t-status text-muted">{{ formatDate(h.access_time) }}</span>
                </div>
                <div class="t-bot">
                  <span>{{ mask(h.parent, 'path') }}</span>
                  <span>{{ formatSize(h.size) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 文件详情视图 -->
          <div v-else-if="activeDialog.type === 'fileDetail'" class="task-view">
            <div v-if="detailInfo" class="detail-grid">
              <div class="d-row"><span>文件名</span><b>{{ detailInfo.name }}</b></div>
              <div class="d-row"><span>类型</span><b>{{ detailInfo.type || '文件' }}</b></div>
              <div class="d-row"><span>大小</span><b>{{ formatSize(detailInfo.size) }}</b></div>
              <div class="d-row"><span>修改时间</span><b>{{ formatDate(detailInfo.modified_time) }}</b></div>
              <div class="d-row"><span>创建时间</span><b>{{ formatDate(detailInfo.create_time) }}</b></div>
              <div class="d-row"><span>访问时间</span><b>{{ formatDate(detailInfo.access_time) }}</b></div>
              <div class="d-row" v-if="detailInfo.pixel"><span>分辨率</span><b>{{ detailInfo.pixel }}</b></div>
              <div class="d-row" v-if="detailInfo.owner"><span>所有者</span><b>{{ mask(detailInfo.owner, 'uid') }}</b></div>
              <div class="d-row"><span>路径</span><b class="d-path">{{ mask(detailInfo.path, 'path') }}</b></div>
            </div>
            <p v-else class="task-empty">未获取到详情</p>
          </div>

          <!-- 任务中心视图：真实进度与速率，来自 taskcenter/get_taskinfo -->
          <div v-else-if="activeDialog.type === 'task'" class="task-view">
            <div class="task-tabs">
              <button
                v-for="t in taskTabs"
                :key="t.key"
                class="task-tab"
                :class="{ active: taskTab === t.key }"
                @click="switchTaskTab(t.key)"
              >
                {{ t.name }}
              </button>
              <button class="task-refresh" :disabled="taskLoading" @click="loadTasks(taskTab)">
                {{ taskLoading ? '加载中…' : '刷新' }}
              </button>
            </div>

            <div v-if="taskSummary" class="task-summary">
              <span>进行中 <b>{{ taskSummary.running_cnt ?? 0 }}</b></span>
              <span>成功 <b>{{ taskSummary.success_cnt ?? 0 }}</b></span>
              <span>失败 <b class="text-red">{{ taskSummary.failed_cnt ?? 0 }}</b></span>
              <span>已停止 <b>{{ taskSummary.stop_cnt ?? 0 }}</b></span>
            </div>

            <p v-if="taskError" class="task-empty">{{ taskError }}</p>
            <p v-else-if="!taskLoading && tasks.length === 0" class="task-empty">
              暂无任务记录
            </p>

            <div v-else class="task-list">
              <div v-for="t in tasks" :key="t.id" class="task-card">
                <div class="t-top">
                  <span class="t-name" :title="t.src[0] || t.name">
                    {{ t.name || '(未知文件)' }}
                    <template v-if="t.srcCount > 1">等 {{ t.srcCount }} 项</template>
                  </span>
                  <span class="t-status" :class="taskStatusClass(t.status)">
                    {{ taskStatusText(t) }}
                  </span>
                </div>

                <div class="t-prog">
                  <div class="t-fill" :class="{ green: t.status === 'success', red: t.status === 'failed' }"
                       :style="{ width: (t.progress ?? 0) + '%' }"></div>
                </div>

                <div class="t-bot">
                  <span>{{ taskActionText(t.action) }} · {{ t.progress ?? 0 }}%</span>
                  <span v-if="t.speed">{{ t.speed }}</span>
                  <span v-if="t.totalFiles != null">{{ t.handledFiles ?? 0 }}/{{ t.totalFiles }} 个文件</span>
                  <span v-if="t.errMsg && t.errCode">{{ t.errMsg }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 媒体大图与视频播放器弹窗 (升级版：支持无级滚轮缩放、手势拖拽平移、旋转与全屏控制) -->
    <div v-if="activeMedia" class="media-viewer-backdrop" @click.self="closeActiveMedia">
      <div class="media-viewer-box" :class="{ 'fullscreen-box': isImageViewerFullscreen }">
        <div class="viewer-header">
          <div class="vh-title">
            <span class="icon">{{ activeMedia.type === 'video' ? '🎬' : '🖼️' }}</span>
            <span class="name">{{ activeMedia.name }}</span>
          </div>

          <!-- 图片专用交互工具条 -->
          <div v-if="activeMedia.type !== 'video'" class="viewer-toolbar">
            <button class="tb-btn" @click="zoomImage(0.25)" title="放大">+</button>
            <span class="zoom-text">{{ Math.round(imageScale * 100) }}%</span>
            <button class="tb-btn" @click="zoomImage(-0.25)" title="缩小">-</button>
            <button class="tb-btn" @click="resetImageTransform" title="适应屏幕 / 1:1">⟲</button>
            <button class="tb-btn" @click="rotateImage" title="向右旋转 90 度">↻</button>
            <button class="tb-btn" @click="isImageViewerFullscreen = !isImageViewerFullscreen" title="切换全屏">
              {{ isImageViewerFullscreen ? '⤦' : '⤢' }}
            </button>
          </div>

          <button class="close-viewer" @click="closeActiveMedia">✕</button>
        </div>
        <div 
          class="viewer-body" 
          @wheel.prevent="handleImageWheel"
          @mousedown="handleImageMouseDown"
        >
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
            :class="{ 'is-dragging': isDraggingImage }"
            :style="{
              transform: `translate(${imageTranslate.x}px, ${imageTranslate.y}px) scale(${imageScale}) rotate(${imageRotation}deg)`,
              cursor: imageScale > 1 ? (isDraggingImage ? 'grabbing' : 'grab') : 'default'
            }"
            @dblclick="toggleImageDoubleZoom"
            draggable="false"
          />
        </div>
        <div class="viewer-footer">
          <span>分辨率: {{ activeMedia.dim || '未上报' }}</span>
          <span>文件大小: {{ formatSize(activeMedia.size) }}</span>
          <span>路径: {{ mask(activeMedia.path || statusInfo.dataRoot, 'path') || '未上报' }}</span>
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
import ThemeSettingsModal from './components/ThemeSettingsModal.vue';
import { getCachedData, setCachedData } from './utils/cache.js';
import { usePrivacy, maskValue } from './utils/privacy.js';
import {
  currentTheme,
  currentWallpaperUrl,
  loadStoredWallpaper,
  loadThemeConfig,
  applyTheme
} from './utils/theme.js';

// 状态定义
const deviceName = ref('小米智能存储 (NAS)');
const showThemeModal = ref(false);

// 隐私遮罩：masked 为共享单例，maskValue 内部依赖它，所以模板里调用 mask() 会自动重算
const { masked: privacyMasked } = usePrivacy();
function mask(v, kind) {
  return maskValue(v, kind);
}
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

// 图片查看器高级交互 (缩放、平移拖拽、旋转、全屏)
const imageScale = ref(1);
const imageTranslate = ref({ x: 0, y: 0 });
const imageRotation = ref(0);
const isImageViewerFullscreen = ref(false);
const isDraggingImage = ref(false);
let startDragPos = { x: 0, y: 0 };
let currentTranslateStart = { x: 0, y: 0 };

function resetImageTransform() {
  imageScale.value = 1;
  imageTranslate.value = { x: 0, y: 0 };
  imageRotation.value = 0;
}

function zoomImage(delta) {
  imageScale.value = Math.max(0.2, Math.min(6, +(imageScale.value + delta).toFixed(2)));
}

function rotateImage() {
  imageRotation.value = (imageRotation.value + 90) % 360;
}

function handleImageWheel(e) {
  if (activeMedia.value?.type === 'video') return;
  const delta = e.deltaY < 0 ? 0.2 : -0.2;
  zoomImage(delta);
}

function toggleImageDoubleZoom() {
  if (imageScale.value === 1) {
    imageScale.value = 2.5;
  } else {
    resetImageTransform();
  }
}

function handleImageMouseDown(e) {
  if (imageScale.value <= 1) return;
  isDraggingImage.value = true;
  startDragPos = { x: e.clientX, y: e.clientY };
  currentTranslateStart = { ...imageTranslate.value };

  const handleMouseMove = (ev) => {
    if (!isDraggingImage.value) return;
    const dx = ev.clientX - startDragPos.x;
    const dy = ev.clientY - startDragPos.y;
    imageTranslate.value = {
      x: currentTranslateStart.x + dx,
      y: currentTranslateStart.y + dy
    };
  };

  const handleMouseUp = () => {
    isDraggingImage.value = false;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };

  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
}

const isHeicMedia = computed(() => {
  const name = activeMedia.value?.name || '';
  const pathStr = activeMedia.value?.path || '';
  return /\.(heic|heif)$/i.test(name) || /\.(heic|heif)$/i.test(pathStr);
});

function closeActiveMedia() {
  activeMedia.value = null;
  resetImageTransform();
  isImageViewerFullscreen.value = false;
}

const statusInfo = ref({
  did: '',
  urlPort: 0,
  webPort: 0,
  dataRoot: '',
  online: false,
  message: ''
});

// 初值一律为空/零：真实数值必须来自 NAS，未连上时前端显示"未上报"而不是假数据
const storageData = ref({
  usedBytes: 0,
  totalBytes: 0,
  personalUsedBytes: 0,
  totalIsEstimated: false,
  uid: '',
  poolType: '',
  poolName: '存储空间',
  poolStatus: ''
});

const systemHardwareInfo = ref({
  cpu: { usagePercent: null, temp: null },
  fan: { rpm: null, mode: null },
  network: { ip: null, mac: null, upload: null, download: null },
  system: { model: null, serial: null, version: null },
  ups: { enabled: null },
  memory: { totalBytes: null, usedBytes: null, usagePercent: null },
  disks: []
});

const monitorData = ref({
  currentRTT: 0,
  history: [],
  tunnel: '本地隧道 / P2P 直连'
});

// ===== MQTT 推送（只读）：经 /api/events SSE 接收 =====
const mqttConnected = ref(false);
const notifications = ref([]);   // 最近几条推送通知（磁盘/USB/任务等）
let eventSource = null;

function pushNotification(text) {
  notifications.value.unshift({ text, ts: Date.now() });
  if (notifications.value.length > 5) notifications.value.pop();
  // 8 秒后自动移除该条
  setTimeout(() => {
    const i = notifications.value.findIndex(n => n.text === text);
    if (i >= 0) notifications.value.splice(i, 1);
  }, 8000);
}

function handleMqttEvent(topic, data) {
  if (topic === 'gateway/hello') {
    mqttConnected.value = !!data?.mqtt;
    return;
  }
  if (topic.endsWith('/meminfo/update')) {
    // /api/system 下次轮询会自动带上内存数据，这里只标记通道活着
    mqttConnected.value = true;
    return;
  }
  if (topic.endsWith('/filemgr') || topic.endsWith('/homepage')) {
    // 文件操作完成 → 任务中心开着就刷新
    if (activeDialog.value?.type === 'task') loadTasks(taskTab.value);
    pushNotification('📁 文件任务有更新');
    return;
  }
  if (topic.endsWith('/disk')) {
    pushNotification('💾 磁盘空间告警');
    return;
  }
  if (topic.endsWith('/usbinfo/update')) {
    pushNotification('🔌 USB 设备插拔');
    loadAllData();
    return;
  }
  if (topic.endsWith('/storage/modifypool')) {
    pushNotification('🗄️ 存储池变更');
    loadAllData();
    return;
  }
  if (topic.includes('/album/')) {
    // 相册弹窗开着时刷新
    if (activeDialog.value?.type === 'album') openAlbum();
    return;
  }
  // 其余主题（safebox/plugin/ipc）先只做通知
  pushNotification(`📨 ${topic.split('/').pop()} 事件`);
}

function startEventStream() {
  if (eventSource) return;
  try {
    eventSource = new EventSource('/api/events');
    eventSource.onmessage = (e) => {
      try {
        const { topic, data } = JSON.parse(e.data);
        handleMqttEvent(topic, data);
      } catch (err) {}
    };
    eventSource.onerror = () => {
      mqttConnected.value = false;
      // EventSource 自带重连；轮询兜底一直在跑，无需额外处理
    };
  } catch (e) {
    // SSE 不可用时静默，轮询仍工作
  }
}

const appsList = ref([]);
const recentFiles = ref([]);

// ===== 只读扩展数据（/api/query 白名单转发）=====
// features: system/get_feature 返回的模块能力开关；sysExtra: 电源/SMB 等杂项
const features = ref({});
const sysExtra = ref({ power: '', sambaName: '', sambaV1: null });
const upgradeState = ref({ state: '', progress: null });

// 相册视图状态
const albumList = ref([]);
const albumPhotos = ref([]);
const activeAlbum = ref('');
const albumLoading = ref(false);
const albumError = ref('');

// 统一调 /api/query 的便捷函数；body 直接透传给对应 LuCI 接口
async function nasQuery(endpoint, body = {}) {
  const res = await fetch(`/api/query?ep=${encodeURIComponent(endpoint)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function featureEnabled(module, key) {
  const f = features.value?.[module]?.features?.[key];
  return f ? (f.enable === 1 || f.enable === true || f.value > 0) : false;
}

const upgradeText = computed(() => {
  const s = upgradeState.value;
  if (s.progress == null && !s.state) return '未上报';
  if (s.state === 'fail' || s.progress === 0) return '无进行中升级';
  return `${s.state || '进行中'} ${s.progress ?? ''}%`;
});

const ALBUM_NAME_MAP = {
  all: '全部照片', favor: '收藏', screenshot: '截图', video: '视频',
};
function albumDisplayName(a) {
  return ALBUM_NAME_MAP[a.name] || a.name || `相册 ${a.album_uuid}`;
}

async function openAlbum() {
  albumLoading.value = true;
  albumError.value = '';
  try {
    const r = await nasQuery('album/list_album');
    const albums = r?.data?.albums || [];
    albumList.value = albums;
    if (albums.length > 0) selectAlbum(albums[0]);
    else albumError.value = 'NAS 未返回相册列表';
  } catch (e) {
    albumError.value = '相册接口不可用: ' + e.message;
  } finally {
    albumLoading.value = false;
  }
}

async function selectAlbum(a) {
  activeAlbum.value = a.album_uuid;
  albumLoading.value = true;
  albumError.value = '';
  try {
    const r = await nasQuery('album/list_member', { uuid: a.album_uuid, count: 200 });
    const photos = r?.data?.photos || [];
    albumPhotos.value = photos.map(p => ({ ...p, name: (p.path || '').split('/').pop() }));
    if (r.status === 'error') albumError.value = r.result || r.message || '照片列表查询失败';
  } catch (e) {
    albumError.value = '照片列表查询失败: ' + e.message;
    albumPhotos.value = [];
  } finally {
    albumLoading.value = false;
  }
}

function openAlbumPhoto(p) {
  const isVideo = /\.(mp4|mkv|mov|avi|ts|flv|webm)$/i.test(p.path || '');
  activeMedia.value = {
    name: p.name,
    path: p.path,
    size: p.size,
    type: isVideo ? 'video' : 'photo',
    previewUrl: `/api/thumbnail?path=${encodeURIComponent(p.path)}&size=preview`,
    videoUrl: isVideo ? `/api/stream?path=${encodeURIComponent(p.path)}` : '',
  };
}

// 加载系统只读杂项（电源/SMB/能力开关/升级状态）
async function loadSysExtras() {
  try {
    const [feat, power, upg, samba] = await Promise.allSettled([
      nasQuery('system/get_feature'),
      nasQuery('system/get_power_status'),
      nasQuery('system/get_upgrade_status'),
      nasQuery('netshare/get_samba_info'),
    ]);
    if (feat.status === 'fulfilled' && feat.value?.data) features.value = feat.value.data;
    if (power.status === 'fulfilled') sysExtra.value.power = power.value?.data?.power || '';
    if (upg.status === 'fulfilled') {
      const d = upg.value?.data || {};
      upgradeState.value = { state: d.state || '', progress: d.progress ?? null };
    }
    if (samba.status === 'fulfilled') {
      const d = samba.value?.data || {};
      sysExtra.value.sambaName = d.name || '';
      sysExtra.value.sambaV1 = d.SMBv1 ?? null;
    }
  } catch (e) {
    // 任一失败只让对应字段保持空，前端显示"未上报"
  }
}

// 影视墙地址：由网关从 get_app_list 取真实插件 URL 并代理（带 token），
// 不再拼硬编码的 webPort 路径 —— 官方实际走的是 urlport 且必须带 token。
const mediaCenterUrl = ref('');
const mediaCenterError = ref('');

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

    // 3. 获取用户配额与存储容量（total_size 由网关用 get_pool_info 补齐）
    const usersRes = await apiGetWithCache('/api/users', 'cache_users');
    if (usersRes && usersRes.status !== 'error') {
      const ulist = usersRes.data?.users || usersRes.users || [];
      if (ulist.length > 0) {
        const u = ulist[0];
        const pool = sysRes?.data?.storagePool || {};
        storageData.value = {
          // 进度条按整池口径显示（"存储空间"指池，不是单个用户配额），
          // 个人配额用量单独展示，避免把两个口径混在一个百分比里。
          usedBytes: pool.usedBytes || parseInt(u.pool_used_size || 0, 10) || parseInt(u.used_size || 0, 10),
          totalBytes: parseInt(u.total_size || 0, 10) || pool.totalBytes || 0,
          personalUsedBytes: parseInt(u.used_size || 0, 10),
          totalIsEstimated: !!u.total_size_is_estimated,
          uid: String(u.uid || ''),
          poolType: u.pool_type || '',
          poolName: u.pool_name || '存储空间',
          poolStatus: pool.status || ''
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

    // 7. 系统只读杂项（能力开关/电源/SMB/升级状态），失败不阻塞主流程
    loadSysExtras();
  } finally {
    refreshing.value = false;
  }
}

// 小程序呼出与交互处理
// ===== 任务中心（真实数据，来自 taskcenter/get_taskinfo）=====
const taskTabs = [
  { key: 'running', name: '进行中' },
  { key: 'history', name: '历史' },
];
const taskTab = ref('running');
const tasks = ref([]);
const taskSummary = ref(null);
const taskLoading = ref(false);
const taskError = ref('');

async function loadTasks(type = taskTab.value) {
  taskLoading.value = true;
  taskError.value = '';
  try {
    // 任务列表
    const res = await fetch(`/api/tasks?type=${encodeURIComponent(type)}`);
    const data = await res.json();
    if (data.status === 'ok') {
      tasks.value = data.data?.tasks || [];
    } else {
      tasks.value = [];
      taskError.value = data.message || '任务查询失败';
    }
    // 计数概览
    const sres = await fetch('/api/tasks?type=status');
    const sdata = await sres.json();
    if (sdata.status === 'ok') taskSummary.value = sdata.data || null;
  } catch (e) {
    tasks.value = [];
    taskError.value = '无法连接网关: ' + e.message;
  } finally {
    taskLoading.value = false;
  }
}

function switchTaskTab(key) {
  taskTab.value = key;
  loadTasks(key);
}

function taskActionText(a) {
  const map = {
    remove: '删除', copy: '复制', move: '移动', compress: '压缩', decompress: '解压',
    upload: '上传', download: '下载', rename: '重命名',
  };
  return map[a] || (a || '任务');
}

function taskStatusText(t) {
  const map = { success: '已完成', failed: '失败', running: '进行中', stop: '已停止', waiting: '排队中' };
  const base = map[t.status] || t.status || '';
  if (t.status === 'running' && t.speed) return `${base} ${t.speed}`;
  return base;
}

function taskStatusClass(s) {
  if (s === 'success') return 'text-green';
  if (s === 'failed') return 'text-red';
  if (s === 'running') return 'text-orange';
  return 'text-muted';
}

// ===== 最近打开历史 & 文件详情（/api/query 只读转发）=====
const openHistory = ref([]);
const histLoading = ref(false);
const detailInfo = ref(null);

function formatDate(ts) {
  if (!ts) return '未上报';
  const n = parseInt(ts, 10);
  // NAS 返回的 access_time/modified_time 部分是毫秒时间戳、部分是微秒；
  // 超过 1e14 视为微秒再除 1000
  const ms = n > 1e14 ? n / 1000 : n;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '未上报';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

async function openRecentHistory() {
  activeDialog.value = {
    title: '最近打开',
    icon: '🕐',
    type: 'openHistory',
    desc: '来自 NAS filemgr/get_open_history 接口的最近访问记录'
  };
  histLoading.value = true;
  try {
    const r = await nasQuery('filemgr/get_open_history');
    openHistory.value = r?.data?.files || [];
  } catch (e) {
    openHistory.value = [];
  } finally {
    histLoading.value = false;
  }
}

function openHistoryFile(h) {
  const full = h.parent ? `${h.parent}/${h.name}` : (h.path || h.name);
  const isVideo = /\.(mp4|mkv|mov|avi|ts|flv|webm)$/i.test(h.name || '');
  const isPhoto = /\.(jpg|jpeg|png|heic|heif|webp|bmp|gif)$/i.test(h.name || '');
  if (isVideo) {
    handlePlayVideo({ name: h.name, path: full, size: h.size, type: 'video' });
  } else if (isPhoto) {
    activeMedia.value = {
      name: h.name, path: full, size: h.size, type: 'photo',
      previewUrl: `/api/thumbnail?path=${encodeURIComponent(full)}&size=preview`,
    };
  } else {
    handlePreviewDoc({ name: h.name, path: full, size: h.size, type: 'doc' });
  }
}

async function openFileDetail(file) {
  detailInfo.value = null;
  activeDialog.value = {
    title: '文件详情',
    icon: 'ℹ️',
    type: 'fileDetail',
    desc: '来自 NAS filemgr/get_detail_info 接口',
  };
  try {
    const r = await nasQuery('filemgr/get_detail_info', { path: [file.path] });
    const info = r?.data?.info || {};
    detailInfo.value = { ...info, type: r?.data?.type || '' };
    if (r.status === 'error' && !detailInfo.value.name) {
      detailInfo.value = { name: file.name, path: file.path, size: file.size, modified_time: file.modified_time };
    }
  } catch (e) {
    detailInfo.value = { name: file.name, path: file.path, size: file.size, modified_time: file.modified_time };
  }
}

// 打开影视墙：先向网关要真实的插件代理地址（官方 URL 带 token，不能直接拼）
async function openMediaCenter() {
  try {
    const res = await fetch('/api/mediacenter/url');
    const data = await res.json();
    if (data.status === 'ok' && data.data?.proxied) {
      mediaCenterUrl.value = data.data.proxied;
    } else {
      mediaCenterError.value = data.message || '未取到影视墙地址';
      mediaCenterUrl.value = '';
    }
  } catch (e) {
    mediaCenterError.value = '无法连接网关: ' + e.message;
    mediaCenterUrl.value = '';
  }
  showMediaModal.value = true;
}

function handleLaunchApp(app) {
  if (app.plugin === 'mediacenter') {
    openMediaCenter();
  } else if (app.name === '相册') {
    activeDialog.value = {
      title: 'AI 智能相册',
      icon: '🖼️',
      type: 'album',
      desc: '真实相册数据来自 NAS album 接口（list_album / list_member）'
    };
    openAlbum();
  } else if (app.name === '文件') {
    showFileExplorer.value = true;
  } else if (app.name === '用户管理') {
    activeDialog.value = {
      title: '家庭成员共享与权限分配',
      icon: '👥',
      desc: '官方 LuCI 仅开放 user_list 只读接口，未提供成员增删与权限修改能力。',
      items: storageData.value.uid
        ? [{ name: `当前登录账号 (UID: ${mask(storageData.value.uid, 'uid')})`, sub: '来自 NAS user_list 接口', detail: '管理员' }]
        : []
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
      desc: '文件传输与后台任务的真实进度、速率与结果（数据来自 NAS 任务中心接口）'
    };
    // 打开即拉取，默认看进行中的任务
    taskTab.value = 'running';
    loadTasks('running');
  } else if (app.name === '保险箱') {
    activeDialog.value = {
      title: '加密保险箱',
      icon: '🔐',
      desc: '官方 LuCI 未开放保险箱文件索引接口，网页版无法列出其中的加密文件。',
      items: []
    };
    // 顺带查一次保险箱状态（只读），有内容就显示出来
    nasQuery('safebox/get_safebox_info').then(r => {
      const d = r?.data;
      if (d && activeDialog.value?.type !== 'task') {
        activeDialog.value.items = [
          { name: '保险箱状态', sub: 'safebox/get_safebox_info', detail: JSON.stringify(d).slice(0, 80) }
        ];
      }
    }).catch(() => {});
  } else if (app.name === '回收站') {
    activeDialog.value = {
      title: '回收站',
      icon: '🗑️',
      desc: 'NAS 的 filemgr/get_trashes 在本机固件上固定返回 5000（接口未开放），网页版无法浏览回收站。',
      items: []
    };
  } else {
    activeDialog.value = {
      title: `${app.name} 小程序`,
      icon: '📦',
      desc: app.desc || '米家智能存储已启用该扩展组件',
      items: [
        { name: '运行状态', detail: app.installed ? '已安装' : '未安装' },
        { name: '分类模式', detail: app.category || '扩展应用' }
      ]
    };
  }
}

// 预览多媒体大图与视频
function handlePreviewMedia(file) {
  resetImageTransform();
  isImageViewerFullscreen.value = false;
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
  // 加载本地专属主题配置与壁纸
  loadThemeConfig();
  await loadStoredWallpaper();
  applyTheme();

  // 清除旧版本遗留的模拟假数据缓存，强制直通真实 NAS
  if (typeof window !== 'undefined') {
    localStorage.removeItem('mijia_cache_files');
  }

  loadAllData();
  startEventStream();
  // 每 8 秒自动轮询一次网络状态与硬件探针
  timer = setInterval(loadAllData, 8000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  if (eventSource) { eventSource.close(); eventSource = null; }
});
</script>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--mi-bg);
  position: relative;
}

/* 客户端本地动态壁纸背景层 */
.app-bg-layer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  z-index: 0;
  pointer-events: none;
  transition: filter 0.3s ease, opacity 0.3s ease;
}

.app-bg-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 1;
  pointer-events: none;
}

.top-header, .main-content, .app-footer {
  position: relative;
  z-index: 2;
}

.power-tag {
  color: var(--mi-orange);
  font-weight: 700;
  font-size: 12px;
  background: rgba(255, 103, 0, 0.08);
  padding: 3px 8px;
  border-radius: 6px;
}

.main-content {
  flex: 1;
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 32px 40px;
}

/* 实时推送通知条 */
.notify-stack {
  position: fixed;
  top: 70px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 900;
}

.notify-item {
  background: #1e293b;
  color: #f8fafc;
  font-size: 12px;
  font-weight: 600;
  padding: 10px 16px;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.25);
  animation: fadeIn 0.2s ease-out;
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

/* 苏俄构成主义报头横幅 (Gazette Masthead) */
.constructivist-gazette-masthead {
  max-width: 1440px;
  margin: 16px auto 0;
  padding: 0 32px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
  z-index: 2;
}

.gazette-flag {
  display: inline-block;
  background: #d92027;
  color: #ffffff;
  font-family: Impact, "Arial Black", sans-serif;
  font-size: 13px;
  letter-spacing: 2px;
  padding: 4px 12px;
  width: fit-content;
  border: 2px solid #0a0a0a;
  box-shadow: 3px 3px 0px #0a0a0a;
  transform: rotate(-1deg);
}

.gazette-headline {
  display: flex;
  align-items: center;
  gap: 14px;
  border-top: 4px solid #0a0a0a;
  border-bottom: 2px solid #0a0a0a;
  padding: 10px 0;
  background: #f4f1ea;
  border-left: 8px solid #0a0a0a;
  border-right: 8px solid #0a0a0a;
  padding-left: 14px;
  padding-right: 14px;
}

.gazette-stamp {
  background: #0a0a0a;
  color: #f4f1ea;
  font-family: Impact, "Arial Black", sans-serif;
  font-size: 16px;
  padding: 4px 8px;
  letter-spacing: 1px;
}

.gazette-headline h2 {
  font-family: Impact, "Franklin Gothic Heavy", "Arial Black", sans-serif;
  font-size: 24px;
  letter-spacing: 1px;
  color: #0a0a0a;
  text-transform: uppercase;
  flex: 1;
}

.gazette-slogan {
  font-family: Impact, "Arial Black", sans-serif;
  font-size: 14px;
  color: #d92027;
  letter-spacing: 1px;
}

.gazette-meta-strip {
  display: flex;
  gap: 12px;
  font-family: monospace;
  font-size: 11px;
  font-weight: 700;
  color: #0a0a0a;
  background: #f4f1ea;
  border: 2px solid #0a0a0a;
  padding: 4px 12px;
  border-top: none;
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
  background: var(--mi-card-bg, white);
  border-radius: var(--mi-radius-lg);
  display: flex;
  flex-direction: column;
  box-shadow: var(--mi-shadow-hover);
  overflow: hidden;
  border: 1px solid var(--mi-border);
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

/* 功能在官方 API 中不存在时的说明块，避免用户误以为页面坏了 */
.unavailable-note {
  font-size: 12px;
  line-height: 1.7;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: var(--mi-radius-md);
  padding: 12px 16px;
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
.set-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f8fafc;
  border-radius: var(--mi-radius-md);
  margin-bottom: 8px;
  border: 1px solid var(--mi-border);
  font-size: 13px;
}

.set-row span { color: var(--mi-text-sub); }
.set-row b { color: var(--mi-text-main); font-weight: 600; }

/* 相册视图 */
.album-head {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 16px;
  max-height: 50vh;
}

.album-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  max-height: 50vh;
}

.album-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid var(--mi-border);
  font-size: 12px;
  text-align: left;
  transition: all 0.15s;
}

.album-item:hover { background: #f1f5f9; }
.album-item.active { background: #fff7ed; border-color: var(--mi-orange); color: var(--mi-orange); font-weight: 600; }

.album-item .a-name { font-weight: 600; }
.album-item .a-count { font-size: 10px; color: #94a3b8; }

.album-photos { overflow-y: auto; max-height: 50vh; }

.album-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
}

.aph {
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: #f1f5f9;
  cursor: pointer;
  border: 1px solid var(--mi-border);
}

.aph img { width: 100%; height: 100%; object-fit: cover; }
.aph:hover { border-color: var(--mi-orange); }

/* 文件详情 */
.detail-grid { display: flex; flex-direction: column; gap: 8px; }

.d-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 14px;
  background: #f8fafc;
  border-radius: var(--mi-radius-md);
  border: 1px solid var(--mi-border);
  font-size: 13px;
}

.d-row span { color: var(--mi-text-sub); flex-shrink: 0; }
.d-row b { color: var(--mi-text-main); font-weight: 600; text-align: right; word-break: break-all; }
.d-path { font-family: monospace; font-size: 11px; }

.hist-card { cursor: pointer; }
.hist-card:hover { border-color: var(--mi-orange); }

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

.task-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.task-tab {
  font-size: 12px;
  font-weight: 600;
  padding: 5px 14px;
  border-radius: 14px;
  background: #f1f5f9;
  color: var(--mi-text-sub);
  transition: all 0.2s;
}

.task-tab.active {
  background: var(--mi-orange);
  color: #fff;
}

.task-refresh {
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 14px;
  border-radius: 14px;
  border: 1px solid var(--mi-border);
  color: var(--mi-text-sub);
  background: #fff;
}

.task-refresh:disabled {
  opacity: 0.55;
}

.task-summary {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--mi-text-sub);
  background: #f8fafc;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-md);
  padding: 10px 14px;
  margin-bottom: 12px;
}

.task-summary b {
  color: var(--mi-text-main);
}

.task-empty {
  font-size: 12px;
  color: var(--mi-text-sub);
  text-align: center;
  padding: 24px 0;
}

.task-list {
  max-height: 46vh;
  overflow-y: auto;
}

.t-fill.red {
  background: #ef4444;
}

.t-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 62%;
}

.t-status {
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.t-bot {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 11px;
  color: var(--mi-text-sub);
}

.text-red {
  color: #dc2626;
}

.text-orange {
  color: #ea580c;
}

.text-muted {
  color: var(--mi-text-sub);
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
  max-width: 1080px;
  background: #1e293b;
  border-radius: var(--mi-radius-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.media-viewer-box.fullscreen-box {
  width: 98vw;
  max-width: 98vw;
  height: 96vh;
}

.media-viewer-box.fullscreen-box .viewer-body {
  max-height: 84vh;
  min-height: 84vh;
}

.media-viewer-box.fullscreen-box .viewer-img,
.media-viewer-box.fullscreen-box .viewer-video {
  max-height: 84vh;
}

.viewer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: #0f172a;
  color: white;
}

.viewer-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.08);
  padding: 4px 10px;
  border-radius: 20px;
}

.tb-btn {
  background: transparent;
  color: #e2e8f0;
  border: none;
  font-size: 14px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.tb-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #ffffff;
}

.zoom-text {
  font-size: 11px;
  font-family: monospace;
  color: #ff8533;
  min-width: 40px;
  text-align: center;
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
  min-height: 440px;
  max-height: 68vh;
  overflow: hidden;
  position: relative;
  user-select: none;
}

.viewer-img {
  max-width: 100%;
  max-height: 68vh;
  object-fit: contain;
  transition: transform 0.15s ease-out;
  transform-origin: center center;
}

.viewer-img.is-dragging {
  transition: none;
}

/* HEIC 专属预览卡片 */
.heic-preview-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  background: radial-gradient(circle at center, #1e1b4b 0%, #0f172a 100%);
  border-radius: var(--mi-radius-md);
  color: white;
  text-align: center;
  border: 1px solid rgba(139, 92, 246, 0.2);
  margin: 20px;
}

.heic-icon {
  font-size: 54px;
  margin-bottom: 12px;
  filter: drop-shadow(0 4px 12px rgba(139, 92, 246, 0.4));
}

.heic-preview-box h3 {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 6px;
  color: #c4b5fd;
}

.heic-preview-box p {
  font-size: 13px;
  color: #94a3b8;
  margin-bottom: 6px;
}

.heic-tip {
  font-size: 12px;
  color: #64748b;
  max-width: 420px;
  margin-bottom: 20px !important;
}

.heic-dl-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: #8b5cf6;
  color: white;
  padding: 10px 24px;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.2s;
  box-shadow: 0 4px 14px rgba(139, 92, 246, 0.4);
}

.heic-dl-btn:hover {
  background: #7c3aed;
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(139, 92, 246, 0.5);
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
