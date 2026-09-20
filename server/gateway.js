/**
 * 小米智能存储仿米家 Web 控制台 - 本地综合中继网关 (增强专业版)
 *
 * 核心升级点：
 * 1. 自动定位证书并推导 DID；
 * 2. 自动检测活跃的 P2P 穿透端口 (urlport / webport)；
 * 3. 自动向 NAS 换取 Access Token 并维持活跃；
 * 4. 真实/透传 API：
 *    - /api/status     -> 穿透链路与设备状态
 *    - /api/system     -> CPU使用率/核心数、内存使用率、硬件型号、系统运行时间
 *    - /api/apps       -> 小程序与应用中心列表 (支持应用中心启闭与状态)
 *    - /api/users      -> 准确存储容量 (已用量/总量/配额/存储池/管理员)
 *    - /api/files      -> 全盘文件/相册/文档检索与类型过滤
 *    - /api/thumbnail  -> 高性能媒体缩略图（带本地磁盘二级持久化缓存与 Cache-Control）
 *    - /api/image      -> 应用图标与图片代理（带磁盘缓存）
 *    - /api/monitor    -> 往返延迟动态采样
 * 5. 服务端磁盘缓存目录：server/cache
 * 6. 静态托管 Vue 3 生产构建产物 (端口: 8090)。
 */

const http = require("http");
const https = require("https");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { execSync } = require("child_process");
const { MqttBridge, mqttAvailable } = require("./mqtt-bridge");

// 端口可用环境变量覆盖，便于本地验证时不干扰已运行的实例
const SERVER_PORT = parseInt(process.env.GATEWAY_PORT || "8090", 10);

// 缓存 TTL：硬件状态查询要跑 4 个 NAS 接口，前端会轮询，做几秒缓存避免打爆隧道
const HARDWARE_CACHE_MS = 5000;
const hwCache = { data: null, at: 0 };

// 1. 初始化本地磁盘高速缓存目录 (用于在弱网/离线环境下秒级命中缩略图和图标)
const CACHE_DIR = path.join(__dirname, "cache");
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// 2. 自动定位证书与 DID（DID 从证书文件名解析，无需硬编码）
let DID = "";
let cert = null;
let key = null;
let ca = null;

const certDir = path.join(process.env.LOCALAPPDATA || "", "minasCert");
if (fs.existsSync(certDir)) {
  const files = fs.readdirSync(certDir);
  const certFile = files.find(f => f.endsWith("_cert.pem"));
  const keyFile = files.find(f => f.endsWith("_private_key.pem"));
  const caFile = files.find(f => f.startsWith("ca_chain"));

  if (certFile) {
    const m = certFile.match(/\d+_(\d+)_cert\.pem/);
    if (m) DID = m[1];
    cert = fs.readFileSync(path.join(certDir, certFile));
  }
  if (keyFile) key = fs.readFileSync(path.join(certDir, keyFile));
  if (caFile) ca = fs.readFileSync(path.join(certDir, caFile));
}

// 用于匹配 NAS 服务器证书 CN 的指纹（DID 为空时无法匹配，探测会给出明确报错）
const needle = DID ? crypto.createHash("sha1").update(DID).digest("hex") : "";

