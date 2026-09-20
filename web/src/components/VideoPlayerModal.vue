<template>
  <div v-if="visible" class="player-backdrop" @click.self="handleClose">
    <div class="player-container">
      <!-- 播放器顶部标题栏与分辨率控制 -->
      <div class="player-header">
        <div class="player-title">
          <span class="icon">🎬</span>
          <span class="file-name" :title="video?.name">{{ video?.name || '视频播放' }}</span>
          <span v-if="video?.size" class="file-badge">{{ formatSize(video.size) }}</span>
        </div>

        <div class="header-controls">
          <!-- 字幕选择：来自 NAS player/subtitle_get_list，空列表时隐藏 -->
          <div v-if="subtitleList.length > 0" class="resolution-dropdown">
            <button class="res-btn" @click="showSubMenu = !showSubMenu">
              <span class="current-res">💬 {{ currentSubtitle ? currentSubtitle.name : '字幕' }}</span>
              <span class="arrow">▼</span>
            </button>
            <div v-if="showSubMenu" class="res-menu">
              <div
                class="res-item" :class="{ active: !currentSubtitle }"
                @click="selectSubtitle(null)"
              ><span class="q-label">关闭字幕</span></div>
              <div
                v-for="(s, i) in subtitleList" :key="i"
                class="res-item" :class="{ active: currentSubtitle === s }"
                @click="selectSubtitle(s)"
              >
                <span class="q-label">{{ s.name || s.path?.split('/').pop() || '字幕 ' + (i+1) }}</span>
                <span class="q-badge">{{ s.type || s.language || '' }}</span>
              </div>
            </div>
          </div>

          <!-- 分辨率切换器：档位来自 NAS 转码接口，取不到时只保留原画 -->
          <div class="resolution-dropdown">
            <button class="res-btn" @click="showResMenu = !showResMenu">
              <span class="current-res">{{ currentQuality.label }}</span>
              <span class="arrow">▼</span>
            </button>
            <div v-if="showResMenu" class="res-menu">
              <div 
                v-for="q in qualityOptions" 
                :key="q.key" 
                class="res-item"
                :class="{ active: currentQuality.key === q.key }"
                @click="selectQuality(q)"
              >
                <span class="q-label">{{ q.label }}</span>
                <span class="q-badge" :class="q.type">{{ q.badge }}</span>
              </div>
            </div>
          </div>

          <button class="close-btn" @click="handleClose" title="关闭">✕</button>
        </div>
      </div>

      <!-- 视频播放主体 -->
      <div class="player-body">
        <video
          ref="videoEl"
          class="video-js vjs-default-skin vjs-big-play-centered"
          controls
          preload="auto"
          playsinline
        ></video>

        <!-- 播放器悬浮转码状态提示 -->
        <div v-if="transcodingNotice" class="transcode-toast">
          <span>⚡ {{ transcodingNotice }}</span>
        </div>
      </div>

      <!-- 底部播放信息栏 -->
      <div class="player-footer">
        <div class="footer-left">
          <span>模式: <b>{{ currentQuality.sourceType }}</b></span>
          <span class="dot">·</span>
          <span>路径: <code class="path-code">{{ mask(video?.path || video?.name, 'path') }}</code></span>
        </div>
        <div class="footer-right">
          <span v-if="resolutionError" class="res-warn">{{ resolutionError }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { maskValue } from '../utils/privacy.js';

function mask(v, kind) {
  return maskValue(v, kind);
}
import videojs from 'video.js';
import 'video.js/dist/video-js.css';

const props = defineProps({
  visible: { type: Boolean, default: false },
  video: { type: Object, default: null }
});

const emit = defineEmits(['close']);

const videoEl = ref(null);
let player = null;
const showResMenu = ref(false);
const showSubMenu = ref(false);
const transcodingNotice = ref('');
const resolutionError = ref('');
const subtitleList = ref([]);
const currentSubtitle = ref(null);
let taskId = null;

// 拉取该视频的外挂字幕列表（player/subtitle_get_list，参数是 video_path）
async function loadSubtitles() {
  const p = props.video?.path;
  if (!p) return;
  try {
    const res = await fetch('/api/query?ep=player/subtitle_get_list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_path: p }),
    });
    const data = await res.json();
    subtitleList.value = Array.isArray(data?.data?.subtitle_list) ? data.data.subtitle_list : [];
  } catch (e) {
    subtitleList.value = [];
  }
}

