/**
 * 只读探测：完整打印 NAS 硬件类接口的原始响应（不截断），
 * 用于确认 SMART / UPS 等还有哪些字段之前被截断漏看了。
 *
 * 严格只读：只发 POST 查询，不调用任何写操作，不写 NAS 数据。
 *
 * 用法：node tools/dump-full-hardware.cjs
 */
const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const certDir = path.join(process.env.LOCALAPPDATA || "", "minasCert");
const files = fs.readdirSync(certDir);
const cert = fs.readFileSync(path.join(certDir, files.find((f) => f.endsWith("_cert.pem"))));
const key = fs.readFileSync(path.join(certDir, files.find((f) => f.endsWith("_private_key.pem"))));
const ca = fs.readFileSync(path.join(certDir, files.find((f) => f.startsWith("ca_chain"))));

function findPortGroup() {
  const ps = execSync(
    `powershell -NoProfile -Command "$p = Get-Process | Where-Object {$_.ProcessName -like '*SmartStorage*' -or $_.ProcessName -like '*小米*'} | Select-Object -ExpandProperty Id; Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.OwningProcess -in $p} | Select-Object -ExpandProperty LocalPort"`,
    { stdio: ["ignore", "pipe", "ignore"] }
  ).toString();
  const ports = [...new Set(ps.split(/\s+/).map((s) => parseInt(s, 10)).filter(Number.isFinite))].sort((a, b) => a - b);
  for (let i = 0; i < ports.length - 5; i++) {
    if (ports[i + 5] - ports[i] === 5) return ports.slice(i, i + 6);
  }
  return null;
}

let token = "";
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
          ...(token ? { Cookie: `token=${token}`, Authorization: token } : {}),
        },
        timeout: 15000,
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
  const group = findPortGroup();
  if (!group) { console.error("未找到隧道端口组"); process.exit(1); }
  const urlport = group[0];

  const t = await call(urlport, "/cgi-bin/luci/plugincenter/get_access_token", {});
  try { token = JSON.parse(t.body).data.token || ""; } catch (e) {}
  console.log("token:", token ? "OK" : "FAIL");
  console.log();

  // 关键：之前这些响应被 slice 截断了，这里完整打印
  const targets = [
    "/cgi-bin/luci/storage/get_storage_info",
    "/cgi-bin/luci/system/get_device_status",
    "/cgi-bin/luci/system/get_feature",
    "/cgi-bin/luci/filemgr/get_pool_info",
  ];

  for (const a of targets) {
    const r = await call(urlport, a, {});
    console.log("=".repeat(78));
    console.log(`${r.status}  ${a}   (${r.body.length} 字节)`);
    console.log("=".repeat(78));
    try {
      console.log(JSON.stringify(JSON.parse(r.body), null, 2));
    } catch (e) {
      console.log(r.body);
    }
    console.log();
  }

  // SMART / UPS 相关候选接口（只读探测是否存在）
  const candidates = [
    "/cgi-bin/luci/storage/get_disk_smart",
    "/cgi-bin/luci/storage/get_smart",
    "/cgi-bin/luci/storage/get_disk_detail",
    "/cgi-bin/luci/storage/get_disk_info",
    "/cgi-bin/luci/storage/smart",
    "/cgi-bin/luci/system/get_ups_info",
    "/cgi-bin/luci/system/get_ups",
    "/cgi-bin/luci/system/ups_status",
    "/cgi-bin/luci/storage/get_raid_info",
    "/cgi-bin/luci/storage/get_badblock",
    "/cgi-bin/luci/system/get_sensor",
    "/cgi-bin/luci/system/get_temperature",
    "/cgi-bin/luci/system/get_network_info",
    "/cgi-bin/luci/system/get_fan_info",
  ];
  console.log("=".repeat(78));
  console.log("SMART / UPS 候选接口探测");
  console.log("=".repeat(78));
  for (const c of candidates) {
    const r = await call(urlport, c, {});
    const b = r.body.trim();
    console.log(`${String(r.status).padEnd(4)} ${c}`);
    if (b && r.status !== 403) console.log(`      ${b.slice(0, 500)}`);
  }
})();
