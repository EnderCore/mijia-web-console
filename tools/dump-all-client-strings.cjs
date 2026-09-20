/**
 * 只读静态分析：把官方客户端所有 JS 的混淆字符串表全部还原出来，输出成文本，
 * 供人工检索（而不是靠预设关键词过滤——那样会漏掉没想到的接口）。
 *
 * 混淆形态：字符串数组 + 带密钥 RC4（javascript-obfuscator rc4 模式）
 *   表项 = base64( 百分号编码( RC4 密文 ) )
 *   调用 = _0xEFB(0x186,'sQaS') 或 _0xEFB(_0xV._0xI, _0xV._0xK)
 *
 * 三个关键点（踩过的坑）：
 *  1. 文件顶部的 IIFE 会旋转字符串表，必须整个文件一起执行，否则索引全偏。
 *  2. 解密密钥写在各函数自己的对象字面量里，同名属性在不同函数代表不同字符串，
 *     必须按「离调用点最近的对象字面量」解析。
 *  3. 索引既可能是字面量也可能是属性引用，两种都要覆盖。
 *
 * 全程只读：require 全部桩掉，不触网、不写文件、不修改任何源文件。
 *
 * 用法：
 *   node tools/dump-all-client-strings.cjs <客户端目录> [输出文件]
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = process.argv[2] || path.join(
  "K:", "DATA", "AI", "ZCode", "xiaomi智能存储",
  "analysis", "extracted", "app-asar", "public", "electron"
);
const OUT = process.argv[3] || "";

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walk(p, out);
    } else if (e.name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

/** 还原单个文件里能解出的全部字符串 */
function decodeFile(file) {
  const src = fs.readFileSync(file, "utf8");
  if (!/_0x[0-9a-f]{4,}\s*\(/.test(src)) return { strings: [], note: "未混淆" };

  const am = src.match(/const\s+(_0x[0-9a-f]+)\s*=\s*(_0x[0-9a-f]+)\s*;/);
  if (!am) return { strings: [], note: "无别名声明" };
  const decName = am[2];

  // 沙箱执行整个文件（保留表旋转 IIFE）
  const stubRequire = () => {
    const h = new Proxy(function () {}, { get: () => h, apply: () => h, construct: () => h });
    return new Proxy({}, { get: () => h });
  };
  const sandbox = {
    require: stubRequire,
    module: { exports: {} },
    exports: {},
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    process: { platform: "win32", env: {}, nextTick: () => {}, on() {}, versions: {} },
    Buffer,
    setTimeout: () => 0,
    setInterval: () => 0,
    setImmediate: () => 0,
    clearTimeout: () => {},
    clearInterval: () => {},
    __dirname: path.dirname(file),
    __filename: file,
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;

  try {
    vm.runInNewContext(
      `(function(){try{\n${src}\n}catch(e){}try{module.exports.__d=${decName};}catch(e){}})();`,
      vm.createContext(sandbox),
      { timeout: 30000 }
    );
  } catch (e) {
    return { strings: [], note: "沙箱执行失败: " + e.message };
  }
  const decode = sandbox.module.exports.__d;
  if (typeof decode !== "function") return { strings: [], note: "未取得解码函数" };

  // 属性名 -> 值（字符串密钥 或 十六进制索引），按对象字面量就近解析
  const scopes = [];
  {
    const blocks = [];
    const blkRe = /(_0x[0-9a-f]+)\s*=\s*\{/g;
    let b;
    while ((b = blkRe.exec(src)) !== null) blocks.push(b.index);
    const byBlock = new Map();
    const re = /(_0x[0-9a-f]+)\s*:\s*(?:'([^']*)'|(0x[0-9a-f]+))/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      let best = -1;
      for (const s of blocks) { if (s < m.index) best = s; else break; }
      if (best < 0) continue;
      if (!byBlock.has(best)) byBlock.set(best, new Map());
      byBlock.get(best).set(m[1], m[2] !== undefined ? m[2] : m[3]);
    }
    for (const [start, map] of byBlock) scopes.push({ start, map });
    scopes.sort((a, b) => a.start - b.start);
  }
  const keyFor = (prop, pos) => {
    let best = null;
    for (const s of scopes) { if (s.start < pos) best = s; else break; }
    return best ? best.map.get(prop) : undefined;
  };

  const callRe = /(_0x[0-9a-f]+)\(\s*(?:0x([0-9a-f]+)|_0x[0-9a-f]+\.(_0x[0-9a-f]+))\s*,\s*(?:'([^']*)'|_0x[0-9a-f]+\.(_0x[0-9a-f]+))\s*\)/g;
  const found = new Set();
  let m;
  while ((m = callRe.exec(src)) !== null) {
    const key = m[4] !== undefined ? m[4] : keyFor(m[5], m.index);
    if (key === undefined) continue;
    const index = m[2] !== undefined
      ? parseInt(m[2], 16)
      : parseInt(keyFor(m[3], m.index) || "", 16);
    if (!Number.isFinite(index)) continue;
    try {
      const v = decode(index, key);
      if (typeof v === "string" && v.length > 0) found.add(v);
    } catch (e) { /* 忽略单条 */ }
  }
  return { strings: [...found].sort(), note: "" };
}

const files = walk(ROOT);
const lines = [];
const summary = [];

for (const f of files) {
  const rel = path.relative(ROOT, f);
  const { strings, note } = decodeFile(f);
  if (strings.length === 0 && !note) continue;
  summary.push(`${rel}: ${strings.length}${note ? " (" + note + ")" : ""}`);
  if (strings.length === 0) continue;

  lines.push("=".repeat(70));
  lines.push(`## ${rel}`);
  lines.push("=".repeat(70));
  for (const s of strings) {
    // 控制字符转义，保证输出可读可检索
    lines.push("  " + s.replace(/[\r\n\t]/g, (c) => ({ "\r": "\\r", "\n": "\\n", "\t": "\\t" }[c])));
  }
  lines.push("");
}

const header = [
  `# 官方客户端全量字符串还原（只读静态分析）`,
  `# 源目录: ${ROOT}`,
  `# 文件数: ${files.length}，有字符串表: ${summary.length}`,
  "",
  "## 文件清单",
  ...summary,
  "",
].join("\n");

const text = header + lines.join("\n");

if (OUT) {
  fs.writeFileSync(OUT, text, "utf8");
  console.log(`已写出: ${OUT}`);
  console.log(`字符数: ${text.length}`);
} else {
  process.stdout.write(text);
}
