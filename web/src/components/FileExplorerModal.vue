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
        <!-- 左侧快捷目录树与多级文件夹导航 -->
        <aside class="sidebar-tree">
          <div class="tree-section-title">文件类型分类</div>
          <div 
            v-for="cat in categories" 
            :key="cat.key" 
            class="tree-item"
            :class="{ active: activeCategory === cat.key && !selectedTreePath }"
            @click="selectCategory(cat.key)"
          >
            <span class="t-icon">{{ cat.icon }}</span>
            <span class="t-name">{{ cat.name }}</span>
            <span class="t-count">{{ getCategoryCount(cat.key) }}</span>
          </div>

          <div class="tree-divider"></div>
          
          <!-- 核心：交互式多级文件夹树 (Folder Directory Tree) -->
          <div class="tree-header-row">
            <span class="tree-section-title">存储空间目录树</span>
            <button class="tree-refresh-btn" @click="refreshTree" title="刷新目录结构">🔄</button>
          </div>

          <div class="folder-tree-container">
            <div 
              class="tree-node-item root-node"
              :class="{ active: currentPath === ROOT_PATH && !selectedTreePath }"
              @click="navigateTo(ROOT_PATH)"
            >
              <span class="t-icon">🏠</span>
              <span class="node-name">存储根目录</span>
            </div>

            <!-- 递归多级文件夹树 -->
            <div class="tree-subnodes">
              <div 
                v-for="node in folderTree" 
                :key="node.path"
                class="tree-branch"
              >
                <div 
                  class="tree-node-item"
                  :class="{ active: currentPath === node.path }"
                  :style="{ paddingLeft: (node.level * 14 + 10) + 'px' }"
                  @click="handleTreeNodeClick(node)"
                >
                  <span 
                    class="node-arrow" 
                    :class="{ expanded: node.expanded, loading: node.loading }"
                    @click.stop="toggleTreeNode(node)"
                  >
                    {{ node.loading ? '⏳' : (node.hasChildren !== false ? (node.expanded ? '▼' : '▶') : '·') }}
                  </span>
                  <span class="node-icon">📁</span>
                  <span class="node-name" :title="node.name">{{ node.name }}</span>
                </div>

                <!-- 展开的二级子节点 -->
                <div v-if="node.expanded && node.children && node.children.length" class="tree-children-box">
                  <div 
                    v-for="sub in node.children" 
                    :key="sub.path"
                    class="tree-node-item"
                    :class="{ active: currentPath === sub.path }"
                    :style="{ paddingLeft: ((node.level + 1) * 14 + 14) + 'px' }"
                    @click="handleTreeNodeClick(sub)"
                  >
                    <span 
                      class="node-arrow" 
                      :class="{ expanded: sub.expanded, loading: sub.loading }"
                      @click.stop="toggleTreeNode(sub)"
                    >
                      {{ sub.loading ? '⏳' : (sub.hasChildren !== false ? (sub.expanded ? '▼' : '▶') : '·') }}
                    </span>
                    <span class="node-icon">📁</span>
                    <span class="node-name" :title="sub.name">{{ sub.name }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="tree-divider"></div>
          <div class="mount-box">
            <div class="mount-label">当前视图</div>
            <div class="mount-val">{{ displayFiles.length }} 项</div>
            <div class="mount-sub">
              视频 {{ getCategoryCount('video') }} · 图片 {{ getCategoryCount('photo') }}
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
                
                <!-- 级联快捷下拉导航 -->
                <div class="crumb-segment-wrapper">
                  <span 
                    class="crumb-seg" 
                    :class="{ 'crumb-cur': idx === pathSegments.length - 1 }"
                    @click="navigateTo(seg.fullPath)"
                  >{{ seg.name }}</span>
                  <button 
                    class="crumb-dropdown-arrow" 
                    @click.stop="toggleCrumbMenu(seg, idx)"
                    title="展开同级文件夹快速跳转"
                  >▾</button>

                  <!-- 同级目录悬浮快速跳转面板 -->
                  <div v-if="activeCrumbIdx === idx" class="crumb-dropdown-menu" @click.stop>
                    <div class="crumb-menu-title">同级文件夹</div>
                    <div v-if="crumbSiblingsLoading" class="crumb-menu-loading">加载中...</div>
                    <div v-else-if="crumbSiblings.length === 0" class="crumb-menu-empty">无同级文件夹</div>
                    <div 
                      v-else 
                      v-for="sib in crumbSiblings" 
                      :key="sib.path"
                      class="crumb-menu-item"
                      :class="{ active: sib.path === seg.fullPath }"
                      @click="navigateTo(sib.path); activeCrumbIdx = -1"
                    >
                      <span>📁</span>
                      <span class="sib-name">{{ sib.name }}</span>
                    </div>
                  </div>
                </div>
              </template>
            </div>
            
            <div class="bar-actions">
              <!-- 切换分栏视图开关 -->
              <button 
                class="miller-toggle-btn"
                :class="{ active: showMillerColumns }"
                @click="showMillerColumns = !showMillerColumns"
                title="切换/展开多级分栏流转导航"
              >
                <span>🗂️</span>
                <span>{{ showMillerColumns ? '收起多级分栏' : '多级分栏流转' }}</span>
              </button>

              <span v-if="loadingFolder" class="folder-loading-tag">⚡ 正在读取目录...</span>
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

          <!-- 核心新增：文件列表上方多级分栏流转视图 (macOS Finder Miller Columns) -->
          <div v-if="showMillerColumns" class="miller-columns-container">
            <div class="miller-columns-scroll" ref="millerScrollRef">
              <div 
                v-for="(col, colIdx) in columnChain" 
                :key="col.path"
                class="miller-column"
              >
                <div class="column-header">
                  <span class="ch-icon">📁</span>
                  <span class="ch-title" :title="col.name">{{ col.name }}</span>
                  <span class="ch-count">{{ col.items.length }}</span>
                </div>
                <div class="column-items-list">
                  <div v-if="col.loading" class="col-loading">读取中...</div>
                  <div v-else-if="col.items.length === 0" class="col-empty">
                    <span class="empty-icon">📄</span>
                    <span>无子文件夹</span>
                    <span class="empty-sub" v-if="col.path === currentPath">(当前目录内容见下方列表)</span>
                  </div>
                  <div
                    v-else
                    v-for="item in col.items"
                    :key="item.path"
                    class="column-item"
                    :class="{ active: item.selected, 'is-parent': item.isDir }"
                    @click="handleColumnItemClick(item, colIdx)"
                  >
                    <span class="ci-icon">📁</span>
                    <span class="ci-name" :title="item.name">{{ item.name }}</span>
                    <span class="ci-arrow" v-if="item.isDir">›</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 加载中骨架态反馈 -->
          <div v-if="loadingFolder" class="loading-skeleton-box">
            <div class="skeleton-shimmer"></div>
            <div class="skeleton-text">正在快速读取 NAS 目录结构，请稍候...</div>
          </div>

          <!-- 真正修复 Bug 1：子目录为空时，清晰显示空文件夹，绝不穿透回退到根目录文件 -->
          <div v-else-if="currentPath !== ROOT_PATH && displayFiles.length === 0" class="empty-folder-box">
            <span class="empty-folder-icon">📂</span>
            <h4>此文件夹为空</h4>
            <p>未在该文件夹下检索到任何子文件或媒体</p>
          </div>

          <!-- 网格卡片视图 -->
          <div v-else-if="viewMode === 'grid'" class="files-grid">
            <div
              v-for="file in displayFiles"
              :key="file.id || file.name"
              class="file-card"
              v-smart-preload="file.previewUrl || file.thumbnail"
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
import { vSmartPreload } from '../utils/preloader.js';

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

// ===== 核心：多级交互式目录树 (Folder Tree State) =====
const folderTree = ref([]);
const selectedTreePath = ref('');

// ===== 核心：上方 macOS Finder 式多级分栏流转状态 (Miller Columns) =====
const showMillerColumns = ref(true);
const columnChain = ref([]);
const millerScrollRef = ref(null);

// 关键优化：标准绝对路径清理函数 (消除中文字符/百分号编码不一致导致的清空 Bug)
function cleanPath(p) {
  if (!p) return '';
  try {
    return decodeURIComponent(p).replace(/\/+$/, '');
  } catch (e) {
    return p.replace(/\/+$/, '');
  }
}

// 分栏目录内存级高速缓存池 (Map<path, folderList>)
const columnCache = new Map();

async function fetchSubdirs(dirPath) {
  const normPath = cleanPath(dirPath);
  if (columnCache.has(normPath)) {
    return columnCache.get(normPath);
  }
  try {
    const res = await fetch(`/api/files?parent=${encodeURIComponent(normPath)}`);
    const data = await res.json();
    if (data.status === 'ok' && data.data?.files) {
      const dirs = data.data.files
        .filter(f => f.isDir || f.type === 'dir')
        .map(d => ({ name: d.name, path: cleanPath(d.path), isDir: true }));
      columnCache.set(normPath, dirs);
      return dirs;
    }
  } catch (e) {
    console.error('获取分栏子文件夹失败:', e);
  }
  columnCache.set(normPath, []);
  return [];
}

// 增量构建/对齐当前路径的多级分栏链 (0 毫秒秒级呈现，绝不串行等待)
function syncMillerColumns(targetPath) {
  if (!ROOT_PATH.value) return;
  const root = cleanPath(ROOT_PATH.value);
  const target = cleanPath(targetPath) || root;

  // 1. 获取已缓存的根目录子项
  let rootItems = columnCache.get(root) || [];

  // 2. 快速计算当前路径的分栏链条
  const expectedPaths = [root];
  if (target.startsWith(root) && target !== root) {
    const rel = target.slice(root.length);
    const segs = rel.split('/').filter(Boolean);
    let acc = root;
    for (const s of segs) {
      acc += '/' + s;
      expectedPaths.push(acc);
    }
  }

  // 3. 0毫秒同步构造各栏数据（直接复用缓存，没有缓存的先展示 loading 骨架，绝不阻塞 UI！）
  const builtCols = [];
  for (let i = 0; i < expectedPaths.length; i++) {
    const p = expectedPaths[i];
    const name = p === root ? '存储空间' : p.split('/').pop();
    const isCached = columnCache.has(p);
    const items = isCached ? columnCache.get(p) : (i === 0 ? rootItems : []);
    
    const nextPath = expectedPaths[i + 1] || target;
    const mappedItems = items.map(it => ({
      ...it,
      selected: cleanPath(it.path) === nextPath
    }));

    builtCols.push({
      name,
      path: p,
      loading: !isCached && i > 0,
      items: mappedItems
    });
  }

  // 立即呈现分栏框架！
  columnChain.value = builtCols;

  // 4. 后台静默预取尚未缓存的栏目（如果尚未被 loadFolder 填充的话）
  builtCols.forEach(async (col, idx) => {
    const p = cleanPath(col.path);
    if (!columnCache.has(p)) {
      const dirs = await fetchSubdirs(p);
      const nextPath = expectedPaths[idx + 1] || target;
      col.items = dirs.map(d => ({
        ...d,
        selected: cleanPath(d.path) === nextPath
      }));
      col.loading = false;
    }
  });

  // 5. 平滑滚动到最右侧
  setTimeout(() => {
    if (millerScrollRef.value) {
      millerScrollRef.value.scrollTo({
        left: millerScrollRef.value.scrollWidth,
        behavior: 'smooth'
      });
    }
  }, 30);
}

// 分栏项点击处理
function handleColumnItemClick(item, colIdx) {
  navigateTo(item.path);
}

// 自动递归展开左侧树状图沿着指定路径的各级节点
async function autoExpandTreeToPath(targetPath) {
  if (!targetPath || !folderTree.value.length) return;
  const root = cleanPath(ROOT_PATH.value);
  const target = cleanPath(targetPath);
  if (!target.startsWith(root)) return;

  const rel = target.slice(root.length);
  const segs = rel.split('/').filter(Boolean);
  if (!segs.length) return;

  let currentLevelNodes = folderTree.value;
  let currentAcc = root;

  for (let i = 0; i < segs.length; i++) {
    currentAcc += '/' + segs[i];
    const match = currentLevelNodes.find(n => cleanPath(n.path) === currentAcc || n.name === segs[i]);
    if (match) {
      if (!match.expanded) {
        await toggleTreeNode(match);
      }
      currentLevelNodes = match.children || [];
    }
  }
}

// ===== 面包屑同级快速跳转下拉 =====
const activeCrumbIdx = ref(-1);
const crumbSiblings = ref([]);
const crumbSiblingsLoading = ref(false);

function selectCategory(k) {
  activeCategory.value = k;
  selectedTreePath.value = '';
}

// 刷新并构建根部文件夹树
async function refreshTree() {
  if (!ROOT_PATH.value) return;
  try {
    const res = await fetch(`/api/files?parent=${encodeURIComponent(ROOT_PATH.value)}`);
    const data = await res.json();
    if (data.status === 'ok' && data.data?.files) {
      const dirs = data.data.files.filter(f => f.isDir || f.type === 'dir');
      folderTree.value = dirs.map(d => ({
        name: d.name,
        path: d.path,
        level: 0,
        expanded: false,
        loading: false,
        hasChildren: true,
        children: []
      }));
    }
  } catch (e) {
    console.error('构建根目录树失败:', e);
  }
}

// 展开/折叠指定节点
async function toggleTreeNode(node) {
  if (node.expanded) {
    node.expanded = false;
    return;
  }
  node.expanded = true;
  if (!node.children || node.children.length === 0) {
    node.loading = true;
    try {
      const res = await fetch(`/api/files?parent=${encodeURIComponent(node.path)}`);
      const data = await res.json();
      if (data.status === 'ok' && data.data?.files) {
        const dirs = data.data.files.filter(f => f.isDir || f.type === 'dir');
        node.children = dirs.map(d => ({
          name: d.name,
          path: d.path,
          level: node.level + 1,
          expanded: false,
          loading: false,
          hasChildren: true,
          children: []
        }));
        if (dirs.length === 0) node.hasChildren = false;
      }
    } catch (e) {
      console.error('拉取子目录失败:', e);
    } finally {
      node.loading = false;
    }
  }
}

// 点击目录树节点跳转
function handleTreeNodeClick(node) {
  selectedTreePath.value = node.path;
  activeCategory.value = 'all'; // 目录树视图展示全类型
  navigateTo(node.path);
}

// 切换面包屑同级目录快速跳转面板
async function toggleCrumbMenu(seg, idx) {
  if (activeCrumbIdx.value === idx) {
    activeCrumbIdx.value = -1;
    return;
  }
  activeCrumbIdx.value = idx;
  crumbSiblings.value = [];
  crumbSiblingsLoading.value = true;

  // 计算父级路径
  const parentPath = seg.fullPath.substring(0, seg.fullPath.lastIndexOf('/')) || ROOT_PATH.value;
  try {
    const res = await fetch(`/api/files?parent=${encodeURIComponent(parentPath)}`);
    const data = await res.json();
    if (data.status === 'ok' && data.data?.files) {
      crumbSiblings.value = data.data.files
        .filter(f => f.isDir || f.type === 'dir')
        .map(f => ({ name: f.name, path: f.path }));
    }
  } catch (e) {
    crumbSiblings.value = [];
  } finally {
    crumbSiblingsLoading.value = false;
  }
}

// 点击外部关闭面包屑下拉
function setupOutsideClick() {
  window.addEventListener('click', () => {
    activeCrumbIdx.value = -1;
  });
}
setupOutsideClick();

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

// 根目录真实文件夹缓存
const rootFolderFiles = ref([]);
const isRootLoading = ref(false);

// 真正拉取并缓存物理根目录内容 (list_directory)
async function fetchRootFiles() {
  if (!ROOT_PATH.value) return;
  isRootLoading.value = true;
  try {
    const res = await fetch(`/api/files?parent=${encodeURIComponent(cleanPath(ROOT_PATH.value))}`);
    const data = await res.json();
    if (data.status === 'ok' && data.data?.files) {
      rootFolderFiles.value = data.data.files;
    }
  } catch (e) {
    console.error('拉取真实根目录失败:', e);
  } finally {
    isRootLoading.value = false;
  }
}

// 核心优化：数据通道归一化！loadFolder 获取到数据后，同步喂饱上方分栏缓存！
async function loadFolder(targetPath) {
  const normPath = cleanPath(targetPath);
  loadingFolder.value = true;
  try {
    const res = await fetch(`/api/files?parent=${encodeURIComponent(normPath)}`);
    const data = await res.json();
    if (data.status === 'ok' && data.data?.files) {
      currentFolderFiles.value = data.data.files;
      currentPath.value = normPath;

      // 提取当前目录内的子文件夹，顺手喂给 columnCache，上方分栏立刻 0ms 获取！
      const subDirs = data.data.files
        .filter(f => f.isDir || f.type === 'dir')
        .map(d => ({ name: d.name, path: cleanPath(d.path), isDir: true }));
      columnCache.set(normPath, subDirs);

      // 如果分栏里有这一项，原地更新并取消转圈
      const matchCol = columnChain.value.find(c => cleanPath(c.path) === normPath);
      if (matchCol) {
        matchCol.items = subDirs;
        matchCol.loading = false;
      }
    }
  } catch (e) {
    console.error('加载子文件夹失败:', e);
    currentFolderFiles.value = [];
  } finally {
    loadingFolder.value = false;
  }
}

// 导航到指定路径并联动多级分栏与左侧目录树 (秒级同步)
function navigateTo(targetPath) {
  const normTarget = cleanPath(targetPath);
  const normRoot = cleanPath(ROOT_PATH.value);

  if (normTarget === normRoot || !normTarget) {
    currentPath.value = normRoot;
    pathStack.value = [normRoot];
    currentFolderFiles.value = [];
    selectedTreePath.value = '';
    fetchRootFiles();
    syncMillerColumns(normRoot);
    return;
  }
  pathStack.value.push(normTarget);
  selectedTreePath.value = normTarget;

  // 1. 同步骨架分栏瞬间呈现（0ms 搭建 UI）
  syncMillerColumns(normTarget);
  // 2. 异步请求真实文件（拉取成功后自动喂饱上方分栏）
  loadFolder(normTarget);
  // 3. 展开左侧树
  autoExpandTreeToPath(normTarget);
}

// 返回上一级
function navigateUp() {
  if (pathStack.value.length > 1) {
    pathStack.value.pop();
    const prev = pathStack.value[pathStack.value.length - 1];
    if (prev === ROOT_PATH.value) {
      currentPath.value = ROOT_PATH.value;
      currentFolderFiles.value = [];
      selectedTreePath.value = '';
      syncMillerColumns(ROOT_PATH.value);
    } else {
      loadFolder(prev);
      selectedTreePath.value = prev;
      syncMillerColumns(prev);
      autoExpandTreeToPath(prev);
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

// 监听弹窗显示，恢复根目录并初始化目录树与多级分栏（只在初次或根路径变化时初始化一次，避免每次重拉）
watch(() => props.visible, (val) => {
  if (val) {
    const root = cleanPath(ROOT_PATH.value);
    currentPath.value = root;
    pathStack.value = [root];
    currentFolderFiles.value = [];
    selectedTreePath.value = '';
    fetchRootFiles();
    syncMillerColumns(root);
    if (folderTree.value.length === 0 && root) {
      refreshTree();
    }
  }
});

// 根路径来自网关，异步到达时初始化一次目录树
watch(() => props.rootPath, (val) => {
  if (val) {
    const norm = cleanPath(val);
    if (currentPath.value === '' || currentPath.value === norm) {
      currentPath.value = norm;
      pathStack.value = [norm];
      fetchRootFiles();
      syncMillerColumns(norm);
    }
    if (folderTree.value.length === 0) {
      refreshTree();
    }
  }
});

const displayFiles = computed(() => {
  // 彻底修复：根目录展示真实的 rootFolderFiles，子目录展示真实的 currentFolderFiles
  // 只有当 rootFolderFiles 还没加载完时才拿 props.files 临时兜底
  let list = (cleanPath(currentPath.value) !== cleanPath(ROOT_PATH.value))
    ? currentFolderFiles.value
    : (rootFolderFiles.value.length > 0 ? rootFolderFiles.value : props.files);

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
  const list = (currentPath.value !== ROOT_PATH.value)
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

/* 目录树导航样式 */
.tree-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 4px;
}

.tree-refresh-btn {
  font-size: 11px;
  color: #94a3b8;
  padding: 2px 4px;
  border-radius: 4px;
}

.tree-refresh-btn:hover {
  color: var(--mi-orange);
}

.folder-tree-container {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 240px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
}

.tree-node-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  color: #334155;
  transition: all 0.15s;
}

.tree-node-item:hover {
  background: #f1f5f9;
}

.tree-node-item.active {
  background: #fff7ed;
  color: var(--mi-orange);
  font-weight: 600;
}

.node-arrow {
  font-size: 9px;
  color: #94a3b8;
  width: 14px;
  text-align: center;
  cursor: pointer;
  transition: transform 0.15s;
}

.node-arrow:hover {
  color: var(--mi-orange);
}

.node-arrow.expanded {
  color: var(--mi-orange);
}

.node-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.node-icon {
  font-size: 14px;
}

.tree-children-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 面包屑级联下拉跳转 */
.crumb-segment-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.crumb-dropdown-arrow {
  font-size: 10px;
  color: #94a3b8;
  padding: 2px 4px;
  margin-left: 2px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.crumb-dropdown-arrow:hover {
  background: #f1f5f9;
  color: var(--mi-orange);
}

.crumb-dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  background: #ffffff;
  border: 1px solid var(--mi-border);
  border-radius: 10px;
  padding: 6px;
  min-width: 180px;
  max-height: 240px;
  overflow-y: auto;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.12);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 3px;
  animation: fadeIn 0.15s ease-out;
}

.crumb-menu-title {
  font-size: 10px;
  font-weight: 700;
  color: #94a3b8;
  padding: 4px 8px;
  text-transform: uppercase;
}

/* 面包屑工具栏操作 */
.miller-toggle-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  background: #f1f5f9;
  color: #475569;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.15s;
}

.miller-toggle-btn:hover {
  background: #e2e8f0;
  color: var(--mi-text-main);
}

.miller-toggle-btn.active {
  background: #fff7ed;
  color: var(--mi-orange);
  border: 1px solid rgba(255, 103, 0, 0.3);
}

/* 核心：macOS Finder / 飞书级多级分栏流转面板 (Miller Columns) */
.miller-columns-container {
  background: #f8fafc;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-md);
  margin-bottom: 16px;
  height: 220px;
  min-height: 220px;
  max-height: 220px;
  flex-shrink: 0;
  overflow: hidden;
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.03);
}

.miller-columns-scroll {
  display: flex;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
}

.miller-column {
  width: 220px;
  min-width: 220px;
  max-width: 260px;
  height: 100%;
  border-right: 1px solid var(--mi-border);
  display: flex;
  flex-direction: column;
  background: #ffffff;
}

.miller-column:nth-child(even) {
  background: #fcfdfe;
}

.column-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--mi-border);
  background: #f1f5f9;
  font-size: 11px;
  font-weight: 700;
  color: #475569;
}

