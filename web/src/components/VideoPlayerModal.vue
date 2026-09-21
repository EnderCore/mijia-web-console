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

        <!-- 解码失败/自动兜底提示：此前失败时界面毫无反馈，
             用户只看到黑屏，连「能不能切转码流」都不知道 -->
        <div v-if="playerError" class="player-error-toast">
          <span class="err-icon">⚠️</span>
          <span class="err-text">{{ playerError }}</span>
          <button
            v-if="qualityOptions.length > 1"
            class="err-action"
            @click="selectQuality(qualityOptions.find(q => q.key !== 'origin') || qualityOptions[0])"
          >切换转码流</button>
          <button v-else class="err-action" @click="reloadCurrent">重试</button>
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
const playerError = ref('');
const subtitleList = ref([]);
const currentSubtitle = ref(null);
let taskId = null;
// 原画解码失败后是否已经尝试过转码兜底，防止两个档位互相切换形成死循环
let triedFallback = false;

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

/**
 * 按真实扩展名给出 MIME 类型。
 *
 * 之前这里对所有非 HLS 源一律声明 'video/mp4'，但 MKV / AVI / RMVB / TS
 * 并不是 MP4 容器，video.js 的 MSE 会按错误容器去解析，导致起播失败。
 * 起播失败又会让 has-started 永不置位（见下方控制条说明），
 * 于是「视频打不开 + 连进度条都没有」同时发生。
 */
function mimeForVideo(pathStr) {
  const ext = String(pathStr || '').toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
  const table = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    ogv: 'video/ogg',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    ts: 'video/mp2t',
    m2ts: 'video/mp2t',
    flv: 'video/x-flv',
    rmvb: 'application/vnd.rn-realmedia-vbr',
    rm: 'application/vnd.rn-realmedia',
    mpg: 'video/mpeg',
    mpeg: 'video/mpeg',
    m3u8: 'application/x-mpegURL'
  };
  return table[ext?.[1]] || 'video/mp4';
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
  playerError.value = '';
  player.src({
    src: streamUrlFor(q),
    type: isHls ? 'application/x-mpegURL' : mimeForVideo(props.video?.path)
  });

  player.ready(() => {
    player.currentTime(currentTime);
    if (!isPaused) {
      player.play().catch(() => {});
    }
  });
}

/**
 * 重试当前档位。
 * NAS 隧道断开或网关临时 500 时，重新加载流地址即可恢复，
 * 不需要用户关闭播放器再重新打开。
 */
function reloadCurrent() {
  if (!player) return;
  playerError.value = '';
  triedFallback = false;
  const q = currentQuality.value;
  const isHls = /\.m3u8(\?|$)/i.test(q.url || '');
  player.src({
    src: streamUrlFor(q),
    type: isHls ? 'application/x-mpegURL' : mimeForVideo(props.video?.path)
  });
  player.play().catch(() => {});
}

// 初始化播放器
async function initPlayer() {
  await nextTick();
  if (!videoEl.value) return;

  resolutionError.value = '';
  playerError.value = '';
  triedFallback = false;
  qualityOptions.value = [qualityOptions.value[0]];
  currentQuality.value = qualityOptions.value[0];

  // 原画直连可立即开播，转码档位在后台异步补齐
  player = videojs(videoEl.value, {
    controls: true,
    autoplay: true,
    fluid: true,
    // 用自带的自定义错误面板替代 video.js 的英文弹层：
    // 那个弹层写死了深色样式、且文案是 MEDIA_ERR 的英文映射，
    // 既不适配主题也没法告诉用户「可以切转码流」。
    errorDisplay: false,
    playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
    sources: [{
      src: originStreamUrl(),
      type: mimeForVideo(props.video?.path)
    }]
  });

  player.on('error', handlePlaybackError);

  // 控制条默认要等 `playing` 才显示（vjs-has-started）。
  // 但「自动播放被浏览器拦截」「用户想先拖着看看」这类情况下并不会触发 playing，
  // 结果就是元数据都加载完了、时长也有了，界面上却连进度条都看不到。
  // 一旦确定能播（拿到时长），就主动把控制条显出来，
  // 让用户至少能看到时间轴并手动点播放。
  player.on('loadedmetadata', () => {
    if (player && player.duration() > 0) {
      player.hasStarted(true);
    }
  });

  await loadResolutions();
  loadSubtitles();
}

/**
 * 播放失败处理。
 *
 * 背景：NAS 里的片源格式很杂（MKV/AVI/RMVB 容器、HEVC 编码等），
 * 浏览器原生解不了。过去这里不做任何处理，表现为「转圈后一直黑屏、
 * 连进度条都没有」——因为 video.js 的控制条要等 has-started 才显示，
 * 起播失败就永远不会出现，用户既看不到错误也不知道能做什么。
 *
 * 现在的策略：
 *   1. 原画解不了且 NAS 提供了转码档位 → 自动切到转码流（转码的意义就在此）
 *   2. 连转码都没有 → 明确告知失败原因与格式，而不是留下一个空壳播放器
 */
