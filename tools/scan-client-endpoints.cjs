/**
 * 只读静态分析：清点官方客户端里真实存在的 LuCI / 插件接口。
 *
 * player.js 之外，其它文件（deviceBaseRequest.js、userMgn.js 等）同样是字符串数组
 * 混淆。这里复用 dump-player-endpoints.cjs 的还原逻辑，逐文件执行扫描，把所有能
 * 解出来的接口路径汇总成一张表——用来判断"某个功能官方到底有没有 API"。
 *
 * 用法：node tools/scan-client-endpoints.cjs [客户端 electron 目录]
 * 全程只读：require 全部桩掉，不触网、不写文件、不修改源文件。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = process.argv[2] || path.join(
  "K:", "DATA", "AI", "ZCode", "xiaomi智能存储",
  "analysis", "extracted", "app-asar", "public", "electron"
);

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

/** 按大括号配平截取完整函数体 */
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

/** 还原单个文件里能解出的全部字符串 */
function decodeFile(file) {
  const src = fs.readFileSync(file, "utf8");

  // 未混淆的文件直接跳过
  if (!/_0x[0-9a-f]{4,}\s*\(/.test(src)) return [];

  const am = src.match(/const\s+(_0x[0-9a-f]+)\s*=\s*(_0x[0-9a-f]+)\s*;/);
  if (!am) return [];
  const decName = am[2];

  const arrMatch = src.match(/function\s+(_0x[0-9a-f]+)\s*\(\s*\)\s*\{\s*const\s+(_0x[0-9a-f]+)\s*=\s*\[/);
  const decStart = src.search(new RegExp(String.raw`function\s+${decName}\s*\(`));
  if (!arrMatch || decStart < 0) return [];

  const tableFnSrc = sliceFunction(src, arrMatch.index);
  const decSrc = sliceFunction(src, decStart);
  if (!tableFnSrc || !decSrc) return [];

  // 在沙箱里求值：整个文件包进 try/catch，保留表旋转 IIFE
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
    __dirname: path.dirname(file),
    __filename: file,
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;

  try {
    vm.runInNewContext(
      `(function(){try{\n${src}\n}catch(e){}try{module.exports.__d=${decName};}catch(e){}})();`,
      vm.createContext(sandbox), { timeout: 30000 }
    );
  } catch (e) {
    return [];
  }
  const decode = sandbox.module.exports.__d;
  if (typeof decode !== "function") return [];

  // 属性名 -> 值，按对象字面量就近解析。
  // 注意值有字符串（密钥）和十六进制数字（索引）两种形态，两种都要收，
  // 否则 decode(_0xV._0xI, _0xV._0xK) 这种调用会因索引缺失而漏解。
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
  const keyForProp = (prop, pos) => {
    let best = null;
    for (const s of scopes) { if (s.start < pos) best = s; else break; }
    return best ? best.map.get(prop) : undefined;
  };

  // 调用点有两种形态：
  //   decode(0x1a5, 'peJK')                  —— 索引与密钥都是字面量
  //   decode(_0xV._0xI, _0xV._0xK)           —— 索引与密钥都走对象属性
  // 两种都要覆盖，否则 transcode_create_task 这类会整片漏掉。
  const callRe =
    /(_0x[0-9a-f]+)\(\s*(?:0x([0-9a-f]+)|_0x[0-9a-f]+\.(_0x[0-9a-f]+))\s*,\s*(?:'([^']*)'|_0x[0-9a-f]+\.(_0x[0-9a-f]+))\s*\)/g;
  const found = new Set();
  let m;
  while ((m = callRe.exec(src)) !== null) {
    const idxHex = m[2];
    const idxProp = m[3];
    const key = m[4] !== undefined ? m[4] : keyForProp(m[5], m.index);
    if (key === undefined) continue;

    let index;
    if (idxHex !== undefined) index = parseInt(idxHex, 16);
    else index = parseInt(keyForProp(idxProp, m.index) || "", 16);
    if (!Number.isFinite(index)) continue;

    try {
      const v = decode(index, key);
      if (typeof v === "string" && v.length > 1) found.add(v);
    } catch (e) { /* 忽略单条失败 */ }
  }
  return [...found];
}

const files = walk(ROOT);
const interesting = /(\/cgi-bin\/luci\/|\/player\/|\/usermanager\/|\/filemgr\/|\/home\/|\/plugincenter\/|\/plugin\/)/;
const byFile = new Map();
const allEndpoints = new Set();

for (const f of files) {
  const strs = decodeFile(f);
  if (strs.length === 0) continue;
  const hits = strs.filter((s) => interesting.test(s));
  if (hits.length === 0) continue;
  byFile.set(path.relative(ROOT, f), hits.sort());
  hits.forEach((h) => allEndpoints.add(h));
}

console.log("=== 按文件 ===");
for (const [f, hits] of [...byFile].sort()) {
  console.log(`\n${f}`);
  hits.forEach((h) => console.log("    " + h));
}

console.log("\n=== 汇总：全部接口路径 ===");
[...allEndpoints].sort().forEach((e) => console.log("  " + e));

console.log(`\n扫描文件 ${files.length} 个，命中 ${byFile.size} 个，接口路径 ${allEndpoints.size} 条`);
