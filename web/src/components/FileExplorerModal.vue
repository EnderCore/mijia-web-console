<template>
  <div v-if="visible" class="explorer-backdrop" @click.self="$emit('close')">
    <div class="explorer-modal">
      <!-- 头部导航与操作栏 -->
      <div class="explorer-header">
        <div class="header-left">
          <span class="icon">📁</span>
          <h4>全功能文件管理器</h4>
          <span class="path-badge">{{ mask(currentPath, 'path') }}</span>
        </div>

        <div class="header-right">
          <!-- 搜索框 -->
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input 
              v-model="searchKeyword" 
              placeholder="快速过滤文件..." 
              class="search-input"
            />
          </div>

          <!-- 上传与新建操作 -->
          <button class="action-pill" @click="$emit('open-history')" title="最近打开的文件">
            <span>🕐</span><span>最近打开</span>
          </button>
          <button class="action-pill upload-pill" @click="triggerFilePick" :disabled="uploading">
            <span>{{ uploading ? '⏳' : '📤' }}</span>
            <span>{{ uploading ? uploadProgress + '%' : '上传' }}</span>
          </button>
          <button class="action-pill" @click="handleMkdir" title="在当前目录新建文件夹">
            <span>📁</span><span>新建文件夹</span>
          </button>
          <input
            ref="fileInputRef"
            type="file"
            multiple
            class="hidden-input"
            @change="handleUpload"
          />

          <!-- 视图切换 (网格 / 列表) -->
          <div class="view-toggle">
            <button 
              class="v-btn" 
              :class="{ active: viewMode === 'grid' }"
              @click="viewMode = 'grid'"
              title="网格视图"
            >⊞</button>
            <button 
              class="v-btn" 
              :class="{ active: viewMode === 'list' }"
              @click="viewMode = 'list'"
              title="列表视图"
            >☰</button>
          </div>

          <button class="close-x" @click="$emit('close')">✕</button>
        </div>
      </div>

      <!-- 上传进度条 -->
      <div v-if="uploading" class="upload-bar">
        <div class="upload-fill" :style="{ width: uploadProgress + '%' }"></div>
        <span class="upload-text">正在上传 {{ uploadingName }} · {{ uploadProgress }}%</span>
      </div>

      <!-- 操作结果提示 -->
      <div v-if="toast" class="toast-msg" :class="toastType">{{ toast }}</div>

      <!-- 主体区域：左侧目录树导航 + 右侧文件内容流 -->
      <div class="explorer-body">
        <!-- 左侧快捷目录树 -->
        <aside class="sidebar-tree">
          <div class="tree-section-title">存储空间根目录</div>
          <div 
            v-for="cat in categories" 
            :key="cat.key" 
            class="tree-item"
            :class="{ active: activeCategory === cat.key }"
            @click="activeCategory = cat.key"
          >
            <span class="t-icon">{{ cat.icon }}</span>
            <span class="t-name">{{ cat.name }}</span>
            <span class="t-count">{{ getCategoryCount(cat.key) }}</span>
          </div>

          <div class="tree-divider"></div>
          <div class="tree-section-title">当前目录</div>
          <div class="mount-box">
            <div class="mount-label">文件总数</div>
            <div class="mount-val">{{ displayFiles.length }} 项</div>
            <div class="mount-sub">
              其中视频 {{ getCategoryCount('video') }} · 图片 {{ getCategoryCount('photo') }}
            </div>
          </div>
        </aside>

        <!-- 右侧文件展示区 -->
        <main class="content-area">
          <!-- 工具栏：面包屑路径 + 排序方式 -->
          <div class="breadcrumb-bar">
            <div class="crumbs">
              <span class="crumb-root" @click="navigateTo(ROOT_PATH)">🏠 根目录</span>
              <template v-for="(seg, idx) in pathSegments" :key="idx">
                <span class="crumb-sep">/</span>
                <span 
                  class="crumb-seg" 
                  :class="{ 'crumb-cur': idx === pathSegments.length - 1 }"
                  @click="navigateTo(seg.fullPath)"
                >{{ seg.name }}</span>
              </template>
            </div>
            
            <div class="bar-actions">
              <button 
                v-if="pathStack.length > 1" 
                class="up-btn" 
                @click="navigateUp"
                title="返回上一级"
              >
                ⬆ 返回上一级
              </button>
              <div class="file-summary">
                共 <b>{{ displayFiles.length }}</b> 个项目
              </div>
            </div>
          </div>

          <!-- 网格卡片视图 -->
          <div v-if="viewMode === 'grid'" class="files-grid">
            <div
              v-for="file in displayFiles"
              :key="file.id || file.name"
              class="file-card"
              @click="handleFileClick(file)"
            >
              <div class="card-preview">
                <img
                  v-if="file.thumbnail"
                  :src="file.thumbnail"
                  :alt="file.name"
                  class="preview-thumb"
                  loading="lazy"
                />
                <span v-else class="preview-emoji">{{ getFileEmoji(file) }}</span>

                <div v-if="file.type === 'video'" class="video-play-tag">
                  <span>▶ 播放</span>
                </div>

                <!-- 卡片悬浮操作按钮 -->
                <div class="card-actions" @click.stop>
                  <button class="ca-btn" @click="$emit('file-detail', file)" title="详情">ℹ️</button>
                  <button class="ca-btn" @click="downloadFile(file)" title="下载">📥</button>
                  <button class="ca-btn danger" @click="deleteFile(file)" title="删除">🗑</button>
                </div>
              </div>
              <div class="card-meta">
                <div class="file-title" :title="file.name">{{ file.name }}</div>
                <div class="file-info-row">
                  <span>{{ formatSize(file.size) }}</span>
                  <span>{{ formatDate(file.modified_time) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 紧凑列表视图 -->
          <div v-else class="files-table-box">
            <table class="files-table">
              <thead>
                <tr>
                  <th style="width: 42%;">文件名</th>
                  <th style="width: 12%;">类型</th>
                  <th style="width: 15%;">大小</th>
                  <th style="width: 18%;">修改时间</th>
                  <th style="width: 13%;">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="file in displayFiles"
                  :key="file.id || file.name"
                  class="table-row"
                  @click="handleFileClick(file)"
                >
                  <td class="name-cell">
                    <span class="cell-icon">{{ getFileEmoji(file) }}</span>
                    <span class="cell-name" :title="file.name">{{ file.name }}</span>
                  </td>
                  <td><span class="type-tag">{{ file.type }}</span></td>
                  <td class="font-mono">{{ formatSize(file.size) }}</td>
                  <td class="time-text">{{ formatDate(file.modified_time) }}</td>
                  <td class="ops-cell" @click.stop>
                    <button class="row-op" @click="$emit('file-detail', file)" title="详情">ℹ️</button>
                    <button class="row-op" @click="downloadFile(file)" title="下载">📥</button>
                    <button class="row-op danger" @click="deleteFile(file)" title="删除">🗑</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { maskValue } from '../utils/privacy.js';

// 路径脱敏只掩盖 /home/u<UID> 的账号段，目录结构保留，
// 否则面包屑与路径展示会失去导航参考意义。
function mask(v, kind) {
  return maskValue(v, kind);
}

const props = defineProps({
  visible: { type: Boolean, default: false },
  files: { type: Array, default: () => [] },
  // 用户数据根目录由网关从 WebDAV 凭据推导 (/home/u<UID>/pool0/data)，避免硬编码 UID
  rootPath: { type: String, default: '' }
});

const emit = defineEmits(['close', 'play-video', 'preview-photo', 'preview-doc', 'refresh', 'file-detail', 'open-history']);

// 网关未返回根路径时保持为空，避免误用他人路径
const ROOT_PATH = computed(() => props.rootPath || '');
const currentPath = ref(props.rootPath || '');
const pathStack = ref([props.rootPath || '']);
const searchKeyword = ref('');
const viewMode = ref('grid'); // 'grid' | 'list'
const activeCategory = ref('all');
const currentFolderFiles = ref([]);
const loadingFolder = ref(false);

// 上传与操作状态
const fileInputRef = ref(null);
const uploading = ref(false);
const uploadProgress = ref(0);
const uploadingName = ref('');
const toast = ref('');
const toastType = ref('ok');
let toastTimer = null;

function showToast(msg, type = 'ok') {
  toast.value = msg;
  toastType.value = type;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ''; }, 3000);
}

