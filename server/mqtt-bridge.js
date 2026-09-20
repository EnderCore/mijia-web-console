/**
 * MQTT 只读桥：订阅 NAS 推送主题，把事件转给网关内的 SSE 客户端。
 *
 * 严格只读：
 *   - 只 connect + subscribe + 收 message，本模块没有任何 publish 调用
 *   - clientId / username 用 zcode 专属后缀，与官方客户端区分会话
 *   - 断线后先 ensureReady() 刷新 token 再重连（指数退避，封顶 30s）
 *
 * 主题表提取自官方渲染层 layout bundle（见 docs/mqtt-implementation-plan.md）。
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

let mqttLib = null;
const MQTT_CANDIDATES = [
  "mqtt",
  "K:/DATA/AI/ZCode/xiaomi智能存储/analysis/extracted/app-asar/node_modules/mqtt",
];
for (const cand of MQTT_CANDIDATES) {
  try { mqttLib = require(cand); break; } catch (e) {}
}

// uid 有两条来源：优先 WebDAV 凭据的 username（u<UID>），
// 其次官方客户端 Local Storage 里的 loginInfo/deviceCurrentInfo。
// 后者在凭据文件还没被官方写入时是更可靠的来源。
// 官方 deviceUid 存在 userData/.device.uid（deviceIdService 读写），
// MQTT username 后缀就是用它；读不到时回退到 Local Storage。
function readDeviceUid() {
  const p = path.join(process.env.APPDATA || "", "SmartStorage", ".device.uid");
  try { return fs.readFileSync(p, "utf8").trim(); } catch (e) { return ""; }
}

function readUidFromLocalStorage() {
  const lsDir = path.join(process.env.APPDATA || "", "SmartStorage", "Partitions", "session", "Local Storage", "leveldb");
  if (!fs.existsSync(lsDir)) return "";
  for (const fn of fs.readdirSync(lsDir)) {
    if (!/\.(ldb|log)$/.test(fn)) continue;
    try {
      const raw = fs.readFileSync(path.join(lsDir, fn)).toString("latin1");
      // "loginInfo" JSON 里有 uid；deviceCurrentInfo 也有 uid 字段
      const m = raw.match(/"uid":"?(\d{6,})"?/);
      if (m) return m[1];
    } catch (e) {}
  }
  return "";
}

// uid 从 WebDAV 凭据推导（username 是 u<UID>），避免硬编码
function topicList(uid) {
  return [
    "/sys/nas/alluser/meminfo/update",
    "/sys/nas/alluser/usbinfo/update",
    "/sys/nas/alluser/disk",
    "/sys/nas/alluser/storage/modifypool",
    `/sys/+/${uid}/filemgr`,
    `/sys/+/${uid}/homepage`,
    `/sys/+/${uid}/safebox`,
    `/sys/+/${uid}/plugin`,
    `/sys/+/${uid}/ipc_yolo`,
    `/sys/+/${uid}/ipc_delete`,
    `/sys/nas/${uid}/album/member_update`,
    `/sys/nas/${uid}/album/new_album`,
    `/sys/nas/${uid}/album/del_album`,
    `/sys/nas/${uid}/album/rename_album`,
  ];
}

class MqttBridge {
  /**
   * deps: { ensureReady, getAccessToken, getUrlPort, getUid, getDeviceUid, cert, key, ca }
   * onEvent(topic, payloadObject) —— 每条消息回调
   */
  constructor(deps, onEvent) {
    this.deps = deps;
    this.onEvent = onEvent;
    this.client = null;
    this.connected = false;
    this.retryDelay = 1000;
    this.stopped = false;
    this.randSuffix = crypto.randomBytes(4).toString("hex");
    // username 后缀轮换序列：官方用 deviceUid；Not authorized 时逐个试
    this.suffixCandidates = null; // null = 未初始化
    this.suffixIdx = 0;
  }

  async start() {
    if (!mqttLib) {
      console.log("[mqtt] 未找到 mqtt 库，推送通道未启动（轮询兜底仍可用）");
      return;
    }
    await this._connect();
  }

  async _connect() {
    if (this.stopped) return;
    try {
      await this.deps.ensureReady();
      const port = this.deps.getUrlPort();
      const uid = this.deps.getUid() || readUidFromLocalStorage();
      const token = this.deps.getAccessToken();
      if (!port || !uid || !token) throw new Error(`MQTT 参数不完整 (port=${port} uid=${uid} token=${!!token})`);

      // username 后缀候选：先试官方同款 deviceUid（broker 按 uid 段授权，
      // 后缀不参与鉴权），被 Not authorized 拒绝时依次换备选。
      if (!this.suffixCandidates) {
        const deviceUid = (this.deps.getDeviceUid && this.deps.getDeviceUid()) || readDeviceUid();
        this.suffixCandidates = [
          deviceUid,                 // 官方形状：<uid>_<deviceUid>
          `zcode-${this.randSuffix}`,// 自有后缀
          "user0",                   // 客户端兜底值（解混淆出的字符串）
          "",                        // 裸 uid
        ].filter((x, i, a) => x != null && a.indexOf(x) === i);
        this.suffixIdx = 0;
      }
      const suffix = this.suffixCandidates[this.suffixIdx % this.suffixCandidates.length];
      const username = suffix ? `${uid}_${suffix}` : uid;
      const clientId = `dev-${suffix || ("zcode-" + this.randSuffix)}`;

      const opts = {
        clientId,
        username,
        password: token,
        protocol: "wss",
        keepalive: 30,
        reconnectPeriod: 0,      // 自己管重连，与官方一致
        connectTimeout: 15000,
        resubscribe: false,
        wsOptions: {
          rejectUnauthorized: false,
          ca: this.deps.ca,
          cert: this.deps.cert,
          key: this.deps.key,
          // nginx 侧按 token 校验身份，与 LuCI 一致放 Cookie + Authorization
          headers: {
            Cookie: `token=${token}`,
            Authorization: token,
          },
        },
      };

      console.log(`[mqtt] 连接 wss://127.0.0.1:${port}/mqtt username=${username} clientId=${clientId}`);
      // NAS 的 MQTT broker 挂在 /mqtt 路径（裸 wss://host:port 会被 nginx 按普通 HTTPS 处理，
      // 握手升到 101 后立即被关闭——实测确认）
      const client = mqttLib.connect(`wss://127.0.0.1:${port}/mqtt`, opts);
      this.client = client;

      client.on("connect", () => {
        this.connected = true;
        this.retryDelay = 1000;
        console.log("[mqtt] 已连接，订阅推送主题");
        client.subscribe(topicList(uid), { qos: 0 }, (err) => {
          if (err) console.log("[mqtt] 订阅失败:", err.message);
        });
      });

      client.on("message", (topic, payload) => {
        let data = null;
        try { data = JSON.parse(payload.toString()); } catch (e) { data = payload.toString(); }
        try { this.onEvent(topic, data); } catch (e) { /* 前端回调错误不影响连接 */ }
      });

      client.on("error", (e) => {
        console.log("[mqtt] 错误:", e.message || e);
        // broker 拒绝授权 → 换下一个 username 后缀重试
        if (/not authorized/i.test(e.message || "") && this.suffixCandidates) {
          this.suffixIdx++;
          console.log(`[mqtt] 换 username 后缀重试 (第 ${this.suffixIdx + 1} 个候选)`);
        }
      });

      client.on("close", () => {
        if (this.connected) console.log("[mqtt] 连接断开，准备重连");
        else console.log("[mqtt] 握手未完成即关闭");
        this.connected = false;
        this.client = null;
        if (!this.stopped) {
          setTimeout(() => this._connect(), this.retryDelay);
          this.retryDelay = Math.min(this.retryDelay * 2, 30000);
        }
      });

      client.on("disconnect", (p) => console.log("[mqtt] disconnect packet:", JSON.stringify(p)));
      client.on("offline", () => console.log("[mqtt] offline"));
    } catch (e) {
      console.log("[mqtt] 连接失败:", e.message, "（稍后重试）");
      if (!this.stopped) {
        setTimeout(() => this._connect(), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 30000);
      }
    }
  }

  stop() {
    this.stopped = true;
    if (this.client) {
      try { this.client.end(true); } catch (e) {}
      this.client = null;
    }
    this.connected = false;
  }
}

module.exports = { MqttBridge, mqttAvailable: !!mqttLib };
