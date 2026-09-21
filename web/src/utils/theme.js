/**
 * 本地主题与外观控制核心 (纯客户端持久化，完全隔离 NAS)
 * 
 * 核心功能：
 * 1. 状态：背景图片 (IndexedDB 存储)、背景亮度/对比度/模糊度/预设壁纸库；
 * 2. 质感：卡片半透明度、磨砂玻璃模糊半径、饱和度、边框光晕、圆角与阴影；
 * 3. 预设视觉风格：
 *    - 'default': 经典米家原版纯净白灰扁平风 (Clean Minimalist)
 *    - 'mica': 微软云母与 macOS 拟态深/浅磨砂质感 (Acrylic / Glassmorphism)
 *    - 'cyberpunk': 赛博霓虹 (Cyber Neon / High-contrast Dark)
 *    - 'aurora': 极光流彩 (Aurora Borealis / Dreamy Gradient)
 *    - 'constructivism': 苏联/包豪斯构成主义艺术风格 (几何色块、硬朗直角、黑红高对比、机械工程张力)
 * 4. 强调色系统：内置多套经典品牌与潮流色板，支持完全自定义十六进制主色调；
 * 5. 精选壁纸库：内建多款优雅现代的自然/抽象/极简渐变壁纸，即点即换；
 * 6. 导入导出：支持导出主题配置为 JSON，支持从 JSON 文件导入并立即生效。
 */

import { reactive, ref } from 'vue';
import { buildTokens } from '../theme/tokens.js';


const DB_NAME = 'MiNasThemeStorage';
const DB_VERSION = 1;
const STORE_NAME = 'backgrounds';
const SETTINGS_KEY = 'minis_theme_settings_v1';

// 推荐强调色板
export const ACCENT_PALETTE = [
  { name: '小米橙', value: '#ff6700' },
  { name: '云母天蓝', value: '#0ea5e9' },
  { name: '极光翡翠', value: '#10b981' },
  { name: '赛博洋红', value: '#f43f5e' },
  { name: '梦幻紫罗兰', value: '#8b5cf6' },
  { name: '科技深靛', value: '#3b82f6' },
  { name: '琥珀金', value: '#f59e0b' },
  { name: '构成先锋红', value: '#d92027' }
];

// 内置精选纯CSS/SVG高保真艺术背景库 (免外部网络依赖，即开即用)
//
// 重要：这里的值会被写进 `background-image`（不是 `background` 简写），
// 而 background-image 只接受 <image> 列表，**不接受末尾的纯色值**。
// 形如 `radial-gradient(...), #0f172a` 属于无效值，整条声明会被浏览器丢弃
// —— 这正是「选了内置壁纸却完全不显示」的原因。
// 因此底色必须写进 gradient 自身（`radial-gradient(... , #0f172a)`）或用
// `linear-gradient(#0f172a, #0f172a)` 这种等色渐变表达。
export const PRESET_WALLPAPERS = [
  {
    id: 'mesh_aurora',
    name: '极光流云',
    type: 'gradient',
    css: 'radial-gradient(at 0% 0%, #1e1b4b 0px, transparent 50%), radial-gradient(at 100% 0%, #064e3b 0px, transparent 50%), radial-gradient(at 50% 100%, #31104b 0px, transparent 50%), linear-gradient(#0f172a, #0f172a)'
  },
  {
    id: 'mesh_sunset',
    name: '晚霞暮光',
    type: 'gradient',
    css: 'radial-gradient(at 10% 20%, #431407 0px, transparent 40%), radial-gradient(at 90% 10%, #701a75 0px, transparent 50%), radial-gradient(at 50% 80%, #1e1b4b 0px, transparent 60%), linear-gradient(#0c0a09, #0c0a09)'
  },
  {
    id: 'mesh_cyan_deep',
    name: '深海幽蓝',
    type: 'gradient',
    css: 'radial-gradient(at 0% 100%, #082f49 0px, transparent 50%), radial-gradient(at 100% 0%, #134e4a 0px, transparent 50%), linear-gradient(#030712, #030712)'
  },
  {
    id: 'mesh_clean_light',
    name: '晨曦素雅',
    type: 'gradient',
    css: 'linear-gradient(135deg, #f0f4f8 0%, #e2e8f0 50%, #dbeafe 100%)'
  },
  {
    id: 'mesh_cyber_grid',
    name: '矩阵暗夜',
    type: 'gradient',
    css: 'radial-gradient(ellipse at center, #111827 0%, #030712 100%)'
  }
];