const categories = [
  { key: 'all', name: '全部文件', icon: '📂' },
  { key: 'video', name: '视频影音', icon: '🎬' },
  { key: 'photo', name: '图片相册', icon: '🖼️' },
  { key: 'doc', name: '文档与压缩包', icon: '📄' }
];

const currentCategoryName = computed(() => {
  return categories.find(c => c.key === activeCategory.value)?.name || '全部文件';
});

// 计算面包屑路径分段
const pathSegments = computed(() => {
  const root = ROOT_PATH.value;
  if (!root) return [];
  const rel = currentPath.value.replace(root, '');
  if (!rel || rel === '/') return [];
  const parts = rel.split('/').filter(Boolean);
  let acc = root;
  return parts.map(p => {
    acc += '/' + p;
    return { name: p, fullPath: acc };
  });
});

// 加载指定目录下的子文件
async function loadFolder(targetPath) {
  loadingFolder.value = true;
  try {
    const res = await fetch(`/api/files?parent=${encodeURIComponent(targetPath)}`);
    const data = await res.json();
    if (data.status === 'ok' && data.data?.files) {
      currentFolderFiles.value = data.data.files;
      currentPath.value = targetPath;
    }
  } catch (e) {
    console.error('加载子文件夹失败:', e);
  } finally {
    loadingFolder.value = false;
  }
}