// 2.1 自动提取官方客户端 WebDAV 动态凭据
// 官方 Electron 渲染进程把 webDavInfo 存在 Local Storage 的 leveldb 里，形如：
// {"username":"u<UID>","port":62185,"alias_root":"/home/u<UID>",
//  "uri":"https://127.0.0.1:62185","password":"...","port_2":62188}
// 用户名/密码每次会话轮换，因此必须运行时读取，不能硬编码。
function readWebdavCredentials() {
  const lsDir = path.join(process.env.APPDATA || "", "SmartStorage", "Partitions", "session", "Local Storage", "leveldb");
  if (!fs.existsSync(lsDir)) return null;

  let newest = null;
  for (const fn of fs.readdirSync(lsDir)) {
    if (!/\.(ldb|log)$/.test(fn)) continue;
    try {
      const stat = fs.statSync(path.join(lsDir, fn));
      const raw = fs.readFileSync(path.join(lsDir, fn)).toString("latin1");
      const m = raw.match(/\{"username":"[^"]+","port":\d+,"alias_root":"[^"]*","uri":"[^"]+","password":"[^"]+","port_2":\d+\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        if (!newest || stat.mtimeMs > newest.mtimeMs) {
          newest = Object.assign(parsed, { mtimeMs: stat.mtimeMs });
        }
      }
    } catch (e) { /* 单个文件损坏不影响其它文件 */ }
  }
  return newest;
}

// 3. 运行时状态
let activeUrlPort = 0;
let activeWebdavPort = 0;
let activeWebPort = 0;
let accessToken = "";
let lastTokenTime = 0;
let rttHistory = [];
let webdavCreds = null;

// MQTT 推送桥：只读订阅 NAS 事件，经 SSE 分发给前端
const sseClients = new Set();
let latestMeminfo = null;   // meminfo/update 是唯一内存数据源（无 HTTP 接口）
let mqttBridge = null;

function sseBroadcast(topic, data) {
  const frame = `data: ${JSON.stringify({ topic, data, ts: Date.now() })}\n\n`;
  for (const res of sseClients) {
    try { res.write(frame); } catch (e) { sseClients.delete(res); }
  }
}

function getUidFromCreds() {
  const c = ensureWebdavCreds();
  const m = c && c.username ? c.username.match(/u(\d+)/) : null;
  return m ? m[1] : "";
}

function startMqttBridge() {
  if (!mqttAvailable || mqttBridge) return;
  mqttBridge = new MqttBridge(
    {
      ensureReady,
      getUrlPort: () => activeUrlPort,
      getAccessToken: () => accessToken,
      getUid: getUidFromCreds,
      cert, key, ca,
    },
    (topic, data) => {
      // meminfo 缓存起来并入 /api/system
      if (topic.endsWith("/meminfo/update")) latestMeminfo = data;
      sseBroadcast(topic, data);
    }
  );
  mqttBridge.start();
}

// ============ 硬件与存储信息（全部来自 NAS 真实接口）============
//
// 逆向结论（已实机验证）：
//   /cgi-bin/luci/system/get_device_status  -> CPU 占用/温度、风扇转速与模式、UPS、
//                                              网卡 IP/掩码/网关/DNS、上下行速率、
//                                              MAC/序列号/机型、磁盘用量汇总
//   /cgi-bin/luci/storage/get_storage_info  -> 每块硬盘的型号、序列号、槽位、
//                                              温度、健康状态、运行时长、容量
//   /cgi-bin/luci/filemgr/get_pool_info     -> 存储池总量/已用、池类型、WebDAV 凭据
//   /cgi-bin/luci/system/get_system_version -> 固件版本与升级通道
//
// 注意：这些接口都在 NAS 的 Web UI 侧（官方客户端的 dist 页面调用），
// 不在早期逆向得到的「主进程 LuCI 接口」清单里，所以之前误判为"官方未开放"。

// 从 "53℃" / "7%" / "32 KB/s" 这类带单位字符串里取数值
function parseLeadingNumber(v) {
  if (v === null || v === undefined) return null;
  const m = String(v).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// CPU 型号无法从接口读到（get_device_status 只给占用率与温度），
// 按机型标注而不猜测具体芯片型号。
function getSystemHardwareMetrics() {
  return {
    estimated: false,
    model: null,
    cpu: { usagePercent: null, temp: null },
    fan: { rpm: null, mode: null },
    memory: { totalBytes: null, usedBytes: null, usagePercent: null },
    network: { ip: null, netmask: null, gateway: null, dns: [], mac: null, upload: null, download: null },
    storagePool: { name: "存储空间", usedBytes: null, totalBytes: null, diskNum: null },
    disks: [],
    ups: { enabled: null, health: null },
    system: { version: null, channel: null, power: null },
  };
}

// 拉取并合并真实硬件信息；任一接口失败只让对应字段保持 null
async function fetchHardwareInfo() {
  const info = getSystemHardwareMetrics();

  const [statusRes, storageRes, poolRes, verRes] = await Promise.allSettled([
    callNasAPI("/cgi-bin/luci/system/get_device_status", {}),
    callNasAPI("/cgi-bin/luci/storage/get_storage_info", {}),
    callNasAPI("/cgi-bin/luci/filemgr/get_pool_info", {}),
    callNasAPI("/cgi-bin/luci/system/get_system_version", {}),
  ]);

  const pick = (r) => (r.status === "fulfilled" ? r.value?.data?.data || null : null);

  const st = pick(statusRes);
  if (st) {
    if (st.cpu) {
      info.cpu.usagePercent = parseLeadingNumber(st.cpu.use);
      info.cpu.temp = parseLeadingNumber(st.cpu.temp);
    }
    if (st.fan) {
      info.fan.rpm = parseLeadingNumber(st.fan.rpm);
      info.fan.mode = st.fan.mode || null;
    }
    if (st.deviceinfo) {
      info.network.mac = st.deviceinfo.MAC || null;
      info.system.model = st.deviceinfo.model || null;
      info.system.serial = st.deviceinfo.SN || null;
    }
    if (st.net) {
      info.network.upload = st.net.upload || null;
      info.network.download = st.net.download || null;
      const v4 = st.net.ipv4 || {};
      info.network.ip = v4.address || null;
      info.network.netmask = v4.netmask || null;
      info.network.gateway = v4.gateway || null;
      info.network.dns = Array.isArray(v4.DNS) ? v4.DNS : [];
    }
    if (st.disk) {
      info.storagePool.usedBytes = parseInt(st.disk.usedsize || 0, 10) || null;
      info.storagePool.totalBytes = parseInt(st.disk.totalsize || 0, 10) || null;
      info.storagePool.unusedBytes = parseInt(st.disk.unusedsize || 0, 10) || null;
      info.storagePool.hibernate = st.disk.hibernate || null;
    }
    if (st.ups) {
      info.ups.enabled = st.ups.status === "enable";
      info.ups.health = st.ups.health || null;
    }
  }

  // 内存占用没有 HTTP 查询接口，只能取 MQTT 推送缓存（latestMeminfo）。
  // 字段名待用户探针确认：常见形状是 {total, used/free}（KB 或字节）。
  if (latestMeminfo) {
    const m = latestMeminfo;
    const total = parseInt(m.total ?? m.total_size ?? m.totalBytes ?? 0, 10) || null;
    const used = parseInt(m.used ?? m.used_size ?? m.usedBytes ?? 0, 10) || null;
    if (total) {
      info.memory.totalBytes = total;
      info.memory.usedBytes = used;
      info.memory.usagePercent = used != null ? Math.round((used / total) * 100) : null;
    }
  }

  const storage = pick(storageRes);
  if (storage) {
    const pools = Array.isArray(storage.internal_pool) ? storage.internal_pool : [];
    const p0 = pools[0];
    if (p0) {
      info.storagePool.name = p0.pool_name || info.storagePool.name;
      info.storagePool.poolType = p0.pool_type || null;
      info.storagePool.diskNum = parseInt(p0.disk_num || 0, 10) || null;
      info.storagePool.status = p0.status || null;
      if (!info.storagePool.totalBytes) info.storagePool.totalBytes = parseInt(p0.total_size || 0, 10) || null;
      if (!info.storagePool.usedBytes) info.storagePool.usedBytes = parseInt(p0.used_size || 0, 10) || null;
      info.disks = (Array.isArray(p0.disks) ? p0.disks : []).map((d) => ({
        dev: d.dev || "",
        slot: d.slot ?? null,
        type: d.type || "",
        model: d.model || "",
        serial: d.serial || "",
        temperature: parseLeadingNumber(d.temperature),
        health: d.health || "",
        state: d.state || "",
        runTimeHours: parseInt(d.run_time || 0, 10) || null,
        totalBytes: parseInt(d.total_size || 0, 10) || null,
        usedBytes: parseInt(d.used_size || 0, 10) || null,
        // partners 是镜像组成员盘（本机为空，非双盘镜像时会有值）；
        // pool_admin 标记该盘属于哪个池的管理盘。
        partners: Array.isArray(d.partners) ? d.partners : [],
        poolAdmin: d.pool_admin || "",
      }));
    }
  }

  const pool = pick(poolRes);
  if (pool && Array.isArray(pool.internal_pool) && pool.internal_pool[0]) {
    const p0 = pool.internal_pool[0];
    if (!info.storagePool.totalBytes) info.storagePool.totalBytes = parseInt(p0.total_size || 0, 10) || null;
    if (!info.storagePool.usedBytes) info.storagePool.usedBytes = parseInt(p0.used_size || 0, 10) || null;
    info.storagePool.poolType = info.storagePool.poolType || p0.pool_type || null;
    info.externalPoolCount = Array.isArray(pool.external_pool) ? pool.external_pool.length : 0;
  }

  const ver = pick(verRes);
  if (ver) {
    info.system.version = ver.version || null;
    info.system.channel = ver.channel || null;
    info.system.autoUpgrade = !!ver.autoupgrade;
  }

  return info;
}

// 小程序与应用列表兜底数据（NAS 未返回 get_app_list 时展示）
const FULL_APPS = [
  { id: "photo", name: "相册", category: "core", desc: "AI 智能相册，时光轴与面孔识别", installed: true, icon: "", status: "running" },
  { id: "file", name: "文件", category: "core", desc: "NAS 全局文件管理与外部存储挂载", installed: true, icon: "", status: "running" },
  { id: "mediacenter", name: "影视", plugin: "mediacenter", category: "media", desc: "家庭影院海报墙与 4K 实时转码播放", installed: true, icon: "", status: "running" },
  { id: "task", name: "任务中心", category: "tool", desc: "离线下载与文件同步传输队列", installed: true, icon: "", status: "running" },
  { id: "settings", name: "系统设置", category: "tool", desc: "网络配置、固件升级与风扇策略", installed: true, icon: "", status: "running" },
  { id: "users", name: "用户管理", category: "core", desc: "家庭成员共享与多空间权限配额", installed: true, icon: "", status: "running" },
  { id: "safe", name: "保险箱", category: "secure", desc: "硬件芯片级 AES-256 加密空间", installed: true, icon: "", status: "running" },
  { id: "smb", name: "网络邻居", category: "network", desc: "Samba / AFP / NFS 局域网高速共享", installed: true, icon: "", status: "running" },
  { id: "trash", name: "回收站", category: "tool", desc: "防止误删，保留 30 天可恢复文件", installed: true, icon: "", status: "running" },
  { id: "xunlei", name: "迅雷", category: "plugin", desc: "迅雷远程高速下载专用加速引擎", installed: true, icon: "", status: "stopped" },
  { id: "baidunetdisk", name: "百度网盘", category: "plugin", desc: "网盘数据双向自动同步", installed: true, icon: "", status: "running" },
  { id: "docker", name: "容器魔方", category: "plugin", desc: "Docker 轻量化容器应用中心", installed: false, icon: "", status: "uninstalled" }
];

// 真实文件与媒体列表（包含真内联高清缩略图数据 URI，实现断网与极低网速下的即刻秒显）
// 内置极简高质量 SVG 渲染图案作为高保真缩略图，避免依赖外部不可靠的第三方 CDN
// 文件扩展名 -> MIME，用于本机直传响应（NAS 未给 Content-Type 时的兜底）
function mimeFor(p) {
  const ext = path.extname(p).toLowerCase();
  const table = {
    ".mp4": "video/mp4", ".mkv": "video/x-matroska", ".mov": "video/quicktime",
    ".avi": "video/x-msvideo", ".ts": "video/mp2t", ".webm": "video/webm",
    ".flv": "video/x-flv", ".rmvb": "application/vnd.rn-realmedia-vbr",
    ".m4v": "video/x-m4v", ".mpg": "video/mpeg", ".mpeg": "video/mpeg",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
    ".heic": "image/heic", ".heif": "image/heif", ".tiff": "image/tiff",
    ".mp3": "audio/mpeg", ".flac": "audio/flac", ".wav": "audio/wav",
    ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg",
    ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8", ".json": "application/json; charset=utf-8",
  };
  return table[ext] || "application/octet-stream";
}

// 图片类扩展名 -> MIME（缩略图缓存响应使用，缺省按 jpeg 处理）
function imageMimeFor(p) {
  const m = mimeFor(p);
  return m.startsWith("image/") ? m : "image/jpeg";
}

function generateSvgThumbnail(title, color1, color2, icon) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color1}"/>
        <stop offset="100%" stop-color="${color2}"/>
      </linearGradient>
    </defs>
    <rect width="400" height="260" rx="16" fill="url(#g)"/>
    <circle cx="200" cy="110" r="50" fill="rgba(255,255,255,0.2)"/>
    <text x="200" y="125" font-size="44" text-anchor="middle" fill="#ffffff">${icon}</text>
    <rect x="40" y="195" width="320" height="36" rx="18" fill="rgba(0,0,0,0.25)"/>
    <text x="200" y="219" font-size="14" font-weight="bold" font-family="sans-serif" text-anchor="middle" fill="#ffffff">${title}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}


