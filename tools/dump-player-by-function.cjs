/**
 * 只读静态分析：按函数名逐个还原官方 player.js 里用到的真实接口路径。
 *
 * player.js 的函数名没有混淆（transcodeCreateTask 等），只有字符串被混淆。
 * 所以可以定位每个函数的函数体，只解码其中出现的字符串——这样得到的
 * 「函数 -> 接口路径」对应关系是确定的，可以直接和我们的网关实现比对。
 *
 * 只读：不触网、不写文件、不修改源文件。
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const FILE = process.argv[2] || path.join(
  "K:", "DATA", "AI", "ZCode", "xiaomi智能存储",
  "analysis", "extracted", "app-asar", "public", "electron", "service", "deviceMgn", "player.js"
);
const src = fs.readFileSync(FILE, "utf8");

function sliceFunction(source, startIdx) {
  const open = source.indexOf("{", startIdx);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return source.slice(startIdx, i + 1);
  }
  return null;
}

// 顶层别名与解码函数名
const am = src.match(/const\s+(_0x[0-9a-f]+)\s*=\s*(_0x[0-9a-f]+)\s*;/);
const decName = am[2];

// 沙箱求值（保留表旋转 IIFE）
const stubRequire = () => {
  const h = new Proxy(function () {}, { get: () => h, apply: () => h, construct: () => h });
  return new Proxy({}, { get: () => h });
};
const sandbox = {
  require: stubRequire,
  module: { exports: {} },
  exports: {},
  console: { log() {}, warn() {}, error() {} },
  process: { platform: "win32", env: {}, nextTick: () => {} },
  Buffer,
  setTimeout: () => 0,
  setInterval: () => 0,
  clearTimeout: () => {},
  clearInterval: () => {},
};
sandbox.global = sandbox;
sandbox.globalThis = sandbox;

vm.runInNewContext(
  `(function(){try{\n${src}\n}catch(e){}try{module.exports.__d=${decName};}catch(e){}})();`,
  vm.createContext(sandbox), { timeout: 30000 }
);
const decode = sandbox.module.exports.__d;

// 每个对象字面量的属性映射，按位置就近解析密钥
const scopes = [];
{
  const blocks = [];
  const blkRe = /(_0x[0-9a-f]+)\s*=\s*\{/g;
  let m;
  while ((m = blkRe.exec(src)) !== null) blocks.push(m.index);
  const byBlock = new Map();
  const re = /(_0x[0-9a-f]+)\s*:\s*'([^']*)'/g;
  while ((m = re.exec(src)) !== null) {
    let best = -1;
    for (const b of blocks) { if (b < m.index) best = b; else break; }
    if (best < 0) continue;
    if (!byBlock.has(best)) byBlock.set(best, new Map());
    byBlock.get(best).set(m[1], m[2]);
  }
  for (const [start, map] of byBlock) scopes.push({ start, map });
  scopes.sort((a, b) => a.start - b.start);
}
const keyFor = (prop, pos) => {
  let best = null;
  for (const s of scopes) { if (s.start < pos) best = s; else break; }
  return best ? best.map.get(prop) : undefined;
};

// 枚举文件里所有具名函数
const fnRe = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
let fm;
const seen = new Set();
while ((fm = fnRe.exec(src)) !== null) {
  const name = fm[1];
  if (seen.has(name)) continue;
  seen.add(name);

  const body = sliceFunction(src, fm.index);
  if (!body) continue;

  const out = new Set();
  const callRe = /(_0x[0-9a-f]+)\(\s*(0x[0-9a-f]+)\s*,\s*(?:'([^']*)'|(_0x[0-9a-f]+)\.(_0x[0-9a-f]+))\s*\)/g;
  let m;
  while ((m = callRe.exec(body)) !== null) {
    const key = m[3] !== undefined ? m[3] : keyFor(m[5], fm.index + m.index);
    if (key === undefined) continue;
    try {
      const v = decode(parseInt(m[2], 16), key);
      if (typeof v === "string" && v.length > 1) out.add(v);
    } catch (e) { /* 忽略 */ }
  }

  // 只输出含接口路径或关键字段的函数
  const list = [...out].sort();
  const hit = list.filter((s) => /^\/|\/player\/|\/luci\/|\/filemgr\/|_task$|m3u8|resolution|subtitle/i.test(s));
  if (hit.length === 0) continue;

  console.log("=== " + name);
  hit.forEach((s) => console.log("    " + s));
}
