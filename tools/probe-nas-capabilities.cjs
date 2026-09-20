/**
 * 只读探测：确认 NAS 到底开放了哪些查询接口，特别是硬件/磁盘信息。
 *
 * 目的：验证逆向结论——官方客户端是否真的只能通过 MQTT 主题拿到 usb/mem 信息，
 * 而 LuCI 侧没有任何硬件查询接口。
 *
 * 严格只读：
 *   - 只用 POST 调用查询类 action，绝不调用任何写/删/改接口
 *   - 绝不调用 p2pinit（会销毁并重建隧道）
 *   - 不写入 NAS 任何数据、不创建测试文件
 *
 * 用法：node tools/probe-nas-capabilities.cjs
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

// ---------- 证书与端口（自动探测，不硬编码） ----------
const certDir = path.join(process.env.LOCALAPPDATA || "", "minasCert");
if (!fs.existsSync(certDir)) {
  console.error("找不到证书目录:", certDir);
  process.exit(1);
}
const files = fs.readdirSync(certDir);
const certFile = files.find((f) => f.endsWith("_cert.pem"));
const cert = fs.readFileSync(path.join(certDir, certFile));
const key = fs.readFileSync(path.join(certDir, files.find((f) => f.endsWith("_private_key.pem"))));
const ca = fs.readFileSync(path.join(certDir, files.find((f) => f.startsWith("ca_chain"))));

const m = certFile.match(/(\d+)_(\d+)_cert\.pem/);
const DID = m ? m[2] : "";

let accessToken = "";

function call(port, action, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body || {});
    const req = https.request(
      {
        host: "127.0.0.1", port, path: action, method: "POST",
        rejectUnauthorized: false, cert, key, ca,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...(accessToken ? { Cookie: `token=${accessToken}`, Authorization: accessToken } : {}),
        },
        timeout: 8000,
      },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, body: "ERR " + e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "TIMEOUT" }); });
    req.write(payload);
    req.end();
  });
}

(async () => {
  // 1. 读官方客户端实际监听的端口
  const { execSync } = require("child_process");
  let listeners = [];
  try {
    const ps = execSync(
      `powershell -NoProfile -Command "$p = Get-Process | Where-Object {$_.ProcessName -like '*SmartStorage*' -or $_.ProcessName -like '*小米*'} | Select-Object -ExpandProperty Id; Get-NetTCPConnection -State Listen | Where-Object {$_.OwningProcess -in $p} | Select-Object -ExpandProperty LocalPort"`,
      { stdio: ["ignore", "pipe", "ignore"] }
    ).toString();
    listeners = [...new Set(ps.split(/\s+/).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  } catch (e) {
    console.error("无法枚举监听端口:", e.message);
    process.exit(1);
  }

  // 找 6 连号段 = P2P 端口组
  let group = [];
  for (let i = 0; i < listeners.length - 5; i++) {
    if (listeners[i + 5] - listeners[i] === 5) { group = listeners.slice(i, i + 6); break; }
  }
  if (group.length === 0) {
    console.error("未找到 6 连号端口组，客户端可能未建立隧道。已监听:", listeners.join(","));
    process.exit(1);
  }

  const [urlport, webdavport, webport, transcodeport, ipcPort, clawPort] = group;
  console.log(`DID: ${DID}`);
  console.log(`端口组: urlport=${urlport} webdavport=${webdavport} webport=${webport} transcodeport=${transcodeport} ipcPort=${ipcPort} clawPort=${clawPort}`);
  console.log();

  // 2. 取 token（仅存内存，不落盘）
  const tok = await call(urlport, "/cgi-bin/luci/plugincenter/get_access_token", {});
  try { accessToken = JSON.parse(tok.body).data.token || ""; } catch (e) {}
  console.log(`[token] status=${tok.status} ${accessToken ? "已获取" : "失败: " + tok.body.slice(0, 200)}`);
  console.log();

  // 3. 逐个探测候选接口（全部只读查询）
  const candidates = [
    // 官方客户端里确实存在的
    "/cgi-bin/luci/usermanager/user_list",
    "/cgi-bin/luci/plugincenter/get_app_list",
    "/cgi-bin/luci/filemgr/get_thumbnail_config",
    "/cgi-bin/luci/home/get_profile",
    // 猜测的硬件类接口（用于证明它们不存在）
    "/cgi-bin/luci/home/get_sysinfo",
    "/cgi-bin/luci/home/sysinfo",
    "/cgi-bin/luci/home/get_device_info",
    "/cgi-bin/luci/home/get_hardware",
    "/cgi-bin/luci/system/get_diskinfo",
    "/cgi-bin/luci/storage/get_diskinfo",
    "/cgi-bin/luci/storage/get_pool_info",
    "/cgi-bin/luci/home/get_storage",
    "/cgi-bin/luci/home/get_disk",
    "/cgi-bin/luci/home/disk_info",
    "/cgi-bin/luci/home/get_cpu",
    "/cgi-bin/luci/home/get_memory",
    "/cgi-bin/luci/system/get_status",
    "/cgi-bin/luci/diskmanager/get_disk_list",
    "/cgi-bin/luci/storagemgr/get_disk_list",
    "/cgi-bin/luci/storagemgr/get_volume_list",
    "/cgi-bin/luci/hardware/get_info",
    "/cgi-bin/luci/monitor/get_status",
  ];

  console.log("=== 接口探测（只读 POST） ===");
  for (const c of candidates) {
    const r = await call(urlport, c, {});
    let note = "";
    const b = (r.body || "").trim();
    if (b) {
      try {
        const j = JSON.parse(b);
        note = JSON.stringify(j).slice(0, 220);
      } catch (e) {
        note = b.slice(0, 160).replace(/\s+/g, " ");
      }
    }
    console.log(`${String(r.status).padEnd(4)} ${c}`);
    if (note) console.log(`      ${note}`);
  }
})();