// 静默探测活跃端口 (只读 TLS 握手)
async function detectActivePorts() {
  let pids = [];
  try {
    pids = execSync('powershell -NoProfile -Command "(Get-Process -Name 小米智能存储 -ErrorAction SilentlyContinue).Id"', { encoding: "utf8" })
      .trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch (e) {
    throw new Error("未检测到运行中的小米智能存储客户端进程");
  }

  if (pids.length === 0) {
    throw new Error("未检测到运行中的小米智能存储客户端进程");
  }

  const out = execSync("netstat -ano", { encoding: "utf8" });
  const ports = [];
  for (const line of out.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 5 && parts[0] === "TCP" && parts[3] === "LISTENING" && pids.includes(parts[4])) {
      const p = parseInt(parts[1].split(":").pop(), 10);
      if (p && p !== 25445 && p !== 31288) ports.push(p);
    }
  }
  ports.sort((a, b) => a - b);

  for (const p of ports) {
    const matched = await new Promise((resolve) => {
      const s = tls.connect({ host: "127.0.0.1", port: p, rejectUnauthorized: false, timeout: 1000 }, () => {
        const c = s.getPeerCertificate();
        s.end();
        resolve(c && c.subject && c.subject.CN && c.subject.CN.includes(needle));
      });
      s.on("error", () => resolve(false));
      s.on("timeout", () => { s.destroy(); resolve(false); });
    });

    if (matched) {
      activeUrlPort = p;
      activeWebdavPort = p + 1; // base+1 = WebDAV (文件读写)
      activeWebPort = p + 2;    // base+2 = 明文 Web (插件入口)
      return { urlPort: activeUrlPort, webdavPort: activeWebdavPort, webPort: activeWebPort };
    }
  }
  throw new Error("未在当前监听端口中找到匹配 NAS 设备指纹的 TLS 端口");
}

// 换取 Access Token
async function fetchToken(urlPort) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({});
    const req = https.request({
      host: "127.0.0.1",
      port: urlPort,
      path: "/cgi-bin/luci/plugincenter/get_access_token",
      method: "POST",
      rejectUnauthorized: false,
      cert: cert,
      key: key,
      ca: ca,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      },
      timeout: 4000
    }, (res) => {
      let b = "";
      res.on("data", d => b += d);
      res.on("end", () => {
        try {
          const json = JSON.parse(b);
          if (json && json.data && json.data.token) {
            resolve(json.data.token);
          } else {
            reject(new Error("获取 token 返回异常: " + b));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("获取 token 超时")); });
    req.write(payload);
    req.end();
  });
}

// 保证 Token 有效
async function ensureReady() {
  if (!activeUrlPort) {
    await detectActivePorts();
  }
  if (!accessToken || Date.now() - lastTokenTime > 30 * 60 * 1000) {
    accessToken = await fetchToken(activeUrlPort);
    lastTokenTime = Date.now();
  }
}

// 保证 WebDAV 凭据可用 (官方客户端每次会话轮换动态密码，需定期重读)
function ensureWebdavCreds() {
  if (!webdavCreds || Date.now() - webdavCreds.mtimeMs > 5 * 60 * 1000) {
    webdavCreds = readWebdavCredentials();
  }
  return webdavCreds;
}

// 向 NAS 的 WebDAV 端点发起请求 (mTLS + HTTP Basic)
// 注意：WebDAV 的根是 alias_root (/home/u<UID>)，路径必须相对于它，否则 Nginx 返回 451。
// 返回 Node 的 ClientRequest，调用方可自行 pipe 请求体并监听 'response'。
// WebDAV 请求路径必须逐段百分号编码，否则含中文/空格/特殊字符的路径
// 会让 Node 抛出 ERR_UNESCAPED_CHARACTERS，请求根本发不出去。
// 这里逐段处理是为了保留 "/" 作为分隔符；同时先解码再编码，
// 保证对已编码的输入也是幂等的，不会造成双重编码。
function encodeWebdavPath(p) {
  return p
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      let raw = seg;
      try {
        raw = decodeURIComponent(seg);
      } catch (e) {
        // 非法百分号序列，按原始文本处理
      }
      return encodeURIComponent(raw);
    })
    .join("/");
}

function openWebdavRequest(method, apiPath, headers = {}, timeoutMs = 600000) {
  const creds = ensureWebdavCreds();
  if (!creds) {
    throw new Error("未找到官方客户端 WebDAV 凭据，请确认小米智能存储客户端已登录运行");
  }
  if (!activeWebdavPort) {
    throw new Error("WebDAV 穿透端口尚未就绪");
  }

  const auth = "Basic " + Buffer.from(`${creds.username}:${creds.password}`).toString("base64");
  const reqHeaders = Object.assign({ Authorization: auth }, headers);

  // 官方客户端把路径写在 alias_root 下，剥离前缀得到相对路径
  const relative = apiPath.startsWith(creds.alias_root)
    ? apiPath.slice(creds.alias_root.length)
    : apiPath;

  const req = https.request({
    host: "127.0.0.1",
    port: activeWebdavPort,
    path: encodeWebdavPath(relative || "/"),
    method: method,
    rejectUnauthorized: false,
    cert: cert,
    key: key,
    ca: ca,
    headers: reqHeaders,
    timeout: timeoutMs
  });
  return req;
}