.ch-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ch-count {
  font-size: 10px;
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 6px;
  border-radius: 8px;
  color: #64748b;
}

.column-items-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.column-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: #334155;
  cursor: pointer;
  transition: all 0.15s;
}

.column-item:hover {
  background: #f1f5f9;
}

.column-item.active {
  background: var(--mi-orange);
  color: #ffffff;
  font-weight: 600;
}

.column-item.active .ci-icon {
  filter: brightness(1.2);
}

.column-item.active .ci-arrow {
  color: #ffffff;
  opacity: 1;
}

.ci-icon {
  font-size: 14px;
}

.ci-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ci-arrow {
  font-size: 14px;
  font-weight: bold;
  color: #94a3b8;
  opacity: 0.7;
}

.col-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  color: #94a3b8;
  text-align: center;
  padding: 40px 10px;
}

.empty-icon {
  font-size: 24px;
  opacity: 0.5;
}

.empty-sub {
  font-size: 10px;
  color: #cbd5e1;
}

.col-loading {
  font-size: 11px;
  color: #94a3b8;
  text-align: center;
  padding: 40px 0;
}

/* 真正的空文件夹提示面板 */
.empty-folder-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  gap: 10px;
}

.empty-folder-icon {
  font-size: 48px;
  opacity: 0.6;
}

