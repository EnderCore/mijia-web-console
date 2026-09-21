/**
 * 客户端离线缓存中间件 (IndexedDB + localStorage)
 * 解决弱网、离线环境下的元数据秒开，无需重复请求网络。
 *
 * 除读写外还提供管理能力（统计 / 分类 / 清理），供「缓存管理」面板使用。
 * 之所以需要管理能力：这些数据落在用户浏览器里，占用会随使用不断累积，
 * 而此前用户既看不到它占了多少，也没有任何办法清掉。
 */

const DB_NAME = 'MijiaWebCache';
const STORE_NAME = 'media_cache';
const DB_VERSION = 1;

// 主题壁纸所在的库（由 utils/theme.js 维护）。统计时需要一并纳入，
// 否则「本地存储占用」会漏掉体积最大的那张壁纸。
const THEME_DB_NAME = 'MiNasThemeStorage';
const THEME_STORE_NAME = 'backgrounds';

// localStorage 中属于本应用的缓存键前缀
const LS_PREFIX = 'mijia_';

let dbPromise = null;

function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return resolve(null);
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

export async function setCachedData(key, value) {
  try {
    const db = await getDB();
    if (!db) {
      localStorage.setItem(`${LS_PREFIX}${key}`, JSON.stringify(value));
      return;
    }
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ key, value, timestamp: Date.now() });
  } catch (e) {
    try {
      localStorage.setItem(`${LS_PREFIX}${key}`, JSON.stringify(value));
    } catch (_) {}
  }
}

export async function getCachedData(key) {
  try {
    const db = await getDB();
    if (!db) {
      const v = localStorage.getItem(`${LS_PREFIX}${key}`);
      return v ? JSON.parse(v) : null;
    }
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    try {
      const v = localStorage.getItem(`${LS_PREFIX}${key}`);
      return v ? JSON.parse(v) : null;
    } catch (_) {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// 缓存管理
// ---------------------------------------------------------------------------

/** 缓存的友好名称：把内部 key 映射成用户看得懂的模块名。 */
const CACHE_LABELS = {
  cache_status: '设备状态',
  cache_system: '硬件信息',
  cache_users: '存储与用户配额',
  cache_apps: '应用列表',
  cache_files: '文件列表'
};

/** 估算一个值序列化后的字节数（JS 字符串按 UTF-16 约 2 字节/字符）。 */
function byteSizeOf(value) {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    return s ? s.length * 2 : 0;
  } catch (_) {
    return 0;
  }
}

/** 打开一个已存在的库用于只读统计；库不存在时返回 null（不主动创建）。 */
function openExistingDb(name) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) return resolve(null);
    if (indexedDB.databases) {
      // 支持 indexedDB.databases() 时先探测，避免统计动作凭空空建一个库
      indexedDB
        .databases()
        .then((list) => {
          if (!list.some((d) => d.name === name)) return resolve(null);
          begin();
        })
        .catch(begin);
      return;
    }
    begin();

    function begin() {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // 不带版本号打开一个不存在的库，浏览器会走到这里并把它建出来。
      // 统计是只读动作，不该凭空多出一个空库，因此直接中止升级。
      req.onupgradeneeded = (e) => {
        try {
          e.target.transaction.abort();
        } catch (_) {}
        resolve(null);
      };
    }
  });
}

function readAllFromStore(db, storeName) {
  return new Promise((resolve) => {
    if (!db || !db.objectStoreNames.contains(storeName)) return resolve([]);
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (_) {
      resolve([]);
    }
  });
}

/**
 * 汇总本地缓存现状。
 * 返回 { items, totalBytes, byCategory }，items 按体积降序。
 */
export async function getCacheStats() {
  const items = [];

  // 1. IndexedDB 元数据缓存
  const db = await getDB();
  const rows = await readAllFromStore(db, STORE_NAME);
  for (const r of rows) {
    if (!r || !r.key) continue;
    items.push({
      id: `idb:${r.key}`,
      key: r.key,
      name: CACHE_LABELS[r.key] || r.key,
      category: '元数据缓存',
      store: 'idb',
      bytes: byteSizeOf(r.value),
      timestamp: r.timestamp || 0
    });
  }

  // 2. 自定义壁纸：通常体积最大，单独成类
  const themeDb = await openExistingDb(THEME_DB_NAME);
  const walls = await readAllFromStore(themeDb, THEME_STORE_NAME);
  if (walls.length > 0 && walls[0]) {
    items.push({
      id: 'wallpaper:custom_bg',
      key: 'custom_bg',
      name: '自定义壁纸',
      category: '壁纸与外观',
      store: 'theme',
      bytes: byteSizeOf(walls[0]),
      timestamp: 0
    });
  }

  // 3. localStorage 回退缓存
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LS_PREFIX)) continue;
      const bare = k.slice(LS_PREFIX.length);
      items.push({
        id: `ls:${k}`,
        key: k,
        name: CACHE_LABELS[bare] || bare,
        category: '数据键值',
        store: 'localstorage',
        bytes: byteSizeOf(localStorage.getItem(k)),
        timestamp: 0
      });
    }
  } catch (_) {}

  items.sort((a, b) => b.bytes - a.bytes);

  const byCategory = {};
  let totalBytes = 0;
  for (const it of items) {
    totalBytes += it.bytes;
    byCategory[it.category] = (byCategory[it.category] || 0) + it.bytes;
  }

  return { items, totalBytes, byCategory };
}