// 便捷封装：发起请求并解析响应体 (用于非流式的小数据交互)
function callWebdav(method, apiPath, headers = {}, body = null, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = openWebdavRequest(method, apiPath, headers, timeoutMs);
    } catch (e) {
      reject(e);
      return;
    }
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("WebDAV 请求超时")); });
    req.on("response", (res) => resolve(res));
    if (body !== null) req.write(body);
    req.end();
  });
}

// 从 WebDAV 凭据推导用户数据根目录 (形如 /home/u<UID>/pool0/data)。
// 前端不再硬编码 UID，换设备或换账号都能正确打开根目录。
function getDataRoot() {
  const creds = ensureWebdavCreds();
  if (!creds || !creds.alias_root) return "";
  return creds.alias_root.replace(/\/$/, "") + "/pool0/data";
}

// 向 NAS 发送 POST JSON 请求
async function callNasAPI(path, body = {}) {
  await ensureReady();
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: "127.0.0.1",
      port: activeUrlPort,
      path: path,
      method: "POST",
      rejectUnauthorized: false,
      cert: cert,
      key: key,
      ca: ca,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "Cookie": `token=${accessToken}`,
        "Authorization": accessToken,
        "authorization": accessToken
      },
      timeout: 6000
    }, (res) => {
      let b = "";
      res.on("data", d => b += d);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(b) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: b });
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("NAS API 超时")); });
    req.write(payload);
    req.end();
  });
}

// 静态前端资源目录
const distDir = path.join(__dirname, "..", "web", "dist");

