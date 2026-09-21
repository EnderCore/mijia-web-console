/**
 * 壁纸图片处理
 *
 * 为什么需要这一步：壁纸是通过 CSS 自定义属性传给背景层的
 * （applyTheme 里 `root.style.setProperty('--mi-custom-bg-image', url(...))`），
 * 而 **CSS 自定义属性有长度上限**。实测（Chromium）：
 *
 *   · 约 1MB   → 正常写入
 *   · 约 2MB   → 被静默丢弃，getPropertyValue 读回空字符串
 *   · 元素直接样式（el.style.backgroundImage）上限高得多，约 28MB
 *
 * 关键在于「静默」：setProperty 不报错、不抛异常，只是读不回来。
 * 结果是一张 15MB 的 PNG 壁纸能成功存进 IndexedDB、能成功解码，
 * 却因为超过 2MB 而完全画不出来，界面上却显示「已加载」。
 *
 * 因此上传时就必须把体积压到上限以内。这里按「先压质量、再压尺寸」
 * 的顺序逼近，目标是 1.5MB —— 留出余量，不贴着临界值走。
 */

// 目标体积上限。CSS 变量实测阈值约 2MB，取 1.5MB 留安全余量。
export const MAX_WALLPAPER_BYTES = 1.5 * 1024 * 1024;

// 长边上限。主流屏幕 2560 宽已足够；再大对背景图没有可见收益。
export const MAX_WALLPAPER_DIM = 2560;

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片无法解码，浏览器可能不支持该格式'));
    img.src = dataUrl;
  });
}

/** 扫描画布，判断是否真的用到了透明通道。 */
function hasTransparency(ctx, w, h) {
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 250) return true;
    }
  } catch (_) {
    // 跨域画布会抛错；壁纸来自本地文件，正常不会走到这里
    return false;
  }
  return false;
}

/**
 * 在给定画布上尝试各种编码组合，返回第一个体积达标的结果。
 *
 * WebP 排在前面：它同时支持有损压缩与透明通道，体积也最小。
 * 浏览器不支持 WebP 编码时 toDataURL 会静默回退成 PNG，
 * 因此必须校验返回值的 MIME 前缀，否则会把一张 PNG 误当成 WebP 收下。
 */
function encodeUnder(canvas, limitBytes, allowTransparency) {
  const attempts = allowTransparency
    ? [['image/webp', 0.92], ['image/webp', 0.8], ['image/png']]
    : [['image/webp', 0.92], ['image/webp', 0.82], ['image/jpeg', 0.9], ['image/jpeg', 0.8]];

  for (const [type, quality] of attempts) {
    const out = quality === undefined ? canvas.toDataURL(type) : canvas.toDataURL(type, quality);
    // 请求 WebP 却拿回 PNG，说明该浏览器不支持这种编码，跳过
    if (type === 'image/webp' && !out.startsWith('data:image/webp')) continue;
    if (out.length <= limitBytes) return out;
  }
  return null;
}

/**
 * 把壁纸压到可用的体积与尺寸。
 *
 * @param {string} dataUrl 原始图片 data URL
 * @returns {Promise<{dataUrl: string, originalBytes: number, bytes: number,
 *                    originalSize: string|null, size: string|null,
 *                    optimized: boolean, reason?: string}>}
 */
export async function optimizeWallpaper(dataUrl) {
  const originalBytes = dataUrl ? dataUrl.length : 0;
  const unchanged = (reason) => ({
    dataUrl,
    originalBytes,
    bytes: originalBytes,
    originalSize: null,
    size: null,
    optimized: false,
    reason
  });

  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return unchanged('不是有效的图片数据');
  }

  let img;
  try {
    img = await loadImage(dataUrl);
  } catch (e) {
    // 解不开的格式（HEIC / TIFF 等）原样返回，由调用方给出明确报错，
    // 不要在这里静默丢掉用户的文件。
    return { ...unchanged('无法解码'), decodeFailed: true, error: e.message };
  }

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const originalSize = `${srcW}×${srcH}`;
  const needShrinkDim = Math.max(srcW, srcH) > MAX_WALLPAPER_DIM;
  const needShrinkBytes = originalBytes > MAX_WALLPAPER_BYTES;

  // 尺寸和体积都达标就不重新编码，避免无谓的画质损失
  if (!needShrinkDim && !needShrinkBytes) {
    return {
      dataUrl, originalBytes, bytes: originalBytes,
      originalSize, size: originalSize, optimized: false, reason: '已达标'
    };
  }

  // 先按长边限制定一个初始缩放比，再根据编码结果逐步收紧
  let scale = Math.min(1, MAX_WALLPAPER_DIM / Math.max(srcW, srcH));
  let result = null;
  let finalW = 0, finalH = 0;

  for (let round = 0; round < 6; round++) {
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    const transparent = hasTransparency(ctx, w, h);
    const encoded = encodeUnder(canvas, MAX_WALLPAPER_BYTES, transparent);
    if (encoded) {
      result = encoded;
      finalW = w;
      finalH = h;
      break;
    }
    // 这一档压不下来，缩小尺寸再试
    scale *= 0.8;
  }

  if (!result) {
    // 极端情况（例如噪点极多的超大图）压不到目标以内，
    // 保留原图并如实标记，让调用方决定是提示还是照常存。
    return {
      dataUrl, originalBytes, bytes: originalBytes,
      originalSize, size: originalSize, optimized: false,
      reason: '压缩后仍超限'
    };
  }

  return {
    dataUrl: result,
    originalBytes,
    bytes: result.length,
    originalSize,
    size: `${finalW}×${finalH}`,
    optimized: true
  };
}
