/**
 * 只读探测：NAS 明文 Web 端口（webport = base+2）上提供哪些页面。
 *
 * 背景：官方客户端的 /public/dist/ 目录名（sysSetting、networkneighbor、safe…）
 * 就是它要加载的页面清单。这些页面由 NAS 自己提供，客户端只是内嵌。
 * 其中「系统设置」页很可能直接展示硬盘信息——这正是官方 App 能显示硬盘状态的原因。
 *
 * 严格只读：只发 HTTP GET，不带任何写操作，不修改 NAS 状态。
 *
 * 用法：node tools/probe-nas-webui.cjs
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ---------- 找 webport（6 连号端口组的 base+2） ----------
function findPortGroup() {
  const ps = execSync(
    `powershell -NoProfile -Command "$p = Get-Process | Where-Object {$_.ProcessName -like '*SmartStorage*' -or $_.ProcessName -like '*小米*'} | Select-Object -ExpandProperty Id; Get-NetTCPConnection -State Listen | Where-Object {$_.OwningProcess -in $p} | Select-Object -ExpandProperty LocalPort"`,
    { stdio: ["ignore", "pipe", "ignore"] }
  ).toString();
  const ports = [...new Set(ps.split(/\s+/).map((s) => parseInt(s, 10)).filter(Number.isFinite))].sort((a, b) => a - b);
  for (let i = 0; i < ports.length - 5; i++) {
    if (ports[i + 5] - ports[i] === 5) return ports.slice(i, i + 6);
  }
  return null;
}

function get(port, p, host) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: p, method: "GET", headers: { Host: host || "127.0.0.1" }, timeout: 6000 },
      (res) => {
        let b = "";
        res.on("data", (d) => {
          b += d;
          if (b.length > 200000) req.destroy();
        });
        res.on("end", () => resolve({ status: res.statusCode, ctype: res.headers["content-type"] || "", body: b, len: b.length }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, ctype: "", body: "ERR " + e.message, len: 0 }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, ctype: "", body: "TIMEOUT", len: 0 }); });
    req.end();
  });
}

(async () => {
  const group = findPortGroup();
  if (!group) { console.error("未找到 6 连号端口组，客户端隧道可能未就绪"); process.exit(1); }
  const [urlport, webdavport, webport, transcodeport, ipcPort, clawPort] = group;
  console.log(`端口组: urlport=${urlport} webdavport=${webdavport} webport=${webport} transcodeport=${transcodeport} ipcPort=${ipcPort} clawPort=${clawPort}`);
  console.log();

  // 客户端 dist 目录名 = 待加载页面清单
  const pages = [
    "/", "/index.html",
    "/sysSetting/", "/sysSetting",
    "/networkneighbor/",
    "/file-manager/", "/file-pictures/", "/file-preview/", "/file-taskCenter/",
    "/safe/", "/appCenter/", "/notice/", "/recycleBin/", "/syncSetting/",
    "/user-manager/", "/videoDetail/", "/xunleiProject/", "/helpCenterDetail/",
  ];

  console.log("=== webport 页面探测（只读 GET） ===");
  for (const p of pages) {
    const r = await get(webport, p);
    const head = r.body.replace(/\s+/g, " ").trim().slice(0, 120);
    console.log(`${String(r.status).padEnd(4)} ${p.padEnd(24)} len=${String(r.len).padEnd(7)} ${r.ctype}`);
    if (r.status === 200 && head) console.log(`      ${head}`);
  }

  // webport 上是否直接有硬件/磁盘接口
  console.log();
  console.log("=== webport 上的可疑硬件接口（只读 GET） ===");
  const apis = [
    "/sys/nas/alluser/usbinfo/update",
    "/sys/nas/alluser/meminfo/update",
    "/cgi-bin/luci/home/get_profile",
    "/api/sysinfo", "/api/disk", "/api/storage",
  ];
  for (const a of apis) {
    const r = await get(webport, a);
    const head = r.body.replace(/\s+/g, " ").trim().slice(0, 200);
    console.log(`${String(r.status).padEnd(4)} ${a.padEnd(36)} len=${r.len}`);
    if (head) console.log(`      ${head}`);
  }
})();
