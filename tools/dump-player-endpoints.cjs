/**
 * 只读静态分析：还原官方客户端 player.js 中混淆的真实接口路径。
 *
 * player.js 用 javascript-obfuscator 的字符串数组 + 带密钥 RC4 混淆：
 *   表项 = base64( 百分号编码( RC4 密文 ) )，解码 = base64解 -> 百分号解 -> RC4解
 *   调用形如 _0xefbe2a(0x186,'sQaS')，密钥写在每个函数自己的对象字面量里。
 *
 * 两个必须注意的点：
 *  1. 文件顶部的 IIFE 会「旋转」字符串表（push(shift())）直到校验和匹配。
 *     跳过它会让所有索引偏移，解出来全是乱码——所以整个文件都要执行。
 *  2. 密钥属性名（如 _0x152262）在不同函数中代表不同字符串，必须按「离调用点
 *     最近的对象字面量」解析，用全局映射同样会得到乱码。
 *
 * 执行方式：把整个文件包进 try/catch 的匿名函数里在 vm 沙箱中运行，require 全部
 * 替换为空桩。顶层代码可能因缺少 electron 环境而抛错，但函数声明会提升，解码器
 * 依然可用。不触网、不读文件、不修改源文件。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PLAYER_JS = process.argv[2] || path.join(
  "K:", "DATA", "AI", "ZCode", "xiaomi智能存储",
  "analysis", "extracted", "app-asar", "public", "electron", "service", "deviceMgn", "player.js"
);
const src = fs.readFileSync(PLAYER_JS, "utf8");

// 解码函数名 = 被别名引用的那个
const am = src.match(/const\s+(_0x[0-9a-f]+)\s*=\s*(_0x[0-9a-f]+)\s*;/);
if (!am) { console.error("未找到别名声明"); process.exit(1); }
const aliasName = am[1];
const decName = am[2];

// 整个文件包进匿名函数 + try/catch：函数声明提升保证解码器可用
const wrapped = `
(function(){
  try {
${src}
  } catch (e) { /* 顶层缺少 electron 运行环境，忽略 */ }
  try { module.exports.__d = ${decName}; } catch (e) {}
  try { module.exports.__alias = ${aliasName}; } catch (e) {}
})();
`;

const stubRequire = () => {
  const h = new Proxy(function () {}, { get: () => h, apply: () => h, construct: () => h });
  return new Proxy({}, { get: () => h });
};

const sandbox = {
  require: stubRequire,
  module: { exports: {} },
  exports: {},
  console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
  process: { platform: "win32", env: {}, nextTick: (f) => { try { f(); } catch (e) {} }, on() {}, versions: {} },
  Buffer,
  setTimeout: () => 0,
  setInterval: () => 0,
  setImmediate: () => 0,
  clearTimeout: () => {},
  clearInterval: () => {},
  __dirname: path.dirname(PLAYER_JS),
  __filename: PLAYER_JS,
};
sandbox.global = sandbox;
sandbox.globalThis = sandbox;

try {
  vm.runInNewContext(wrapped, vm.createContext(sandbox), { timeout: 30000 });
} catch (e) {
  console.error("沙箱执行失败:", e.message);
  process.exit(1);
}
const decode = sandbox.module.exports.__d;
if (typeof decode !== "function") { console.error("未取得解码函数"); process.exit(1); }

// ---------- 收集每个对象字面量的「属性名 -> 字符串值」，按位置就近解析密钥 ----------
const scopes = [];
{
  const blocks = [];
  const blkRe = /(_0x[0-9a-f]+)\s*=\s*\{/g;
  let b;
  while ((b = blkRe.exec(src)) !== null) blocks.push(b.index);

  const byBlock = new Map();
  const re = /(_0x[0-9a-f]+)\s*:\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let best = -1;
    for (const s of blocks) { if (s < m.index) best = s; else break; }
    if (best < 0) continue;
    if (!byBlock.has(best)) byBlock.set(best, new Map());
    byBlock.get(best).set(m[1], m[2]);
  }
  for (const [start, map] of byBlock) scopes.push({ start, map });
  scopes.sort((a, b) => a.start - b.start);
}
const keyForProp = (prop, pos) => {
  let best = null;
  for (const s of scopes) { if (s.start < pos) best = s; else break; }
  return best ? best.map.get(prop) : undefined;
};

// ---------- 抓取所有调用点 ----------
// 调用点用函数内的局部别名（const _0x1422e2 = _0xefbe2a）调用，别名声明形式不统一，
// 逐个枚举别名会漏。这里直接匹配「任意 _0xNNNN(索引, 密钥)」形式的调用，
// 再用「解出的字符串是否可打印」过滤掉解码器之外函数产生的噪声。
const callRe = String.raw`(_0x[0-9a-f]+)\(\s*(0x[0-9a-f]+)\s*,\s*(?:'([^']*)'|(_0x[0-9a-f]+)\.(_0x[0-9a-f]+))\s*\)`;
const calls = [];
let m;
const re = new RegExp(callRe, "g");
while ((m = re.exec(src)) !== null) {
  const key = m[3] !== undefined ? m[3] : keyForProp(m[5], m.index);
  if (key === undefined) continue;
  calls.push({ index: parseInt(m[2], 16), key });
}

// ---------- 解码 ----------
const uniq = new Map();
for (const { index, key } of calls) {
  try {
    const v = decode(index, key);
    if (typeof v === "string" && v.length > 1 && !uniq.has(v)) uniq.set(v, { index, key });
  } catch (e) { /* 单个失败忽略 */ }
}
const all = [...uniq.keys()].sort();

console.log(`解码出 ${all.length} 条唯一字符串（调用点 ${calls.length} 个）\n`);
const show = (title, list, limit = 400) => {
  console.log(`=== ${title} ===`);
  if (list.length === 0) console.log("  (无)");
  list.slice(0, limit).forEach((s) => console.log("  " + s));
  if (list.length > limit) console.log(`  ... 另有 ${list.length - limit} 条`);
  console.log("");
};

show("/cgi-bin/luci 接口", all.filter((s) => /cgi-bin\/luci/.test(s)));
show("疑似模块/动作路径 (a/b 形式)", all.filter((s) => /^[a-z_]+(\/[a-z_]+)+$/.test(s)));
show("含 transcode/subtitle/m3u8/resolution", all.filter((s) => /transcode|subtitle|m3u8|resolution/i.test(s)));
show("全部可打印字符串", all.filter((s) => /^[\x20-\x7e\u4e00-\u9fff]+$/.test(s)));