// 预设主题配置
export const PRESETS = {
  default: {
    id: 'default',
    name: '经典默认 (米家扁平)',
    tag: '官方极简',
    description: '官方原版极简白灰扁平风，纯净通透，清晰专注数据本身',
    bgEnabled: false,
    bgBrightness: 100,
    bgBlur: 0,
    bgOpacity: 100,
    bgTint: 'rgba(245, 246, 248, 0.6)',
    cardBg: '#ffffff',
    cardOpacity: 100,
    cardBlur: 0,
    cardSaturate: 100,
    cardBorder: '#eaedf1',
    cardShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
    accentColor: '#ff6700',
    primaryFont: 'sans-serif',
    borderRadius: '14px',
    isConstructivism: false,
    blurScope: 'none',
    controlBlur: 0,
    controlOpacity: 100
  },
  mica: {
    id: 'mica',
    name: '云母磨砂 (Mica Glass)',
    tag: '毛玻璃晶莹',
    description: '微软云母与 macOS 拟态亚克力质感，透亮背景与晶莹控件磨砂',
    bgEnabled: true,
    bgBrightness: 95,
    bgBlur: 0,
    bgOpacity: 90,
    bgTint: 'rgba(15, 23, 42, 0.25)',
    cardBg: 'rgba(255, 255, 255, 0.45)',
    cardOpacity: 55,
    cardBlur: 16,
    cardSaturate: 160,
    cardBorder: 'rgba(255, 255, 255, 0.4)',
    cardShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.08)',
    accentColor: '#0ea5e9',
    primaryFont: 'sans-serif',
    borderRadius: '16px',
    isConstructivism: false,
    blurScope: 'all_containers',
    controlBlur: 16,
    controlOpacity: 70
  },
  aurora: {
    id: 'aurora',
    name: '梦幻极光 (Aurora Glow)',
    tag: '炫彩流光',
    description: '梦幻流彩渐变氛围，温润雅致的高清半透浮空面板与霓彩微光',
    bgEnabled: true,
    bgBrightness: 98,
    bgBlur: 2,
    bgOpacity: 92,
    bgTint: 'rgba(15, 23, 42, 0.35)',
    cardBg: 'rgba(255, 255, 255, 0.65)',
    cardOpacity: 70,
    cardBlur: 12,
    cardSaturate: 180,
    cardBorder: 'rgba(255, 255, 255, 0.5)',
    cardShadow: '0 12px 36px rgba(139, 92, 246, 0.12)',
    accentColor: '#8b5cf6',
    primaryFont: 'sans-serif',
    borderRadius: '18px',
    isConstructivism: false,
    blurScope: 'all_containers',
    controlBlur: 14,
    controlOpacity: 80
  },
  cyberpunk: {
    id: 'cyberpunk',
    name: '赛博暗霓 (Cyber Neon)',
    tag: '黑客机能',
    description: '深黑机能底盘搭配高饱和霓虹荧光，硬核科技沉浸与锐利轮廓光晕',
    bgEnabled: true,
    bgBrightness: 90,
    bgBlur: 0,
    bgOpacity: 95,
    bgTint: 'rgba(3, 7, 18, 0.5)',
    cardBg: 'rgba(15, 23, 42, 0.75)',
    cardOpacity: 85,
    cardBlur: 16,
    cardSaturate: 200,
    cardBorder: 'rgba(14, 165, 233, 0.35)',
    cardShadow: '0 0 25px rgba(14, 165, 233, 0.18)',
    accentColor: '#f43f5e',
    primaryFont: 'sans-serif',
    borderRadius: '10px',
    isConstructivism: false,
    blurScope: 'all_containers',
    controlBlur: 12,
    controlOpacity: 90
  },
  constructivism: {
    id: 'constructivism',
    name: '构成主义 (Constructivism)',
    tag: '先锋前卫',
    description: '20世纪苏俄先锋构成主义：非对称几何张力网格、红黑高对比与重型工业排版',
    bgEnabled: false,
    bgBrightness: 100,
    bgBlur: 0,
    bgOpacity: 100,
    bgTint: 'transparent',
    cardBg: '#f2efe9',
    cardOpacity: 100,
    cardBlur: 0,
    cardSaturate: 100,
    cardBorder: '#111111',
    cardShadow: '6px 6px 0px #111111',
    accentColor: '#d92027',
    primaryFont: '"Impact", "Franklin Gothic Heavy", "Arial Black", "PingFang SC", sans-serif',
    borderRadius: '0px',
    isConstructivism: true,
    blurScope: 'none',
    controlBlur: 0,
    controlOpacity: 100
  }
};