// 选中字幕后以 <track> 形式挂到 video 元素；字幕文件经 WebDAV 走 /api/stream
function selectSubtitle(s) {
  currentSubtitle.value = s;
  showSubMenu.value = false;
  const el = videoEl.value;
  if (!el) return;
  // 清掉旧 track
  for (const t of Array.from(el.querySelectorAll('track'))) t.remove();
  if (!s) return;
  const subPath = s.path || s.subtitle_path || '';
  if (!subPath) return;
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = s.name || subPath.split('/').pop();
  track.srclang = s.language || 'zh';
  track.src = `/api/stream?path=${encodeURIComponent(subPath)}`;
  track.default = true;
  el.appendChild(track);
}

// 分辨率档位。原画始终可用（直接走 /api/stream 的 206 流），
// 其余档位只有 NAS 的 transcode_get_resolution 真的返回了对应清晰度才加进来——
// 否则切档只是换个标签、播放同一个 URL，属于欺骗用户。
const qualityOptions = ref([
  { key: 'origin', label: '原画 (直连)', badge: '原始码率', sourceType: 'NAS 直连 206 流', url: '' }
]);

const currentQuality = ref(qualityOptions.value[0]);

function formatSize(bytes) {
  const b = parseInt(bytes, 10);
  if (!b) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

// 直接播放原画的流地址
function originStreamUrl() {
  return `/api/stream?path=${encodeURIComponent(props.video?.path || '')}`;
}

// 档位对应的播放地址：HLS 档位用 NAS 给的 m3u8，原画用网关的 206 流
function streamUrlFor(q) {
  return q.url || originStreamUrl();
}

// 向 NAS 申请转码任务并拉取真实可用清晰度
async function loadResolutions() {
  const p = props.video?.path;
  if (!p) return;

  try {
    const res = await fetch(`/api/video/task?action=create&path=${encodeURIComponent(p)}`);
    const data = await res.json();
    if (data.status !== 'ok' || !data.taskId) {
      resolutionError.value = 'NAS 未提供转码任务，仅可播放原画';
      return;
    }
    taskId = data.taskId;

    const rres = await fetch(`/api/video/task?action=resolutions&taskId=${encodeURIComponent(taskId)}&path=${encodeURIComponent(p)}`);
    const rdata = await rres.json();
    const list = rdata?.data?.resolutionList || [];

    if (!Array.isArray(list) || list.length === 0) {
      resolutionError.value = 'NAS 未返回可选清晰度，仅可播放原画';
      return;
    }

    // 官方结构：resolution_list[].url_list[].m3u8_url
    // 每一项可能带多个 url_list 子项，逐个展开成档位。
    const extra = [];
    for (const r of list) {
      const urls = Array.isArray(r.url_list) ? r.url_list : [];
      for (const u of urls) {
        const url = u.m3u8_url || u.url || '';
        if (!url) continue;
        const h = parseInt(r.height || r.resolution || 0, 10);
        extra.push({
          key: `r${h || extra.length}-${url.slice(-12)}`,
          label: r.name || (h ? `${h}P` : '转码流'),
          badge: 'NAS 转码',
          sourceType: r.codec ? `转码流 (${r.codec})` : 'NAS 转码流',
          url
        });
      }
    }

    if (extra.length === 0) {
      resolutionError.value = 'NAS 未返回可播放的转码地址，仅可播放原画';
      return;
    }
    qualityOptions.value = [qualityOptions.value[0], ...extra];
  } catch (e) {
    resolutionError.value = '转码接口不可用，仅可播放原画';
  }
}

// 切换分辨率
async function selectQuality(q) {
  currentQuality.value = q;
  showResMenu.value = false;

  if (!player) return;

  const currentTime = player.currentTime();
  const isPaused = player.paused();

  transcodingNotice.value = `已切换至 [${q.label}]`;
  setTimeout(() => { transcodingNotice.value = ''; }, 2500);

  // 换源并保留播放进度
  const isHls = /\.m3u8(\?|$)/i.test(q.url || '');
  player.src({
    src: streamUrlFor(q),
    type: isHls ? 'application/x-mpegURL' : 'video/mp4'
  });

  player.ready(() => {
    player.currentTime(currentTime);
    if (!isPaused) {
      player.play().catch(() => {});
    }
  });
}

// 初始化播放器
async function initPlayer() {
  await nextTick();
  if (!videoEl.value) return;

  resolutionError.value = '';
  qualityOptions.value = [qualityOptions.value[0]];
  currentQuality.value = qualityOptions.value[0];

  // 原画直连可立即开播，转码档位在后台异步补齐
  player = videojs(videoEl.value, {
    controls: true,
    autoplay: true,
    fluid: true,
    playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
    sources: [{
      src: originStreamUrl(),
      type: 'video/mp4'
    }]
  });

  await loadResolutions();
  loadSubtitles();
}

function handleClose() {
  if (player) {
    player.dispose();
    player = null;
  }
  // 销毁 NAS 硬件端任务
  if (taskId) {
    fetch(`/api/video/task?action=destroy&taskId=${taskId}`).catch(() => {});
    taskId = null;
  }
  emit('close');
}

watch(() => props.visible, (val) => {
  if (val && props.video) {
    initPlayer();
  } else if (!val && player) {
    player.dispose();
    player = null;
  }
});

onBeforeUnmount(() => {
  if (player) {
    player.dispose();
    player = null;
  }
  if (taskId) {
    fetch(`/api/video/task?action=destroy&taskId=${taskId}`).catch(() => {});
    taskId = null;
  }
});
</script>

<style scoped>
.player-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(10, 15, 29, 0.85);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1300;
  animation: fadeIn 0.25s ease-out;
}