function handlePlaybackError() {
  const err = player?.error();
  if (!err) return;

  const isOrigin = currentQuality.value?.key === 'origin';
  const fallback = qualityOptions.value.find((q) => q.key !== 'origin');

  // 只在「原画失败」时兜底一次，避免两个档位互相踢来踢去造成死循环
  if (isOrigin && fallback && !triedFallback) {
    triedFallback = true;
    playerError.value = `原画无法直接解码，正在切换至 [${fallback.label}] 转码流…`;
    selectQuality(fallback);
    return;
  }

  const ext = (props.video?.path || '').split('.').pop()?.toUpperCase() || '';
  const reasons = {
    1: '播放已中止',
    2: '网络中断，无法继续加载该视频',
    3: '视频数据损坏或编码无法解码'
  };
  // 注意：错误码 4 同时覆盖「格式不受支持」和「服务端没给出可用数据」
  // （网关 500、隧道断开都会落到这里）。不能一口咬定是格式问题，
  // 否则会把 NAS 掉线误报成浏览器不支持，把用户引向错误的方向。
  playerError.value =
    reasons[err.code] ||
    `无法播放该视频${ext ? `（${ext}）` : ''}：可能是浏览器不支持其编码，或 NAS 未返回有效数据`;
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
  /* 灯箱遮罩：无论浅色还是深色主题都必须压暗，才能把注意力集中到画面上 */
  background: var(--mi-player-scrim, rgba(10, 14, 24, 0.88));
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
  background: var(--mi-card-bg);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.7);
  border: 1px solid var(--mi-card-border);
}

/* 外壳（标题栏 / 底部信息栏）跟随主题。
   此前这里写死 #090e1a，浅色主题下 --mi-text-main(#1f2329)
   压在这个深底上只有 1.22:1，标题与路径几乎看不见。 */
.player-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: var(--mi-player-shell-bg, var(--mi-card-bg));
  color: var(--mi-player-shell-text);
  border-bottom: 1px solid var(--mi-card-border);
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
  color: var(--mi-player-shell-text, var(--mi-text-main));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 500px;
}

.file-badge {
  font-size: 11px;
  background: var(--mi-accent-soft);
  color: var(--mi-accent-text);
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
  background: var(--mi-control-bg-glass, rgba(255, 255, 255, 0.72));
  color: var(--mi-control-text, var(--mi-text-main));
  border: 1px solid var(--mi-control-border-glass, var(--mi-card-border));
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
  background: var(--mi-accent-soft);
  border-color: var(--mi-accent-text);
  color: var(--mi-accent-text-on-soft, var(--mi-accent-text));
}

.arrow {
  font-size: 9px;
  opacity: 0.6;
}

.res-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background: var(--mi-card-bg);
  border: 1px solid var(--mi-card-border);
  border-radius: 12px;
  padding: 6px;
  min-width: 190px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
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
  background: var(--mi-control-sub-bg);
}

.res-item.active {
  background: var(--mi-accent-soft);
}

.res-item.active .q-label {
  color: var(--mi-accent-text-on-soft, var(--mi-accent-text));
  font-weight: 700;
}

.q-label {
  font-size: 13px;
  color: var(--mi-text-main);
}

.q-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--mi-control-sub-bg);
  color: var(--mi-text-sub);
}

.q-badge.硬件加速 {
  background: var(--mi-status-green-soft);
  color: var(--mi-status-green);
}

.close-btn {
  font-size: 18px;
  color: var(--mi-player-shell-text-sub, var(--mi-text-sub));
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--mi-control-sub-bg);
  color: var(--mi-player-shell-text, var(--mi-text-main));
}

.player-body {
  position: relative;
  /* 视频自适应黑边区域：画面的垫底，固定纯黑才正确 */
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
  background: var(--mi-player-scrim, rgba(10, 14, 24, 0.88));
  border: 1px solid var(--mi-accent-soft);
  color: var(--mi-player-scrim-text, #ffffff);
  padding: 8px 18px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  backdrop-filter: blur(8px);
  z-index: 50;
  animation: fadeIn 0.2s ease-out;
}

/* 解码失败提示：压在视频画面之上，所以用固定的深色遮罩 + 高对比文字 */
.player-error-toast {
  position: absolute;
  bottom: 84px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 82%;
  background: var(--mi-player-scrim, rgba(10, 14, 24, 0.88));
  border: 1px solid var(--mi-status-orange);
  border-radius: 12px;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-player-scrim-text, #ffffff);
  backdrop-filter: blur(8px);
  z-index: 60;
  animation: fadeIn 0.2s ease-out;
}

.player-error-toast .err-icon {
  font-size: 15px;
  flex-shrink: 0;
}

.player-error-toast .err-text {
  min-width: 0;
}

.err-action {
  flex-shrink: 0;
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  background: var(--mi-orange);
  color: var(--mi-on-accent);
  border: none;
  cursor: pointer;
}

.player-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  background: var(--mi-player-shell-bg, var(--mi-card-bg));
  border-top: 1px solid var(--mi-card-border);
  font-size: 12px;
  color: var(--mi-player-shell-text-sub, var(--mi-text-sub));
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.footer-left b {
  color: var(--mi-status-cyan);
}

.path-code {
  font-family: monospace;
  background: var(--mi-control-sub-bg);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--mi-text-sub);
}

.dot {
  opacity: 0.4;
}

.res-warn {
  color: var(--mi-status-orange);
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}
</style>