.empty-folder-box h4 {
  font-size: 16px;
  color: var(--mi-text-main);
  font-weight: 600;
}

.empty-folder-box p {
  font-size: 12px;
  color: var(--mi-text-sub);
}

.crumb-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: #334155;
  cursor: pointer;
  transition: all 0.15s;
}

.crumb-menu-item:hover {
  background: #f8fafc;
  color: var(--mi-orange);
}

.crumb-menu-item.active {
  background: #fff7ed;
  color: var(--mi-orange);
  font-weight: 600;
}

.crumb-menu-loading, .crumb-menu-empty {
  font-size: 11px;
  color: #94a3b8;
  padding: 12px;
  text-align: center;
}

.sib-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.folder-loading-tag {
  font-size: 11px;
  color: var(--mi-orange);
  background: #fff7ed;
  padding: 3px 8px;
  border-radius: 6px;
  font-weight: 600;
  animation: pulse 1.2s infinite ease-in-out;
}

.loading-skeleton-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
  gap: 16px;
}

.skeleton-shimmer {
  width: 140px;
  height: 8px;
  background: linear-gradient(90deg, #f1f5f9 25%, #fed7aa 50%, #f1f5f9 75%);
  background-size: 200% 100%;
  border-radius: 4px;
  animation: shimmer 1.5s infinite;
}

.skeleton-text {
  font-size: 13px;
  color: #64748b;
  font-weight: 500;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
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