// 导航到指定路径
function navigateTo(targetPath) {
  if (targetPath === ROOT_PATH.value) {
    currentPath.value = ROOT_PATH.value;
    pathStack.value = [ROOT_PATH.value];
    currentFolderFiles.value = [];
    return;
  }
  pathStack.value.push(targetPath);
  loadFolder(targetPath);
}

// 返回上一级
function navigateUp() {
  if (pathStack.value.length > 1) {
    pathStack.value.pop();
    const prev = pathStack.value[pathStack.value.length - 1];
    if (prev === ROOT_PATH.value) {
      currentPath.value = ROOT_PATH.value;
      currentFolderFiles.value = [];
    } else {
      loadFolder(prev);
    }
  }
}

// 重新加载当前目录
function reloadCurrent() {
  if (currentPath.value === ROOT_PATH.value) {
    emit('refresh');
  } else {
    loadFolder(currentPath.value);
  }
}

// ---------- 上传 ----------
function triggerFilePick() {
  if (uploading.value) return;
  fileInputRef.value?.click();
}

async function handleUpload(evt) {
  const picked = Array.from(evt.target.files || []);
  if (!picked.length) return;

  uploading.value = true;
  let okCount = 0;

  for (const f of picked) {
    uploadingName.value = f.name;
    uploadProgress.value = 0;
    try {
      await uploadOne(f);
      okCount++;
    } catch (e) {
      showToast(`「${f.name}」上传失败: ${e.message}`, 'err');
    }
  }

  uploading.value = false;
  uploadProgress.value = 0;
  uploadingName.value = '';
  // 允许重复选择同一文件
  if (fileInputRef.value) fileInputRef.value.value = '';

  if (okCount > 0) {
    showToast(`已成功上传 ${okCount} 个文件`, 'ok');
    reloadCurrent();
  }
}

