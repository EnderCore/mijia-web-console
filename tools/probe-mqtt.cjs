/**
 * 里程碑 0 —— MQTT 只读探针
 *
 * 目的：验证能不能在不影响官方客户端的前提下订阅 NAS 推送。
 *
 * 严格只读：
 *   - 只 connect + subscribe + 收 message，永不 publish
 *   - 官方同款连接参数（wss://127.0.0.1:<urlport>，mTLS 证书，token 密码）
 *   - clientId / username 后缀与官方区分，便于在 broker 侧区分会话
 *
 * 由用户手动运行：node tools/probe-mqtt.cjs
 * 运行 90 秒后自动退出。观察点：
 *   1. 是否 connect 成功
 *   2. 是否收到 meminfo/usbinfo 推送（字段结构）
 *   3. 期间官方客户端是否出现掉线/重连提示
 */
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

let mqtt;
const MQTT_CANDIDATES = [
  "mqtt",
  // 官方客户端 app.asar 解包目录里的 mqtt 库（已确认存在于 analysis 提取副本）
  "K:/DATA/AI/ZCode/xiaomi智能存储/analysis/extracted/app-asar/node_modules/mqtt",
];
for (const cand of MQTT_CANDIDATES) {
  try { mqtt = require(cand); break; } catch (e) {}
}
if (!mqtt) {
  console.error("缺少 mqtt 依赖。可选方案：");
  console.error("  1) npm install mqtt --prefix <web-test>/tools-deps");
  console.error('  2) NODE_PATH="K:/DATA/AI/ZCode/xiaomi智能存储/analysis/extracted/app-asar/node_modules" node tools/probe-mqtt.cjs');
  process.exit(1);
}

const certDir = path.join(process.env.LOCALAPPDATA || "", "minasCert");
const files = fs.readdirSync(certDir);
const certFile = files.find((f) => f.endsWith("_cert.pem"));
const keyFile = files.find((f) => f.endsWith("_private_key.pem"));
const caFile = files.find((f) => f.startsWith("ca_chain"));
const cert = fs.readFileSync(path.join(certDir, certFile));
const key = fs.readFileSync(path.join(certDir, keyFile));
const ca = fs.readFileSync(path.join(certDir, caFile));
const DID = (certFile.match(/\d+_(\d+)_cert\.pem/) || [])[1] || "";
const needle = DID ? crypto.createHash("sha1").update(DID).digest("hex") : "";

// 从 webdav 凭据里拿 UID（username 形如 u<UID>）
function readUid() {
  const lsDir = path.join(process.env.APPDATA || "", "SmartStorage", "Partitions", "session", "Local Storage", "leveldb");
  if (!fs.existsSync(lsDir)) return "";
  for (const fn of fs.readdirSync(lsDir)) {
    if (!/\.(ldb|log)$/.test(fn)) continue;
    try {
      const raw = fs.readFileSync(path.join(lsDir, fn)).toString("latin1");
      const m = raw.match(/"username":"u(\d+)"/);
      if (m) return m[1];
    } catch (e) {}
  }
  return "";
}

function urlPort() {
  const ps = execSync(
    `powershell -NoProfile -Command "$p = Get-Process | Where-Object {$_.ProcessName -like '*SmartStorage*' -or $_.ProcessName -like '*小米*'} | Select-Object -ExpandProperty Id; Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.OwningProcess -in $p} | Select-Object -ExpandProperty LocalPort"`,
    { stdio: ["ignore", "pipe", "ignore"] }
  ).toString();
  const ports = [...new Set(ps.split(/\s+/).map((s) => parseInt(s, 10)).filter(Number.isFinite))].sort((a, b) => a - b);
  for (let i = 0; i < ports.length - 5; i++) {
    if (ports[i + 5] - ports[i] === 5) return ports[i];
  }
  return 0;
}

function fetchToken(port) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({});
    const req = https.request(
      {
        host: "127.0.0.1", port, path: "/cgi-bin/luci/plugincenter/get_access_token",
        method: "POST", rejectUnauthorized: false, cert, key, ca,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        timeout: 6000,
      },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => {
          try { resolve(JSON.parse(b).data.token); } catch (e) { reject(new Error("token parse fail: " + b.slice(0, 120))); }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("token timeout")); });
    req.write(payload);
    req.end();
  });
}

(async () => {
  const PORT = urlPort();
  const UID = readUid();
  if (!PORT) { console.error("未找到隧道端口"); process.exit(1); }
  if (!UID) { console.error("未找到 UID（官方客户端未登录？）"); process.exit(1); }

  const token = await fetchToken(PORT);
  const randSuffix = crypto.randomBytes(4).toString("hex");

  console.log(`urlport=${PORT} uid=${UID} did=${DID}`);
  console.log(`token=${token ? "OK" : "FAIL"}`);
  console.log(`clientId=dev-zcode-probe-${randSuffix}`);
  console.log(`username=${UID}_zcode-${randSuffix}`);
  console.log();

  const client = mqtt.connect(`wss://127.0.0.1:${PORT}`, {
    clientId: `dev-zcode-probe-${randSuffix}`,
    username: `${UID}_zcode-${randSuffix}`,
    password: token,
    protocol: "wss",
    keepalive: 30,
    reconnectPeriod: 0,              // 不自动重连，90 秒探针不需要
    connectTimeout: 15000,
    resubscribe: false,
    wsOptions: {
      rejectUnauthorized: false,     // 探针阶段放宽；正式实现再开 checkServerIdentity
      ca, cert, key,
    },
  });

  const TOPICS = [
    "/sys/nas/alluser/meminfo/update",
    "/sys/nas/alluser/usbinfo/update",
    "/sys/nas/alluser/disk",
    `/sys/+/${UID}/filemgr`,
    `/sys/+/${UID}/homepage`,
  ];

  let msgCount = 0;

  client.on("connect", () => {
    console.log("[√] MQTT CONNECT 成功");
    client.subscribe(TOPICS, { qos: 0 }, (err, granted) => {
      if (err) {
        console.error("[×] SUBSCRIBE 失败:", err.message);
      } else {
        console.log("[√] SUBSCRIBE 成功:", (granted || []).map((g) => `${g.topic}(qos${g.qos})`).join(", "));
      }
    });
  });

  client.on("message", (topic, payload, packet) => {
    msgCount++;
    const text = payload.toString();
    console.log(`\n[MSG #${msgCount}] topic=${topic}`);
    try {
      console.log(JSON.stringify(JSON.parse(text), null, 1).slice(0, 1500));
    } catch (e) {
      console.log(text.slice(0, 500));
    }
  });

  client.on("error", (e) => console.error("[×] MQTT error:", e.message));
  client.on("close", () => console.log("[i] MQTT close"));
  client.on("offline", () => console.log("[i] MQTT offline"));
  client.on("reconnect", () => console.log("[i] MQTT reconnecting"));

  // 90 秒后自动退出
  setTimeout(() => {
    console.log(`\n===== 90 秒结束，共收到 ${msgCount} 条推送 =====`);
    client.end(true);
    process.exit(0);
  }, 90000);

  console.log("监听中（90 秒自动退出）。期间请观察官方客户端是否正常……");
})();