.player-container {
  width: 88vw;
  max-width: 1180px;
  background: #0f172a;
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.player-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: #090e1a;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.player-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.player-title .icon {
  font-size: 20px;
}

.file-name {
  font-size: 15px;
  font-weight: 700;
  color: #f8fafc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 500px;
}

.file-badge {
  font-size: 11px;
  background: rgba(255, 103, 0, 0.15);
  color: #ff6700;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 600;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 16px;
  position: relative;
}

.resolution-dropdown {
  position: relative;
}

.res-btn {
  background: rgba(255, 255, 255, 0.08);
  color: #f8fafc;
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
}

.res-btn:hover {
  background: rgba(255, 103, 0, 0.2);
  border-color: #ff6700;
  color: #ff8533;
}

.arrow {
  font-size: 9px;
  opacity: 0.6;
}

.res-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background: #1e293b;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 6px;
  min-width: 190px;
  box-shadow: 0 12px 30px rgba(0,0,0,0.5);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.res-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.res-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.res-item.active {
  background: rgba(255, 103, 0, 0.2);
}

.res-item.active .q-label {
  color: #ff6700;
  font-weight: 700;
}

.q-label {
  font-size: 13px;
  color: #e2e8f0;
}

.q-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: #94a3b8;
}

.q-badge.硬件加速 {
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
}

.close-btn {
  font-size: 18px;
  color: #94a3b8;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.player-body {
  position: relative;
  background: #000000;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 480px;
  max-height: 70vh;
}

.video-js {
  width: 100%;
  height: 100%;
  max-height: 70vh;
}

.transcode-toast {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(255, 103, 0, 0.5);
  color: #ff8533;
  padding: 8px 18px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  backdrop-filter: blur(8px);
  z-index: 50;
  animation: fadeIn 0.2s ease-out;
}

.player-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  background: #090e1a;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px;
  color: #94a3b8;
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.footer-left b {
  color: #38bdf8;
}

.path-code {
  font-family: monospace;
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 6px;
  border-radius: 4px;
  color: #cbd5e1;
}

.dot {
  opacity: 0.4;
}

.res-warn {
  color: #fbbf24;
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}
</style>
