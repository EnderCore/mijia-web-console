/**
 * 客户端离线缓存中间件 (IndexedDB + CacheStorage)
 * 解决弱网、离线环境下的缩略图、元数据秒开，无需重复请求网络
 */

const DB_NAME = 'MijiaWebCache';
const STORE_NAME = 'media_cache';
const DB_VERSION = 1;

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
      localStorage.setItem(`mijia_${key}`, JSON.stringify(value));
      return;
    }
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ key, value, timestamp: Date.now() });
  } catch (e) {
    try {
      localStorage.setItem(`mijia_${key}`, JSON.stringify(value));
    } catch (_) {}
  }
}

export async function getCachedData(key) {
  try {
    const db = await getDB();
    if (!db) {
      const v = localStorage.getItem(`mijia_${key}`);
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
      const v = localStorage.getItem(`mijia_${key}`);
      return v ? JSON.parse(v) : null;
    } catch (_) {
      return null;
    }
  }
}