// 响应式主题配置
export const currentTheme = reactive({
  ...PRESETS.default,
  // 暗色调模式: 'light' | 'dark' | 'auto'
  colorMode: 'light',
  // 内置预设壁纸ID（如果选了内置纯CSS壁纸）
  presetBgId: ''
});

// 壁纸 Data URL 缓存
export const currentWallpaperUrl = ref('');

// 打开 IndexedDB
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 获取壁纸
export async function loadStoredWallpaper() {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get('custom_bg');
      req.onsuccess = () => {
        if (req.result) {
          currentWallpaperUrl.value = req.result;
          resolve(req.result);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn('读取本地壁纸失败:', e);
    return null;
  }
}

// 保存壁纸到 IndexedDB
export async function saveWallpaper(dataUrl) {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(dataUrl, 'custom_bg');
      tx.oncomplete = () => {
        currentWallpaperUrl.value = dataUrl;
        currentTheme.bgEnabled = true;
        currentTheme.presetBgId = '';
        applyTheme();
        saveThemeConfig();
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('保存壁纸失败:', e);
    throw e;
  }
}

// 清除壁纸
export async function clearWallpaper() {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete('custom_bg');
      tx.oncomplete = () => {
        currentWallpaperUrl.value = '';
        currentTheme.presetBgId = '';
        currentTheme.bgEnabled = false;
        applyTheme();
        saveThemeConfig();
        resolve(true);
      };
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.warn('清除壁纸失败:', e);
  }
}

// 设置内置壁纸
export async function setPresetWallpaper(presetId) {
  currentTheme.presetBgId = presetId;
  currentTheme.bgEnabled = true;
  // 如果之前存了自定义壁纸，则清空 IndexedDB，使预设背景生效
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete('custom_bg');
    currentWallpaperUrl.value = '';
  } catch (e) {
    console.warn('清理旧壁纸失败:', e);
  }
  applyTheme();
  saveThemeConfig();
}

// 保存主题设置到 localStorage
export function saveThemeConfig() {
  try {
    const payload = { ...currentTheme };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('保存主题配置失败:', e);
  }
}

// 读取主题配置
export function loadThemeConfig() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      Object.assign(currentTheme, saved);
    }
  } catch (e) {
    console.warn('解析主题配置失败:', e);
  }
}

// 颜色推导已统一收敛到 theme/ 目录：
//   theme/color.js  —— 纯色彩运算与对比度守卫
//   theme/tokens.js —— 设计令牌引擎（表面合成 + 前景校验）
// 早期散落在此处的 parseColor/composite/ensureContrast 等重复实现已移除，
// 避免同一条规则两处维护、只改一处又漏一处。

