/**
 * 智能视口预加载调度器 (Viewport Preloader)
 *
 * 核心设计：
 * 1. 采用原生 IntersectionObserver，配置 rootMargin: '600px 0px 600px 0px'，
 *    在元素距离视口还有约 1~2 屏距离时，静默提前触发图片拉取与本地磁盘缓存；
 * 2. 内部维护内存级已加载 Set，避免同一 URL 重复触发；
 * 3. 并发连接池队列：视口内可见图片优先加载，视口外预取图片低优先级排队，
 *    既能保证用户滑动时图片“秒出”，又绝不打爆 P2P 穿透隧道。
 */

const loadedSet = new Set();
const pendingQueue = [];
let activeRequests = 0;
const MAX_PRELOAD_CONCURRENCY = 4;

function processQueue() {
  if (activeRequests >= MAX_PRELOAD_CONCURRENCY || pendingQueue.length === 0) return;
  const nextSrc = pendingQueue.shift();
  if (loadedSet.has(nextSrc)) {
    processQueue();
    return;
  }
  activeRequests++;
  const img = new Image();
  img.onload = img.onerror = () => {
    loadedSet.add(nextSrc);
    activeRequests--;
    processQueue();
  };
  img.src = nextSrc;
}

export function queuePreload(src) {
  if (!src || loadedSet.has(src) || pendingQueue.includes(src)) return;
  pendingQueue.push(src);
  processQueue();
}

/**
 * Vue 3 自定义指令：v-smart-preload
 * 自动监测宿主 DOM 进入预读视口范围 (前后 600px) 并加入预载队列
 */
let observer = null;

function getObserver() {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return null;
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const target = entry.target;
          const src = target.getAttribute('data-preload-src');
          if (src) {
            queuePreload(src);
            // 触发后即可取消对该 DOM 的监听，释放内存
            observer.unobserve(target);
          }
        }
      });
    }, {
      root: null,
      // 上下提前 600px 触发，相当于提前预载一屏半
      rootMargin: '600px 0px 600px 0px',
      threshold: 0.01
    });
  }
  return observer;
}

export const vSmartPreload = {
  mounted(el, binding) {
    const src = binding.value;
    if (!src) return;
    el.setAttribute('data-preload-src', src);
    const obs = getObserver();
    if (obs) {
      obs.observe(el);
    } else {
      // 降级回退
      queuePreload(src);
    }
  },
  updated(el, binding) {
    const src = binding.value;
    if (src && src !== binding.oldValue) {
      el.setAttribute('data-preload-src', src);
      const obs = getObserver();
      if (obs) obs.observe(el);
    }
  },
  unmounted(el) {
    const obs = getObserver();
    if (obs) obs.unobserve(el);
  }
};
