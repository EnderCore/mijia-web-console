/**
 * 脱敏（隐私遮罩）工具
 *
 * 用途：截图分享给他人前，一键隐藏设备标识类信息（DID、序列号、UID、
 * IP/MAC、存储路径等）。
 *
 * 实现要点：
 *  - 模块级 ref 作为单例，所有组件共享同一开关状态，无需层层传 props。
 *  - 状态写入 localStorage，刷新后保持。
 *  - 脱敏只作用于「显示」，不影响任何数据请求 —— 请求仍用原始值，
 *    因此开启后功能完全正常（这点很重要：脱敏不能把功能弄坏）。
 */

import { ref } from 'vue';

const STORAGE_KEY = 'mijia_privacy_mask';

// 初始值从 localStorage 读取；SSR 或隐私模式下 localStorage 不可用时退回 true。
//
// 默认开启：设备标识（DID / 序列号 / UID / IP / MAC / 路径）在截图分享时
// 极易外泄，而「忘了点脱敏」的代价远大于「多按一次才能看到真实值」。
// 只有用户显式关过（存了 '0'）才保持关闭 —— 所以需要区分「从未设置」和
// 「设置为关闭」，不能简单用 `=== '1'` 判断（那样默认是关的）。
function readInitial() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === null) return true;
    return v === '1';
  } catch (e) {
    return true;
  }
}

const masked = ref(readInitial());

/** 保留首尾若干个字符，中间用 * 代替 */
function starMiddle(s, head, tail) {
  const str = String(s);
  // 注意：tail 为 0 时不能用 str.slice(-0) —— 那等于 slice(0)，会把原文整段拼回来，
  // 等于没脱敏。所以这里显式区分 tail=0。
  const tailPart = tail > 0 ? str.slice(-tail) : '';
  const headPart = str.slice(0, head);
  const hidden = str.length - headPart.length - tailPart.length;
  if (hidden <= 0) return '*'.repeat(Math.max(str.length, 4));
  return headPart + '*'.repeat(Math.min(hidden, 10)) + tailPart;
}

/** 掩码字符，长度与实际内容脱钩，避免通过长度反推 */
const MASK = '••••••';

/**
 * 按类型脱敏。
 * @param {any} value 原始值
 * @param {string} kind 取值：did | serial | uid | ip | mac | path | text
 */
export function maskValue(value, kind = 'text') {
  if (!masked.value) return value;
  if (value === null || value === undefined || value === '') return value;

  const s = String(value);

  switch (kind) {
    case 'did':
      // 设备 DID：保留前 2 位用于辨识是哪台设备
      return starMiddle(s, 2, 0);

    case 'serial':
      // 序列号：保留前 2 + 后 2
      return starMiddle(s, 2, 2);

    case 'uid':
      // 用户 UID：保留前 1 + 后 1
      return starMiddle(s, 1, 1);

    case 'ip':
      // IPv4 保留前两段（局域网网段通常不敏感），后两段掩盖
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
        const p = s.split('.');
        return `${p[0]}.${p[1]}.*.*`;
      }
      return MASK;

    case 'mac':
      // MAC 保留前三段（厂商 OUI），后三段掩盖
      if (/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(s)) {
        const p = s.split(':');
        return `${p[0]}:${p[1]}:${p[2]}:**:**:**:`;
      }
      return MASK;

    case 'path':
      // 存储路径脱敏只掩盖账号段（/home/u<UID> → /home/u••••），
      // 保留目录结构与文件名 —— 文件管理器要靠路径导航，
      // 全遮掉会让页面没法用，而真正敏感的只是账号 ID。
      return s.replace(/\/home\/(u?)(\w+)/gi, (m, prefix) => `/home/${prefix}${MASK}`);

    default:
      return starMiddle(s, 1, 1);
  }
}

/** 组件里直接用的入口：p.mask(value, kind) 会随 masked 变化自动重算 */
export function usePrivacy() {
  function toggle() {
    masked.value = !masked.value;
    try {
      localStorage.setItem(STORAGE_KEY, masked.value ? '1' : '0');
    } catch (e) {
      /* 存不了就只在本次会话生效 */
    }
  }

  return { masked, toggle, MASK };
}