/** 读取浏览器分配给本站的存储配额（支持时返回，否则 null）。 */
export async function getStorageQuota() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      return { usage: est.usage || 0, quota: est.quota || 0 };
    }
  } catch (_) {}
  return null;
}

/** 删除单条缓存。 */
export async function removeCacheItem(item) {
  if (!item) return false;
  try {
    if (item.store === 'idb') {
      const db = await getDB();
      if (!db) return false;
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(item.key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    }
    if (item.store === 'theme') {
      const db = await openExistingDb(THEME_DB_NAME);
      if (!db || !db.objectStoreNames.contains(THEME_STORE_NAME)) return false;
      return new Promise((resolve) => {
        const tx = db.transaction(THEME_STORE_NAME, 'readwrite');
        tx.objectStore(THEME_STORE_NAME).delete('custom_bg');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    }
    if (item.store === 'localstorage') {
      localStorage.removeItem(item.key);
      return true;
    }
  } catch (_) {}
  return false;
}

/**
 * 清空缓存。
 * @param {object} opts
 * @param {boolean} opts.includeWallpaper 是否一并清除自定义壁纸。
 *        默认 false —— 壁纸是用户主动设置的结果，误删会让人措手不及，
 *        因此必须由用户显式勾选。
 */
export async function clearAllCache({ includeWallpaper = false } = {}) {
  const result = { cleared: 0, failed: 0 };

  // 1. IndexedDB 元数据
  try {
    const db = await getDB();
    if (db) {
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
      result.cleared++;
    }
  } catch (_) {
    result.failed++;
  }

  // 2. localStorage 回退缓存
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) doomed.push(k);
    }
    for (const k of doomed) {
      localStorage.removeItem(k);
      result.cleared++;
    }
  } catch (_) {
    result.failed++;
  }

  // 3. 壁纸（可选）
  if (includeWallpaper) {
    try {
      const db = await openExistingDb(THEME_DB_NAME);
      if (db && db.objectStoreNames.contains(THEME_STORE_NAME)) {
        await new Promise((resolve) => {
          const tx = db.transaction(THEME_STORE_NAME, 'readwrite');
          tx.objectStore(THEME_STORE_NAME).delete('custom_bg');
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
        result.cleared++;
      }
    } catch (_) {
      result.failed++;
    }
  }

  return result;
}

// ==========================================================================
// 服务端磁盘缓存管理 (server/cache) 与浏览器 HTTP Disk Cache 强缓存击穿控制
// ==========================================================================

const THUMB_EPOCH_KEY = 'mijia_thumb_epoch';

/** 获取当前缩略图版本戳（用于在 URL 拼接 &v= 防止命中浏览器不可变强缓存） */
export function getThumbEpoch() {
  try {
    const v = localStorage.getItem(THUMB_EPOCH_KEY);
    return v ? parseInt(v, 10) : 1;
  } catch (_) {
    return 1;
  }
}

/** 递增并保存缩略图版本戳 */
export function bumpThumbEpoch(newEpoch) {
  try {
    const v = newEpoch || Date.now();
    localStorage.setItem(THUMB_EPOCH_KEY, String(v));
    return v;
  } catch (_) {
    return Date.now();
  }
}

/**
 * 获取服务端 (server/cache) 缩略图与转码产物的磁盘统计数据
 */
export async function getServerCacheStats() {
  try {
    const res = await fetch('/api/cache/stats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.epoch) {
      bumpThumbEpoch(data.epoch);
    }
    return data;
  } catch (e) {
    return {
      status: 'error',
      message: e.message,
      totalFiles: 0,
      totalBytes: 0,
      byCategory: {
        thumbnails: { count: 0, bytes: 0, label: 'WebDAV 缩略图 (.img)' },
        transcoded: { count: 0, bytes: 0, label: 'HEIC 转码副本 (.jpg)' },
        icons: { count: 0, bytes: 0, label: '系统/应用图标 (.png)' }
      }
    };
  }
}

/**
 * 请求服务端安全清理磁盘缓存
 * @param {string} kind "thumbnails" | "all"
 */
export async function clearServerCache(kind = 'thumbnails') {
  try {
    const res = await fetch('/api/cache/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // 清理成功后立即刷新本地版本号，击穿浏览器的 HTTP Disk Cache！
    if (data.epoch) {
      bumpThumbEpoch(data.epoch);
    } else {
      bumpThumbEpoch(Date.now());
    }
    return data;
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/** 人类可读的体积格式。 */
export function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), units.length - 1);
  const v = b / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