// 核心：注入动态 CSS 变量至 document.documentElement
//
// 颜色令牌全部交给 theme/tokens.js 统一推导：引擎会先合成每个表面的
// 真实呈现色，再对每个前景做强制对比度校验，因此浅底浅字 / 深底深字
// 在生成阶段就不可能发生。这里只负责把令牌写进 DOM，并处理与
// 颜色无关的视觉参数（圆角、模糊、壁纸、阴影）。
export function applyTheme() {
  const root = document.documentElement;
  const t = currentTheme;

  // 判断是否为暗色调
  let isDark = false;
  if (t.colorMode === 'dark') {
    isDark = true;
  } else if (t.colorMode === 'auto') {
    isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  // ---- 颜色令牌：由引擎统一推导并注入 ----
  const tokens = buildTokens({ ...t }, isDark);
  for (const [name, value] of Object.entries(tokens)) {
    if (typeof value === 'string' && name.startsWith('--mi-')) {
      root.style.setProperty(name, value);
    }
  }

  // ---- 与颜色无关的视觉参数 ----
  root.style.setProperty('--mi-radius-md', t.borderRadius);
  root.style.setProperty('--mi-radius-lg', t.borderRadius === '0px' ? '0px' : '20px');
  root.style.setProperty('--mi-radius-sm', t.borderRadius === '0px' ? '0px' : '6px');
  root.style.setProperty('--mi-control-blur', `${t.controlBlur ?? 16}px`);
  root.style.setProperty('--mi-control-opacity', `${(t.controlOpacity ?? 70) / 100}`);

  // 背景样式与渐变注入
  if (t.presetBgId) {
    const pBg = PRESET_WALLPAPERS.find(p => p.id === t.presetBgId);
    root.style.setProperty('--mi-custom-bg-image', pBg ? pBg.css : 'none');
  } else if (currentWallpaperUrl.value) {
    // CSS 自定义属性有长度上限（实测约 2MB），超限会被静默丢弃：
    // setProperty 不报错，但 getPropertyValue 读回空字符串，背景直接不显示。
    // 这里做一次兜底：写入后立刻读回校验，失败就退化为纯色底并告警，
    // 避免出现「数据都在、界面却空白且毫无提示」这种最难排查的状态。
    root.style.setProperty('--mi-custom-bg-image', `url(${currentWallpaperUrl.value})`);
    const applied = root.style.getPropertyValue('--mi-custom-bg-image');
    if (!applied) {
      const mb = (currentWallpaperUrl.value.length / 1048576).toFixed(1);
      console.warn(
        `[theme] 壁纸过大（data URL ${mb}MB），超出 CSS 变量长度上限，已放弃应用。` +
          `该图片应在 utils/image.js 的 optimizeWallpaper 中压缩后再入库。`
      );
      root.style.setProperty('--mi-custom-bg-image', 'none');
    }
  } else {
    root.style.setProperty('--mi-custom-bg-image', 'none');
  }

  // 卡片阴影与磨砂范围
  if (t.id === 'default' && !t.bgEnabled && !currentWallpaperUrl.value && !t.presetBgId) {
    root.style.setProperty('--mi-backdrop-blur', 'none');
    root.style.setProperty('--mi-backdrop-saturate', '100%');
    root.style.setProperty('--mi-card-shadow', isDark ? '0 4px 20px rgba(0, 0, 0, 0.4)' : '0 4px 20px rgba(0, 0, 0, 0.04)');
    root.classList.remove('theme-constructivism', 'theme-mica', 'theme-mica-controls-only', 'theme-mica-all-containers');
  } else {
    root.style.setProperty('--mi-backdrop-blur', `${t.cardBlur}px`);
    root.style.setProperty('--mi-backdrop-saturate', `${t.cardSaturate}%`);
    root.style.setProperty('--mi-card-shadow', t.cardShadow);

    if (t.isConstructivism) {
      root.classList.add('theme-constructivism');
      root.classList.remove('theme-mica', 'theme-mica-controls-only', 'theme-mica-all-containers');
    } else {
      root.classList.add('theme-mica');
      root.classList.remove('theme-constructivism');
      if (t.blurScope === 'controls_only') {
        root.classList.add('theme-mica-controls-only');
        root.classList.remove('theme-mica-all-containers');
      } else {
        root.classList.add('theme-mica-all-containers');
        root.classList.remove('theme-mica-controls-only');
      }
    }
  }

  // 磨砂玻璃的底色与描边都由引擎的令牌提供
  // （--mi-control-bg-glass / --mi-control-border-glass 已在 buildTokens 中生成），
  // 此处不再二次覆写，避免两处规则互相打架。

  // 写入背景滤镜变量
  root.style.setProperty('--mi-bg-brightness', `${t.bgBrightness}%`);
  root.style.setProperty('--mi-bg-blur', `${t.bgBlur}px`);
  root.style.setProperty('--mi-bg-opacity', `${t.bgOpacity / 100}`);
  root.style.setProperty('--mi-bg-tint', t.bgTint);
}

// 切换预设
export function switchPreset(presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) return;
  // 保留用户原本的 colorMode 和可能设置的壁纸配置偏好
  const savedMode = currentTheme.colorMode;
  Object.assign(currentTheme, preset);
  currentTheme.colorMode = savedMode;
  applyTheme();
  saveThemeConfig();
}

// 导出主题为 JSON
export function exportThemeJSON(includeWallpaper = false) {
  const exportData = {
    app: 'mijia-web-console',
    version: '1.1',
    exportAt: new Date().toISOString(),
    config: { ...currentTheme },
    wallpaper: includeWallpaper ? currentWallpaperUrl.value : null
  };
  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `theme_${currentTheme.id || 'custom'}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// 导入主题 JSON
export async function importThemeJSON(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!data.config) throw new Error('无效的主题配置文件：缺失 config 字段');
    Object.assign(currentTheme, data.config);
    if (data.wallpaper) {
      await saveWallpaper(data.wallpaper);
    } else {
      applyTheme();
      saveThemeConfig();
    }
    return { ok: true, name: data.config.name || '已导入主题' };
  } catch (e) {
    console.error('导入主题失败:', e);
    return { ok: false, error: e.message };
  }
}