function uploadOne(file) {
  return new Promise((resolve, reject) => {
    const url = `/api/upload?parent=${encodeURIComponent(currentPath.value)}&filename=${encodeURIComponent(file.name)}`;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        uploadProgress.value = Math.round((e.loaded / e.total) * 100);
      }
    };
    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && res.status === 'ok') resolve(res);
        else reject(new Error(res.message || `HTTP ${xhr.status}`));
      } catch (e) {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.send(file);
  });
}

// ---------- 下载 ----------
function downloadFile(file) {
  if (file.isDir || file.xattr?.directory) {
    showToast('文件夹暂不支持直接下载，请进入后选择文件', 'err');
    return;
  }
  const a = document.createElement('a');
  a.href = `/api/download?path=${encodeURIComponent(file.path)}`;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast(`开始下载「${file.name}」`, 'ok');
}

// ---------- 新建文件夹 ----------
async function handleMkdir() {
  const name = window.prompt('请输入新文件夹名称：');
  if (!name || !name.trim()) return;
  const clean = name.trim().replace(/[\\/]/g, '');
  if (!clean) return;

  try {
    const res = await fetch(`/api/mkdir?path=${encodeURIComponent(currentPath.value + '/' + clean)}`);
    const data = await res.json();
    if (data.status === 'ok') {
      showToast(`已创建文件夹「${clean}」`, 'ok');
      reloadCurrent();
    } else {
      showToast('创建失败: ' + (data.message || ''), 'err');
    }
  } catch (e) {
    showToast('创建失败: ' + e.message, 'err');
  }
}

// ---------- 删除 ----------
async function deleteFile(file) {
  const target = file.path + ((file.isDir || file.xattr?.directory) ? '/' : '');
  if (!window.confirm(`确定要删除「${file.name}」吗？此操作不可撤销。`)) return;

  try {
    const res = await fetch(`/api/delete?path=${encodeURIComponent(target)}`);
    const data = await res.json();
    if (data.status === 'ok') {
      showToast(`已删除「${file.name}」`, 'ok');
      reloadCurrent();
    } else {
      showToast('删除失败: ' + (data.message || ''), 'err');
    }
  } catch (e) {
    showToast('删除失败: ' + e.message, 'err');
  }
}

// 监听弹窗显示，恢复根目录
watch(() => props.visible, (val) => {
  if (val) {
    currentPath.value = ROOT_PATH.value;
    pathStack.value = [ROOT_PATH.value];
    currentFolderFiles.value = [];
  }
});

// 根路径来自网关，可能晚于弹窗打开才能拿到，需同步一次
watch(() => props.rootPath, (val) => {
  if (val && currentFolderFiles.value.length === 0) {
    currentPath.value = val;
    pathStack.value = [val];
  }
});

const displayFiles = computed(() => {
  // 如果在子文件夹内，优先显示子文件夹内容；在根目录时显示 props.files
  let list = (currentPath.value !== ROOT_PATH.value && currentFolderFiles.value.length > 0)
    ? currentFolderFiles.value
    : props.files;

  if (activeCategory.value !== 'all') {
    list = list.filter(f => f.type === activeCategory.value);
  }
  if (searchKeyword.value.trim()) {
    const kw = searchKeyword.value.toLowerCase();
    list = list.filter(f => f.name.toLowerCase().includes(kw));
  }
  return list;
});

function getCategoryCount(key) {
  const list = (currentPath.value !== ROOT_PATH.value && currentFolderFiles.value.length > 0)
    ? currentFolderFiles.value
    : props.files;
  if (key === 'all') return list.length;
  return list.filter(f => f.type === key).length;
}

function getFileEmoji(file) {
  if (file.isDir || file.xattr?.directory) return '📁';
  if (file.type === 'video') return '🎬';
  if (file.type === 'photo') return '🖼️';
  if (file.name?.endsWith('.pdf')) return '📕';
  if (file.name?.endsWith('.zip') || file.name?.endsWith('.tar')) return '📦';
  return '📄';
}

