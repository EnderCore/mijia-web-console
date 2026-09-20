/**
110	 * 本地主题与外观控制核心 (纯客户端持久化，完全隔离 NAS)
111	 * 
112	 * 核心功能：
113	 * 1. 状态：背景图片 (IndexedDB 存储)、背景亮度/对比度/模糊度；
114	 * 2. 质感：卡片半透明度、磨砂玻璃模糊半径、饱和度、边框光晕；
115	 * 3. 预设：
116	 *    - 'default': 经典米家原版纯净白灰扁平风
117	 *    - 'mica': 微软云母与 macOS 拟态深/浅磨砂质感 (Acrylic / Glassmorphism)
118	 *    - 'constructivism': 苏联/包豪斯构成主义艺术风格 (几何色块、硬朗直角、黑红高对比、机械工程张力)
119	 * 4. 导入导出：支持导出主题配置为 JSON，支持从 JSON 文件导入并立即生效。
120	 */

import { reactive, ref } from 'vue';

const DB_NAME = 'MiNasThemeStorage';
const DB_VERSION = 1;
const STORE_NAME = 'backgrounds';
const SETTINGS_KEY = 'minis_theme_settings_v1';

// 预设定义
export const PRESETS = {
  default: {
    id: 'default',
    name: '经典默认 (米家扁平)',
    description: '官方原版极简白灰扁平风，纯净无额外滤镜',
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
    isConstructivism: false
  },
  mica: {
    id: 'mica',
    name: '云母磨砂 (Mica Glass)',
    description: '微软云母与亚克力毛玻璃质感，透亮磨砂卡片搭配细腻微光',
    bgEnabled: true,
    bgBrightness: 92,
    bgBlur: 8,
    bgOpacity: 90,
    bgTint: 'rgba(15, 23, 42, 0.45)',
    cardBg: 'rgba(255, 255, 255, 0.72)',
    cardOpacity: 78,
    cardBlur: 18,
    cardSaturate: 180,
    cardBorder: 'rgba(255, 255, 255, 0.55)',
    cardShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.12)',
    accentColor: '#0ea5e9',
    primaryFont: 'sans-serif',
    borderRadius: '16px',
    isConstructivism: false
  },
  constructivism: {
    id: 'constructivism',
    name: '构成主义 (Constructivism)',
    description: '20世纪先锋构成主义与包豪斯机械美学：红黑几何色块、硬朗直角与工程排版',
    bgEnabled: true,
    bgBrightness: 95,
    bgBlur: 0,
    bgOpacity: 92,
    bgTint: 'rgba(235, 232, 222, 0.85)',
    cardBg: '#f4f1ea',
    cardOpacity: 96,
    cardBlur: 0,
    cardSaturate: 120,
    cardBorder: '#18181b',
    cardShadow: '6px 6px 0px #09090b',
    accentColor: '#dc2626',
    primaryFont: '"Impact", "Arial Black", "PingFang SC", sans-serif',
    borderRadius: '0px',
    isConstructivism: true
  }
};

// 响应式主题配置
export const currentTheme = reactive({
  ...PRESETS.default
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

// 核心：注入动态 CSS 变量至 document.documentElement
export function applyTheme() {
  const root = document.documentElement;
  const t = currentTheme;

  // 基础颜色与圆角
  root.style.setProperty('--mi-orange', t.accentColor);
  root.style.setProperty('--mi-radius-md', t.borderRadius);
  root.style.setProperty('--mi-radius-lg', t.borderRadius === '0px' ? '0px' : '20px');
  root.style.setProperty('--mi-radius-sm', t.borderRadius === '0px' ? '0px' : '6px');

  // 云母磨砂与卡片半透明参数
  if (t.id === 'default' && !t.bgEnabled) {
    root.style.setProperty('--mi-card-bg', '#ffffff');
    root.style.setProperty('--mi-backdrop-blur', 'none');
    root.style.setProperty('--mi-backdrop-saturate', '100%');
    root.style.setProperty('--mi-card-border', '#eaedf1');
    root.style.setProperty('--mi-card-shadow', '0 4px 20px rgba(0, 0, 0, 0.04)');
    root.classList.remove('theme-constructivism', 'theme-mica');
  } else {
    // 启用磨砂玻璃或自定义透明度
    const opacityDec = (t.cardOpacity / 100).toFixed(2);
    let cardBgVal = t.cardBg;
    if (cardBgVal.startsWith('#')) {
      // 转成带有透明度的 rgba
      const r = parseInt(cardBgVal.slice(1, 3), 16) || 255;
      const g = parseInt(cardBgVal.slice(3, 5), 16) || 255;
      const b = parseInt(cardBgVal.slice(5, 7), 16) || 255;
      cardBgVal = `rgba(${r}, ${g}, ${b}, ${opacityDec})`;
    }
    root.style.setProperty('--mi-card-bg', cardBgVal);
    root.style.setProperty('--mi-backdrop-blur', `${t.cardBlur}px`);
    root.style.setProperty('--mi-backdrop-saturate', `${t.cardSaturate}%`);
    root.style.setProperty('--mi-card-border', t.cardBorder);
    root.style.setProperty('--mi-card-shadow', t.cardShadow);

    if (t.isConstructivism) {
      root.classList.add('theme-constructivism');
      root.classList.remove('theme-mica');
    } else {
      root.classList.add('theme-mica');
      root.classList.remove('theme-constructivism');
    }
  }

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
  Object.assign(currentTheme, preset);
  applyTheme();
  saveThemeConfig();
}

// 导出主题为 JSON
export function exportThemeJSON(includeWallpaper = false) {
  const exportData = {
    app: 'mijia-web-console',
    version: '1.0',
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