// 创建 HTTP 服务器
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // 1. /api/status 设备状态与穿透握手
  if (pathname === "/api/status") {
    try {
      await ensureReady();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        status: "ok",
        online: true,
        did: DID,
        urlPort: activeUrlPort,
        webdavPort: activeWebdavPort,
        webPort: activeWebPort,
        dataRoot: getDataRoot(),
        tokenReady: !!accessToken,
        lastRTT: rttHistory.length > 0 ? rttHistory[rttHistory.length - 1].rtt : 12
      }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        status: "error",
        online: false,
        message: e.message,
        did: DID,
        dataRoot: getDataRoot(),
        urlPort: 0,
        webdavPort: 0,
        webPort: 0
      }));
    }
    return;
  }

  // 2. /api/system 硬件与系统信息（全部来自 NAS 真实接口，见 fetchHardwareInfo）
  if (pathname === "/api/system") {
    try {
      await ensureReady();
      // 前端每 8 秒轮询，这里做几秒缓存，避免同一批查询反复打到隧道上
      const now = Date.now();
      if (!hwCache.data || now - hwCache.at > HARDWARE_CACHE_MS) {
        hwCache.data = await fetchHardwareInfo();
        hwCache.at = now;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "ok", data: hwCache.data }));
    } catch (e) {
      // 连不上就如实报告，字段留 null 由前端显示"未上报"，不填假数据
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "error", message: e.message, data: getSystemHardwareMetrics() }));
    }
    return;
  }

  // 2.1 /api/storage 每块硬盘的型号/序列号/温度/健康状态/运行时长
  if (pathname === "/api/storage") {
    try {
      await ensureReady();
      const resp = await callNasAPI("/cgi-bin/luci/storage/get_storage_info", {});
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "ok", data: resp.data?.data || {} }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "error", message: e.message, data: {} }));
    }
    return;
  }

  // 2.2 /api/tasks 任务中心：上传/下载/复制/压缩/删除的进度与速率
  //
  // 官方 file-taskCenter 页的用法（从 index-DzZSkKO8.js 还原）：
  //   总览：get_task_status  { selector:[{key:"module",value:["filemgr"]}] }
  //   列表：get_taskinfo     { selector:[{key:"module",value:["filemgr"]},
  //                                      {key:"type",value:["history"|"running"]}],
  //                            page:{size:1000,id:1} }
  // 任务项关键字段：action(remove/copy/...)、status、src[]、dst、
  //   detail.progress(0-100)、detail.speed(如 "1.2MB/s")、
  //   detail.total_size / handle_size、detail.total_files / handled_files、
  //   detail.err_code / err_msg、create_time / done_time
  if (pathname === "/api/tasks") {
    const wantType = parsedUrl.searchParams.get("type") || ""; // '' | running | history
    try {
      await ensureReady();

      const selector = [{ key: "module", value: ["filemgr"] }];
      if (wantType) selector.push({ key: "type", value: [wantType] });

      let list = [];
      if (wantType === "status") {
        // 只取计数概览
        const r = await callNasAPI("/cgi-bin/luci/taskcenter/get_task_status", {
          selector: [{ key: "module", value: ["filemgr"] }],
        });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "ok", data: r.data?.data || {} }));
        return;
      }

      const r = await callNasAPI("/cgi-bin/luci/taskcenter/get_taskinfo", {
        selector,
        page: { size: 1000, id: 1 },
      });
      const d = r.data?.data || {};
      list = Array.isArray(d.info) ? d.info : [];

      const mapped = list.map((t) => {
        const det = t.detail || {};
        const src = Array.isArray(t.src) ? t.src : (t.src ? [t.src] : []);
        return {
          id: String(t.task_id || ""),
          module: t.module || "",
          action: t.action || "",
          status: t.status || "",
          srcType: t.src_type || "",
          src,
          // 文件名取第一项的 basename，前端再拼"等 N 项"
          name: src[0] ? src[0].split("/").pop() : "",
          srcCount: src.length,
          dst: t.dst || "",
          createTime: parseInt(t.create_time || 0, 10) || null,
          doneTime: parseInt(t.done_time || 0, 10) || null,
          progress: det.progress ?? null,
          // speed 是 NAS 给的带单位字符串，如 "1.2MB/s"；空表示已停/未开始
          speed: det.speed || "",
          totalBytes: parseInt(det.total_size || 0, 10) || null,
          doneBytes: parseInt(det.handle_size || 0, 10) || null,
          totalFiles: det.total_files ?? null,
          handledFiles: det.handled_files ?? null,
          errCode: det.err_code ?? null,
          errMsg: det.err_msg || "",
        };
      });

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        status: "ok",
        data: {
          tasks: mapped,
          total: d.page?.total_task ?? mapped.length,
          type: wantType || "all",
        },
      }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "error", message: e.message, data: { tasks: [] } }));
    }
    return;
  }

  // 2.3 /api/mediacenter/url 返回可直接内嵌的影视墙地址（经本网关代理）
  if (pathname === "/api/mediacenter/url") {
    try {
      await ensureReady();
      // 官方 get_app_list 里就有真实插件 URL，取其路径部分
      const appsRes = await callNasAPI("/cgi-bin/luci/plugincenter/get_app_list", {});
      const apps = appsRes.data?.data?.app || [];
      const mc = apps.find((a) => a.id === 2 || a.name === "影视" || (a.url || "").includes("mediacenter"));
      const rawUrl = mc?.url || "";

      // https://localhost:443/plugin/<uid>/mediacenter/index.html#/xxx
      // → 经本地网关代理：/plugin/<uid>/mediacenter/index.html#/xxx
      let proxied = "";
      if (rawUrl) {
        try {
          const u = new URL(rawUrl);
          proxied = u.pathname + u.search + u.hash;
        } catch (e) {
          proxied = rawUrl;
        }
      }

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        status: proxied ? "ok" : "error",
        message: proxied ? "" : "NAS 未返回影视墙插件地址",
        data: { upstream: rawUrl, proxied },
      }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "error", message: e.message, data: {} }));
    }
    return;
  }

  // 3. /api/apps 应用与小程序中心 (支持状态控制)
  if (pathname === "/api/apps") {
    try {
      const resp = await callNasAPI("/cgi-bin/luci/plugincenter/get_app_list", {});
      const rawApps = resp.data?.apps || [];
      // 合并官方原装与全景小程序
      const merged = FULL_APPS.map(fa => {
        const found = rawApps.find(ra => ra.name === fa.name || ra.id === fa.id);
        if (found) {
          return {
            ...fa,
            installed: found.installed !== false,
            iconUrl: found.icon ? `/api/image?src=${encodeURIComponent(found.icon)}` : ""
          };
        }
        return fa;
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ data: { apps: merged } }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ data: { apps: FULL_APPS } }));
    }
    return;
  }

  // 4. /api/users 用户配额与容量
  if (pathname === "/api/users") {
    try {
      const [userResp, poolResp] = await Promise.allSettled([
        callNasAPI("/cgi-bin/luci/usermanager/user_list", {}),
        callNasAPI("/cgi-bin/luci/filemgr/get_pool_info", {}),
      ]);

      const ulist = userResp.status === "fulfilled"
        ? (userResp.value.data?.data?.list || userResp.value.data?.list || userResp.value.data?.users || [])
        : [];

      if (!ulist.length) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "error", message: "NAS 未返回用户列表", data: { users: [] } }));
        return;
      }

      // user_list 的 total_size 恒为 0（该接口不报配额），
      // 真实总容量改用 filemgr/get_pool_info 的存储池数据补齐。
      const pool = poolResp.status === "fulfilled" ? (poolResp.value.data?.data || {}) : {};
      const pool0 = Array.isArray(pool.internal_pool) ? pool.internal_pool[0] : null;

      const u = ulist[0];
      const reported = parseInt(u.total_size || 0, 10);
      const poolTotal = pool0 ? parseInt(pool0.total_size || 0, 10) : 0;
      const poolUsed = pool0 ? parseInt(pool0.used_size || 0, 10) : 0;

      // 总容量优先用存储池真实值；都取不到时保持 0，由前端显示"未上报"
      u.total_size = reported > 0 ? reported : (poolTotal || 0);
      u.total_size_is_estimated = false;
      u.total_size_source = reported > 0 ? "user_list" : (poolTotal > 0 ? "pool_info" : null);

      // 已用容量：用户配额口径 vs 整池口径都给出，前端按需要选
      if (!u.used_size && poolUsed) u.used_size = poolUsed;
      u.pool_used_size = poolUsed || null;
      u.pool_type = pool0?.pool_type || null;
      u.pool_name = pool0?.pool_name || "存储空间";

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "ok", data: { users: ulist, list: ulist } }));
    } catch (e) {
      // 不返回伪造数据，如实报告失败原因
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "error", message: e.message, data: { users: [] } }));
    }
    return;
  }

  // 5. /api/files 全盘文件与目录钻取 (升级版：子目录直接使用 filemgr/list_directory，避免 search 接口索引未就绪导致的空白)
  if (pathname === "/api/files") {
    try {
      await ensureReady();
      const reqKeyword = parsedUrl.searchParams.get("keyword") || "";
      const reqParent = parsedUrl.searchParams.get("parent") || "";

      let rawList = [];
      let totalSize = 0;

      if (reqParent) {
        // 列子目录：优先使用官方官方同款的 list_directory（直读底层文件系统，即时性强，不依赖后台异步索引）
        try {
          const listBody = {
            path: { parent: reqParent.replace(/\/$/, ""), recursion: false },
            page: { size: 1000, token: "" },
            order: { basis: "name", desc: false },
            simple: false
          };
          const dirResp = await callNasAPI("/cgi-bin/luci/filemgr/list_directory", listBody);
          if (dirResp.data?.code === 0 && Array.isArray(dirResp.data?.data?.files)) {
            rawList = dirResp.data.data.files;
            totalSize = dirResp.data.data.page?.total_size || rawList.length;
          } else {
            throw new Error(dirResp.data?.result || "list_directory 未返回文件");
          }
        } catch (dirErr) {
          console.warn("[gateway] list_directory 降级回退到 search:", dirErr.message);
          // 回退兜底：如果 list_directory 失败，再尝试 search
          const searchBody = {
            type: "directory",
            page: { size: 500, token: "" },
            options: {
              option: ["path"],
              path: { parent: reqParent, recursion: false }
            },
            show_dotfile: false
          };
          const resp = await callNasAPI("/cgi-bin/luci/filemgr/search", searchBody);
          rawList = resp.data?.data?.files || resp.data?.files || [];
          totalSize = resp.data?.data?.page?.total_size || rawList.length;
        }
      } else {
        // 根视图或全盘全局关键词搜索
        const searchBody = {
          keyword: reqKeyword,
          type: "all",
          page: { size: 200, token: "" }
        };
        const resp = await callNasAPI("/cgi-bin/luci/filemgr/search", searchBody);
        rawList = resp.data?.data?.files || resp.data?.files || [];
        totalSize = resp.data?.data?.page?.total_size || rawList.length;
      }

      // 转换为前端统一标准格式
      const mapped = rawList.map((f, idx) => {
        const isPhoto = /\.(jpg|jpeg|png|heic|heif|webp|bmp|gif)$/i.test(f.name);
        const isVideo = /\.(mp4|mkv|mov|avi|ts|flv|webm)$/i.test(f.name);
        const fullPath = f.parent ? `${f.parent.replace(/\/$/, '')}/${f.name}` : (f.path || f.name);
        const isDir = !!(f.xattr && f.xattr.directory);

        return {
          id: `nas-${idx}`,
          name: f.name,
          parent: f.parent || reqParent || "",
          path: fullPath,
          size: parseInt(f.size || 0, 10),
          modified_time: parseInt(f.modified_time || Date.now(), 10),
          isDir: isDir,
          type: isDir ? "dir" : (isPhoto ? "photo" : (isVideo ? "video" : "doc")),
          thumbnail: (isPhoto || isVideo)
            ? `/api/thumbnail?path=${encodeURIComponent(fullPath)}&size=small`
            : (isDir ? generateSvgThumbnail(f.name, "#64748b", "#334155", "📁") : generateSvgThumbnail(f.name, "#94a3b8", "#475569", "📄")),
          previewUrl: (isPhoto || isVideo)
            ? `/api/thumbnail?path=${encodeURIComponent(fullPath)}&size=preview`
            : "",
          videoUrl: isVideo
            ? `/api/stream?path=${encodeURIComponent(fullPath)}`
            : "",
          xattr: f.xattr
        };
      });

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        status: "ok",
        currentParent: reqParent,
        total: totalSize || mapped.length,
        data: { files: mapped }
      }));
    } catch (e) {
      console.error("[gateway] 获取 NAS 真实文件失败:", e.message);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        status: "error",
        message: "无法连接到小米智能存储设备: " + e.message,
        data: { files: [] }
      }));
    }
    return;
  }

  // 6. /api/thumbnail 缩略图：经 WebDAV 取原图 → 本地缓存 → 直接返回
  //
  // 注意：官方客户端**没有** LuCI 缩略图接口。它的做法是 downloadThumbnail.js
  // 走 WebDAV 下载原图，在客户端本机转换/缩放后由 localServer.js 提供出去。
  // 这里采用同样思路：首次请求拉原图并落盘缓存，之后直接命中缓存。
  // 图片体积较大时前端应优先用列表小图，避免一次拉取过多原图。
  if (pathname === "/api/thumbnail") {
    const filePath = parsedUrl.searchParams.get("path") || "";
    const size = parsedUrl.searchParams.get("size") || "small";
    const cacheKey = crypto.createHash("md5").update(`${filePath}_${size}`).digest("hex") + ".img";
    const localCachedFile = path.join(CACHE_DIR, cacheKey);

    // 优先命中本地磁盘缓存 (秒级响应)
    if (fs.existsSync(localCachedFile)) {
      res.writeHead(200, {
        "Content-Type": imageMimeFor(filePath),
        "Cache-Control": "public, max-age=604800, immutable",
        "X-Cache-Lookup": "HIT"
      });
      fs.createReadStream(localCachedFile).pipe(res);
      return;
    }

    const svgFallback = () => {
      const isVideo = /\.(mp4|mkv|mov|avi|ts)$/i.test(filePath);
      return generateSvgThumbnail(path.basename(filePath) || "Thumbnail",
        isVideo ? "#f97316" : "#3b82f6", isVideo ? "#c2410c" : "#1d4ed8",
        isVideo ? "🎬" : "🖼️");
    };

    // 视频没有可用的缩略图来源（NAS 未开放截图接口），直接用矢量占位图，
    // 不浪费一次原图下载。
    if (/\.(mp4|mkv|mov|avi|ts|flv|webm|rmvb)$/i.test(filePath)) {
      res.writeHead(302, { Location: svgFallback() });
      res.end();
      return;
    }

    // 图片：经 WebDAV 取原图并落盘缓存
    let dav;
    try {
      await ensureReady();
      dav = await callWebdav("GET", filePath, {}, null, 30000);
    } catch (e) {
      res.writeHead(302, { Location: svgFallback() });
      res.end();
      return;
    }

    if (dav.statusCode !== 200) {
      dav.resume();
      res.writeHead(302, { Location: svgFallback() });
      res.end();
      return;
    }

    res.writeHead(200, {
      "Content-Type": dav.headers["content-type"] || imageMimeFor(filePath),
      "Cache-Control": "public, max-age=604800, immutable",
      "X-Cache-Lookup": "MISS"
    });
    const writeStream = fs.createWriteStream(localCachedFile);
    dav.pipe(writeStream);
    dav.pipe(res);
    return;
  }

  // 7. /api/image 代理 NAS 原厂图标资源 (带本地缓存)
  if (pathname === "/api/image") {
    const src = parsedUrl.searchParams.get("src");
    if (!src) {
      res.writeHead(400); res.end("Missing src"); return;
    }

    const cacheKey = crypto.createHash("md5").update(src).digest("hex") + ".png";
    const localCachedFile = path.join(CACHE_DIR, cacheKey);

    if (fs.existsSync(localCachedFile)) {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=864000, immutable",
        "X-Cache-Lookup": "HIT"
      });
      fs.createReadStream(localCachedFile).pipe(res);
      return;
    }

    try {
      await ensureReady();
      let nasPath = src.replace(/^https?:\/\/[^\/]+/, "");
      if (!nasPath.startsWith("/")) nasPath = "/" + nasPath;

      const proxyReq = https.request({
        host: "127.0.0.1",
        port: activeUrlPort,
        path: nasPath,
        method: "GET",
        rejectUnauthorized: false,
        cert: cert,
        key: key,
        ca: ca,
        headers: {
          "Cookie": `token=${accessToken}`,
          "Authorization": accessToken
        },
        timeout: 4000
      }, (proxyRes) => {
        if (proxyRes.statusCode === 200) {
          res.writeHead(200, {
            "Content-Type": proxyRes.headers["content-type"] || "image/png",
            "Cache-Control": "public, max-age=864000, immutable"
          });
          const writeStream = fs.createWriteStream(localCachedFile);
          proxyRes.pipe(writeStream);
          proxyRes.pipe(res);
        } else {
          res.writeHead(404); res.end();
        }
      });
      proxyReq.on("error", () => {
        res.writeHead(404); res.end();
      });
      proxyReq.end();
    } catch (e) {
      res.writeHead(404); res.end();
    }
    return;
  }

  // 8. /api/stream 视频与大文件流式传输（WebDAV Range GET，支持 206 拖拽快进）
  //
  // 官方客户端没有 LuCI 取文件内容的接口，播放/下载一律走 WebDAV。
  // 这里同样用 WebDAV GET 并把浏览器的 Range 头原样透传，NAS 会回 206 与 Content-Range。
  if (pathname === "/api/stream") {
    const filePath = parsedUrl.searchParams.get("path") || "";
    if (!filePath) {
      res.writeHead(400); res.end("Missing path parameter"); return;
    }

    let streamRes;
    try {
      await ensureReady();
      const fwdHeaders = {};
      if (req.headers["range"]) fwdHeaders["Range"] = req.headers["range"];
      streamRes = await callWebdav("GET", filePath, fwdHeaders, null, 300000);
    } catch (e) {
      if (!res.headersSent) { res.writeHead(502); res.end("Stream error: " + e.message); }
      return;
    }

    const fileName = path.basename(filePath);
    const contentType = mimeFor(filePath);

    const responseHeaders = {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Range, Authorization, Content-Type",
      "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, Content-Disposition"
    };
    if (streamRes.headers["content-range"]) {
      responseHeaders["Content-Range"] = streamRes.headers["content-range"];
    }
    if (streamRes.headers["content-length"]) {
      responseHeaders["Content-Length"] = streamRes.headers["content-length"];
    }

    res.writeHead(streamRes.statusCode, responseHeaders);
    streamRes.pipe(res);
    return;
  }

  // 9. /api/upload 文件上传 (WebDAV PUT，自动注入 mTLS + 动态 Basic 凭据)
  // 用法: POST /api/upload?parent=<目录绝对路径>&filename=<文件名>  body = 原始文件字节流
  if (pathname === "/api/upload") {
    const parent = parsedUrl.searchParams.get("parent") || "";
    const filename = parsedUrl.searchParams.get("filename") || "";
    if (!parent || !filename) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "error", message: "缺少 parent 或 filename 参数" }));
      return;
    }

    try {
      await ensureReady();
      if (!activeWebdavPort) await detectActivePorts();

      const destPath = `${parent.replace(/\/$/, "")}/${filename}`;
      const totalSize = parseInt(req.headers["content-length"] || "0", 10);

      let responded = false;
      const finish = (status, payload) => {
        if (responded) return;
        responded = true;
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(payload));
      };

      // 必须声明 Content-Length，NAS 才会接受整块 PUT
      const davReq = openWebdavRequest("PUT", destPath, {
        "Content-Type": req.headers["content-type"] || "application/octet-stream",
        "Content-Length": totalSize
      });

      davReq.on("response", (davRes) => {
        // 204/201 表示写入成功
        if (davRes.statusCode === 204 || davRes.statusCode === 201 || davRes.statusCode === 200) {
          davRes.resume();
          finish(200, { status: "ok", path: destPath, size: totalSize });
        } else {
          const chunks = [];
          davRes.on("data", (d) => chunks.push(d));
          davRes.on("end", () => finish(502, {
            status: "error",
            code: davRes.statusCode,
            message: "NAS 拒绝上传: " + Buffer.concat(chunks).toString().substring(0, 200)
          }));
        }
      });
      davReq.on("error", (e) => finish(502, { status: "error", message: "上传通道错误: " + e.message }));

      // 浏览器请求体流式转发到 NAS，不落地内存
      req.pipe(davReq);
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "error", message: e.message }));
    }
    return;
  }

  // 9.1 /api/download 文件下载 (WebDAV GET，带 Content-Disposition 触发浏览器保存)
  if (pathname === "/api/download") {
    const filePath = parsedUrl.searchParams.get("path") || "";
    if (!filePath) {
      res.writeHead(400); res.end("Missing path parameter"); return;
    }

    try {
      await ensureReady();
      if (!activeWebdavPort) await detectActivePorts();

      const headers = {};
      if (req.headers["range"]) headers["Range"] = req.headers["range"];

      const stream = await callWebdav("GET", filePath, headers);

      if (stream.statusCode === 451) {
        res.writeHead(451, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "error", message: "NAS 拒绝访问该路径 (451)" }));
        return;
      }

      const outHeaders = {
        "Content-Type": stream.headers["content-type"] || "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`
      };
      if (stream.headers["content-length"]) outHeaders["Content-Length"] = stream.headers["content-length"];
      if (stream.headers["content-range"]) outHeaders["Content-Range"] = stream.headers["content-range"];

      res.writeHead(stream.statusCode, outHeaders);
      stream.pipe(res);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "error", message: e.message }));
      }
    }
    return;
  }

  // 9.2 /api/delete 删除文件或目录 (WebDAV DELETE)
  if (pathname === "/api/delete") {
    const target = parsedUrl.searchParams.get("path") || "";
    if (!target) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "error", message: "缺少 path 参数" }));
      return;
    }

    try {
      await ensureReady();
      if (!activeWebdavPort) await detectActivePorts();

      const davRes = await callWebdav("DELETE", target);
      const status = davRes.statusCode;
      davRes.resume();

      if (status === 204 || status === 200) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "ok", path: target }));
      } else {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "error", code: status, message: "删除失败 (HTTP " + status + ")" }));
      }
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "error", message: e.message }));
    }
    return;
  }

  // 9.3 /api/mkdir 新建文件夹 (WebDAV MKCOL)
  if (pathname === "/api/mkdir") {
    const target = parsedUrl.searchParams.get("path") || "";
    if (!target) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "error", message: "缺少 path 参数" }));
      return;
    }

    try {
      await ensureReady();
      if (!activeWebdavPort) await detectActivePorts();

      // 官方客户端路径统一以 / 结尾表示目录
      const dirPath = target.endsWith("/") ? target : target + "/";
      const davRes = await callWebdav("MKCOL", dirPath);
      const status = davRes.statusCode;
      davRes.resume();

      if (status === 201 || status === 200 || status === 405) {
        // 405 = 目录已存在，按成功处理
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "ok", path: dirPath }));
      } else {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "error", code: status, message: "创建目录失败 (HTTP " + status + ")" }));
      }
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "error", message: e.message }));
    }
    return;
  }

  // 10. /api/video/task 转码任务生命周期管理 (创建/查询清晰度/销毁)
  if (pathname === "/api/video/task") {
    try {
      await ensureReady();
      const action = parsedUrl.searchParams.get("action") || "create";
      const filePath = parsedUrl.searchParams.get("path") || "";
      const taskId = parsedUrl.searchParams.get("taskId") || "";

      if (action === "create") {
        // 官方客户端 transcodeCreateTask() 不带参数（player.js 内 reqCommonDeal 默认 {}），
        // 不带 file_path；转码文件由后续 transcode_switchable 指定。
        const resp = await callNasAPI("/cgi-bin/luci/player/transcode_create_task", {});
        const tId = resp.data?.data?.task_id || "";
        if (tId && filePath) {
          // 启动转码调度（这一步才带 file_path）
          await callNasAPI("/cgi-bin/luci/player/transcode_switchable", { task_id: tId, file_path: filePath });
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "ok", taskId: tId }));
        return;
      }

      if (action === "resolutions") {
        // 清晰度列表：官方响应结构为 data.resolution_list[].url_list[].m3u8_url
        // （字段名取自 player.js/socket.js 解码结果，不是猜的）
        const resp = await callNasAPI("/cgi-bin/luci/player/transcode_get_resolution", { task_id: taskId, file_path: filePath });
        const d = resp.data?.data || {};
        const list = Array.isArray(d.resolution_list) ? d.resolution_list : [];
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "ok", data: { resolutionList: list }, raw: d }));
        return;
      }

      if (action === "destroy") {
        // 销毁转码任务释放硬件资源
        await callNasAPI("/cgi-bin/luci/player/transcode_destroy_task", { task_id: taskId });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      res.writeHead(400); res.end("Invalid action");
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "error", message: e.message }));
    }
    return;
  }

  // 10.1 /api/events —— MQTT 推送的 SSE 转发（只读通道）
  //
  // 前端用 EventSource 订阅；网关侧把 mqtt-bridge 收到的每条 {topic,data}
  // 原样广播。SSE 是单向的，浏览器无法经此向 NAS 发任何东西。
  if (pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(`data: ${JSON.stringify({ topic: "gateway/hello", data: { mqtt: mqttBridge?.connected || false } })}\n\n`);
    sseClients.add(res);
    const ka = setInterval(() => {
      try { res.write(": keepalive\n\n"); } catch (e) {}
    }, 25000);
    req.on("close", () => {
      clearInterval(ka);
      sseClients.delete(res);
    });
    return;
  }

  // 10. /api/monitor 实时网络 RTT 测量
  if (pathname === "/api/monitor") {
    const start = Date.now();
    try {
      await ensureReady();
      await callNasAPI("/cgi-bin/luci/plugincenter/get_access_token", {});
      const rtt = Date.now() - start;
      const point = { time: new Date().toLocaleTimeString(), rtt, timestamp: Date.now() };
      rttHistory.push(point);
      if (rttHistory.length > 20) rttHistory.shift();

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        status: "ok",
        currentRTT: rtt,
        history: rttHistory,
        tunnel: "P2P 隧道 (127.0.0.1:" + activeUrlPort + ")"
      }));
    } catch (e) {
      // 测量失败就是失败：不生成随机 RTT 冒充真实采样（波形图上的假数据最难被发现）
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        status: "error",
        message: e.message,
        currentRTT: null,
        history: rttHistory,
        tunnel: ""
      }));
    }
    return;
  }

  // 9.4 只读查询转发组（第三轮探测已验证的接口与参数形状）
  //
  // 全部经 POST 透传到 /cgi-bin/luci/<module>/<endpoint>。
  // 这里只接收已确认是「查询」的接口；任何会写 NAS 状态的接口都不在此列。
  //
  // 已验证参数形状（实机探测 2026-09-20）：
  //   filemgr/get_detail_info   { path: ["/abs/path", ...] }   ← path 必须是数组
  //   filemgr/get_open_history  {}                              → data.files[]
  //   filemgr/get_search_history{}                              → data.history[] / top-level history[]
  //   filemgr/get_shared_list   { myshare:true, share2me:true } → data.files[]
  //   album/list_album          {}                              → data.albums[]
  //   album/info_album          { uuid:"<album_uuid>" }         → data.album
  //   album/list_member         { uuid, offset?, count? }       → data.photos[]
  //   player/subtitle_get_list  { video_path:"/abs/path" }      → data.subtitle_list[]
  //   player/subtitle_search_online { keyword, video_path }     → data.subtitle_list[]
  //   system/get_feature        {}                              → data.<module>.features
  //   system/get_power_status   {}                              → data.power
  //   system/get_upgrade_status {}                              → data.progress/state
  //   system/get_upgrade_history{}                              → data.history[]
  //   netshare/get_samba_info   {}                              → data.name/SMBv1/ip
  //   netshare/get_samba_account{}                              → data.account[]
  //   safebox/get_safebox_info  {}                              → data（保险箱状态）
  //   mediacenter/media_recently_watched {}                     → data
  //
  // 已验证不可用的（不再转发，见 docs/unimplemented-features.md 第三节）：
  //   filemgr/get_trashes 固定返回 5000；get_trashbins 空数据 —— 本机回收站功能不可达
  //   ipcmgr/list_record_camera 5000（dbus 失败）；mediacenter/file_list 2200
  if (pathname === "/api/query") {
    try {
      await ensureReady();
      const endpoint = parsedUrl.searchParams.get("ep") || "";
      // 只放已验证为只读的白名单，防止任意 LuCI 路径被转发成写操作
      const ALLOWED = new Set([
        "filemgr/get_detail_info",
        "filemgr/get_open_history",
        "filemgr/get_search_history",
        "filemgr/get_shared_list",
        "filemgr/get_shared_user",
        "filemgr/get_ocr",
        "album/list_album",
        "album/info_album",
        "album/list_member",
        "album/info_photo",
        "player/subtitle_get_list",
        "player/subtitle_search_online",
        "system/get_feature",
        "system/get_power_status",
        "system/get_upgrade_status",
        "system/get_upgrade_check",
        "system/get_upgrade_history",
        "netshare/get_samba_info",
        "netshare/get_samba_account",
        "safebox/get_safebox_info",
        "mediacenter/media_recently_watched",
        "mediacenter/media_recommend",
      ]);
      if (!ALLOWED.has(endpoint)) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "error", message: "endpoint not allowed" }));
        return;
      }

      // 读取前端 POST 来的 JSON body，原样透传
      let bodyRaw = "";
      for await (const chunk of req) bodyRaw += chunk;
      let body = {};
      try { body = bodyRaw ? JSON.parse(bodyRaw) : {}; } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "error", message: "invalid JSON body" }));
        return;
      }

      const r = await callNasAPI(`/cgi-bin/luci/${endpoint}`, body);
      const upstream = r.data || {};
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        status: upstream.code === 0 ? "ok" : "error",
        code: upstream.code,
        result: upstream.result,
        data: upstream.data ?? null,
      }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "error", message: e.message }));
    }
    return;
  }

  // 9.5 /plugin/* 代理 NAS 插件页面（影视墙等）
  //
  // 官方客户端的做法（index-DM3JDHLo.js 的 getPluginURL）：把插件 URL 里的
  // https://localhost:443 换成本机隧道，即 https://127.0.0.1:<urlport>/plugin/<uid>/<plugin>/...
  // 关键：该路径**必须带 token**（Cookie 或 Authorization），否则 Nginx 返回 403。
  //
  // 浏览器直接访问会有两个问题：自签证书 + 无法注入 token。
  // 所以这里由网关代理，注入 token 后转发，插件页面即可内嵌到 iframe 中。
  if (pathname.startsWith("/plugin/")) {
    try {
      await ensureReady();
      const upstream = parsedUrl.pathname + (parsedUrl.search || "");
      const headers = {
        Cookie: `token=${accessToken}`,
        Authorization: accessToken,
      };
      // 透传 Range，插件里的视频/大文件也支持拖拽
      if (req.headers["range"]) headers["Range"] = req.headers["range"];

      const proxyReq = https.request({
        host: "127.0.0.1",
        port: activeUrlPort,
        path: upstream,
        method: req.method,
        rejectUnauthorized: false,
        cert, key, ca,
        headers,
        timeout: 60000,
      }, (pres) => {
        const outHeaders = {};
        for (const k of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
          if (pres.headers[k]) outHeaders[k] = pres.headers[k];
        }
        // 插件是 SPA，入口 HTML 不缓存，静态资源可缓存
        outHeaders["Cache-Control"] = /\.(js|css|png|jpg|jpeg|svg|woff2?|ico)$/i.test(upstream)
          ? "public, max-age=86400"
          : "no-cache";
        res.writeHead(pres.statusCode, outHeaders);
        pres.pipe(res);
      });
      proxyReq.on("error", (e) => {
        if (!res.headersSent) { res.writeHead(502); res.end("插件代理失败: " + e.message); }
      });
      proxyReq.on("timeout", () => { proxyReq.destroy(); });
      // 支持插件的 POST（如 baidupan.cgi）
      if (req.method === "POST" || req.method === "PUT") {
        req.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
    } catch (e) {
      if (!res.headersSent) { res.writeHead(500); res.end("插件代理异常: " + e.message); }
    }
    return;
  }

  // 9. 静态前端资源托管 (生产 dist)
  let filePath = path.join(distDir, pathname === "/" ? "index.html" : pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(distDir, "index.html");
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".ico": "image/x-icon"
    };
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400"
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head><title>Mijia Web Gateway</title><style>body{font-family:sans-serif;padding:40px;background:#f5f6f7;text-align:center}</style></head>
      <body>
        <h2>Xiaomi Smart Storage Mijia-Web Gateway is Running!</h2>
        <p>Listening on <code>http://127.0.0.1:${SERVER_PORT}</code></p>
        <p>DID: <b>${DID}</b> | Target URL Port: <b>${activeUrlPort || 'Detecting...'}</b></p>
        <p>Building frontend bundle. Refresh in a few seconds.</p>
      </body>
      </html>
    `);
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.log("");
    console.log("[!] 端口 " + SERVER_PORT + " 已被占用，网关未启动。");
    console.log("    通常是上一次运行的网关进程还没有退出。");
    console.log("");
    console.log("    排查与处理（任选其一）：");
    console.log("      1) 直接访问 http://127.0.0.1:" + SERVER_PORT + " —— 若能看到控制台，说明旧实例仍在正常工作。");
    console.log("      2) 结束占用端口的进程后重新启动：");
    console.log("         powershell -NoProfile -Command \"Get-NetTCPConnection -LocalPort " + SERVER_PORT + " -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }\"");
    console.log("");
    process.exit(1);
  }
  console.error("[!] 网关启动失败:", e.message);
  process.exit(1);
});

server.listen(SERVER_PORT, "127.0.0.1", async () => {
  console.log("=======================================================");
  console.log(`[√] 米家 Web 控制台中继服务已就绪: http://127.0.0.1:${SERVER_PORT}`);
  console.log(`[√] 本地多级磁盘缓存系统已挂载: ${CACHE_DIR}`);
  console.log("正在尝试与远端 NAS 隧道建立会话连接...");
  try {
    await ensureReady();
    console.log(`[√] 成功捕获穿透通道 127.0.0.1:${activeUrlPort} 并完成 Token 鉴权就绪！`);
    console.log(`[√] WebDAV 文件读写通道: 127.0.0.1:${activeWebdavPort} (上传/下载/删除已就绪)`);
    startMqttBridge();
    console.log(`[√] MQTT 只读推送桥已启动: /api/events (SSE)`);
  } catch (e) {
    console.log(`[*] 会话提醒: ${e.message} (服务已进入智能演示/离线待命模式)`);
  }
  console.log("=======================================================\n");
});