function formatSize(bytes) {
  const b = parseInt(bytes, 10);
  if (!b) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function formatDate(timestamp) {
  if (!timestamp) return '-';
  const d = new Date(parseInt(timestamp, 10));
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
}

function handleFileClick(file) {
  // 如果点击的是文件夹，钻取进入子目录！
  if (file.isDir || file.xattr?.directory || file.type === 'dir') {
    navigateTo(file.path);
    return;
  }

  if (file.type === 'video') {
    emit('play-video', file);
  } else if (file.type === 'photo') {
    emit('preview-photo', file);
  } else {
    // 文本、代码、PDF、音频或其它格式唤起通用文档预览器！
    emit('preview-doc', file);
  }
}
</script>

<style scoped>
.explorer-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(15, 23, 42, 0.7);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  animation: fadeIn 0.2s ease-out;
}

.explorer-modal {
  position: relative;
  width: 92vw;
  max-width: 1380px;
  height: 88vh;
  background: #ffffff;
  border-radius: var(--mi-radius-lg);
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.explorer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid var(--mi-border);
  background: #fcfdfe;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-left .icon {
  font-size: 22px;
}

.header-left h4 {
  font-size: 16px;
  font-weight: 700;
  color: var(--mi-text-main);
}

.path-badge {
  font-size: 11px;
  background: #f1f5f9;
  color: #64748b;
  padding: 3px 8px;
  border-radius: 6px;
  font-family: monospace;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f1f5f9;
  border-radius: 20px;
  padding: 6px 14px;
  width: 220px;
}

.search-input {
  border: none;
  background: transparent;
  outline: none;
  font-size: 12px;
  width: 100%;
}

.view-toggle {
  display: flex;
  background: #f1f5f9;
  border-radius: 8px;
  padding: 2px;
}

.v-btn {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: #64748b;
  transition: all 0.15s;
}

.v-btn.active {
  background: #ffffff;
  color: var(--mi-orange);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.close-x {
  font-size: 18px;
  color: #94a3b8;
  padding: 4px 8px;
}

.close-x:hover {
  color: var(--mi-text-main);
}

/* 上传与新建操作按钮 */
.action-pill {
  display: flex;
  align-items: center;
  gap: 5px;
  background: #f1f5f9;
  color: #475569;
  padding: 6px 12px;
  border-radius: 18px;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.15s;
  white-space: nowrap;
}

.action-pill:hover:not(:disabled) {
  background: #e2e8f0;
  color: var(--mi-text-main);
}

.action-pill:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.upload-pill {
  background: linear-gradient(135deg, #ff6700, #ff8533);
  color: #ffffff;
}

.upload-pill:hover:not(:disabled) {
  color: #ffffff;
  opacity: 0.92;
}

.hidden-input {
  display: none;
}

/* 上传进度条 */
.upload-bar {
  position: relative;
  height: 26px;
  background: #f1f5f9;
  overflow: hidden;
  border-bottom: 1px solid var(--mi-border);
}

.upload-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, #ff6700, #ffa04d);
  transition: width 0.2s ease;
}

.upload-text {
  position: relative;
  z-index: 1;
  display: block;
  text-align: center;
  line-height: 26px;
  font-size: 11px;
  font-weight: 600;
  color: #334155;
}

/* 操作结果提示 */
.toast-msg {
  position: absolute;
  top: 76px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  padding: 8px 20px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  animation: fadeIn 0.2s ease-out;
}

.toast-msg.ok {
  background: #ecfdf5;
  color: #059669;
  border: 1px solid #a7f3d0;
}

.toast-msg.err {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}

/* 卡片悬浮操作 */
.card-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.file-card:hover .card-actions {
  opacity: 1;
}

.ca-btn {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.94);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  transition: all 0.15s;
}

.ca-btn:hover {
  background: #ffffff;
  transform: scale(1.08);
}

.ca-btn.danger:hover {
  background: #fee2e2;
}

/* 表格行操作 */
.ops-cell {
  display: flex;
  gap: 6px;
}

.row-op {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: #f1f5f9;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.row-op:hover {
  background: #e2e8f0;
}

.row-op.danger:hover {
  background: #fee2e2;
}

.explorer-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 左侧目录树 */
.sidebar-tree {
  width: 240px;
  background: #f8fafc;
  border-right: 1px solid var(--mi-border);
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tree-section-title {
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  margin-bottom: 6px;
  padding-left: 8px;
}

.tree-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s;
  color: #334155;
}

.tree-item:hover {
  background: #f1f5f9;
}

.tree-item.active {
  background: #fff7ed;
  color: var(--mi-orange);
  font-weight: 600;
}

.t-icon {
  font-size: 16px;
  margin-right: 8px;
}

.t-name {
  font-size: 13px;
  flex: 1;
}

.t-count {
  font-size: 11px;
  background: rgba(0,0,0,0.05);
  padding: 2px 6px;
  border-radius: 10px;
  color: #64748b;
}

.tree-divider {
  height: 1px;
  background: var(--mi-border);
  margin: 14px 0;
}

.mount-box {
  background: #ffffff;
  border: 1px solid var(--mi-border);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mount-label {
  font-size: 11px;
  color: #64748b;
}

.mount-val {
  font-size: 12px;
  font-weight: 700;
  color: var(--mi-orange);
}

.mount-sub {
  font-size: 10px;
  color: #94a3b8;
}

/* 右侧内容流 */
.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 20px 24px;
}

.breadcrumb-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  font-size: 13px;
}

.crumbs {
  display: flex;
  align-items: center;
  gap: 6px;
}

.crumb-root {
  cursor: pointer;
  color: #475569;
  font-weight: 600;
}

.crumb-root:hover {
  color: var(--mi-orange);
}

.crumb-seg {
  cursor: pointer;
  color: #475569;
}

.crumb-seg:hover {
  color: var(--mi-orange);
}

.crumb-sep {
  color: #cbd5e1;
}

.crumb-cur {
  color: var(--mi-text-main);
  font-weight: 700;
  cursor: default;
}

.bar-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.up-btn {
  background: #f1f5f9;
  color: var(--mi-orange);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.15s;
}

.up-btn:hover {
  background: #fff7ed;
}

.file-summary {
  font-size: 12px;
  color: #64748b;
}

/* 网格卡片 */
.files-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}

.file-card {
  border: 1px solid var(--mi-border);
  border-radius: 12px;
  overflow: hidden;
  background: #ffffff;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
}

.file-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1);
  border-color: var(--mi-orange);
}

.card-preview {
  height: 120px;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.preview-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-emoji {
  font-size: 40px;
}

.video-play-tag {
  position: absolute;
  bottom: 6px;
  right: 6px;
  background: rgba(0,0,0,0.7);
  color: #ff8533;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}

.card-meta {
  padding: 10px 12px;
}

.file-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--mi-text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.file-info-row {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #94a3b8;
}

/* 列表表格 */
.files-table-box {
  background: #ffffff;
  border: 1px solid var(--mi-border);
  border-radius: 10px;
  overflow: hidden;
}

.files-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.files-table th {
  background: #f8fafc;
  padding: 12px 16px;
  text-align: left;
  font-weight: 600;
  color: #475569;
  border-bottom: 1px solid var(--mi-border);
}

.files-table td {
  padding: 12px 16px;
  border-bottom: 1px solid #f1f5f9;
  color: #334155;
}

.table-row {
  cursor: pointer;
  transition: background 0.15s;
}

.table-row:hover {
  background: #f8fafc;
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cell-icon {
  font-size: 18px;
}

.cell-name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 400px;
}

.type-tag {
  font-size: 11px;
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  color: #64748b;
}

.time-text {
  font-size: 12px;
  color: #94a3b8;
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}
</style>
