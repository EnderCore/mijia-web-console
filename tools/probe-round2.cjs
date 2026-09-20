/**
 * 只读探测（第二轮）：验证待接入接口的真实返回结构。
 *
 * 在 probe-unimplemented.cjs 基础上修正参数形状：
 *   - get_trashes 需要 trash_id（先由 get_trashbins 拿目录 ID）
 *   - get_shared_list 需要 myshare/share2me 布尔字段（官方 safe 页调用形状）
 *   - info_album 需要 album_uuid（先由 list_album 拿）
 *   - get_detail_info 需要 path（拿 open_history 里的真实文件路径喂它）
 *
 * 严格只读：只发 POST 查询，不调用任何写接口。
 * 用法：node tools/probe-round2.cjs
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

const PORT = urlPort();
let token = "";

function call(action, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body || {});
    const req = https.request(
      {
        host: "127.0.0.1", port: PORT, path: action, method: "POST",
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

function dump(name, r, maxLen = 1200) {
  console.log(`--- ${name} (HTTP ${r.status})`);
  let body = r.body;
  try {
    body = JSON.stringify(JSON.parse(r.body), null, 1);
  } catch (e) {}
  console.log(body.slice(0, maxLen) + (body.length > maxLen ? " …[截断]" : ""));
  console.log();
}

(async () => {
  if (!PORT) { console.error("未找到隧道端口"); process.exit(1); }
  const t = await call("/cgi-bin/luci/plugincenter/get_access_token", {});
  try { token = JSON.parse(t.body).data.token || ""; } catch (e) {}
  console.log("urlport:", PORT, "token:", token ? "OK" : "FAIL", "\n");

  // ---- 回收站：先拿 bin 列表，再逐 bin 查内容 ----
  const bins = await call("/cgi-bin/luci/filemgr/get_trashbins", {});
  dump("get_trashbins", bins);
  let trashIds = [];
  try {
    const d = JSON.parse(bins.body).data;
    const arr = Array.isArray(d) ? d : (d.list || d.bins || []);
    trashIds = arr.map((b) => b.trash_id ?? b.id ?? b).filter((x) => x !== undefined);
  } catch (e) {}
  console.log("trashIds:", JSON.stringify(trashIds), "\n");
  const r1 = await call("/cgi-bin/luci/filemgr/get_trashes", {
    trash_id: trashIds, type: "filemgr", page: { size: 50, token: "" },
  });
  dump("get_trashes (trash_id=[...])", r1);

  // ---- 共享列表：官方形状 {myshare,share2me,order} ----
  const r2 = await call("/cgi-bin/luci/filemgr/get_shared_list", {
    myshare: true, share2me: true, order: { basis: "modified_time", desc: true },
  });
  dump("get_shared_list", r2);

  // ---- 相册：list_album → info_album ----
  const r3 = await call("/cgi-bin/luci/album/list_album", {});
  dump("list_album", r3, 2000);
  let albumUuid = "";
  try {
    const d = JSON.parse(r3.body).data;
    const arr = Array.isArray(d) ? d : (d.list || d.albums || []);
    albumUuid = arr[0]?.uuid || arr[0]?.album_uuid || "";
  } catch (e) {}
  console.log("albumUuid:", albumUuid, "\n");
  if (albumUuid) {
    const r4 = await call("/cgi-bin/luci/album/info_album", { album_uuid: albumUuid });
    dump("info_album", r4, 1500);
  }

  // ---- 打开历史 → 拿一条真实路径喂 get_detail_info ----
  const r5 = await call("/cgi-bin/luci/filemgr/get_open_history", {});
  dump("get_open_history", r5, 1500);
  let samplePath = "";
  try {
    const d = JSON.parse(r5.body).data;
    const list = d.list || d.files || (Array.isArray(d) ? d : []);
    const first = list[0];
    samplePath = first?.path || (first?.parent ? `${first.parent}/${first.name}` : "") || "";
  } catch (e) {}
  console.log("samplePath:", samplePath, "\n");
  if (samplePath) {
    const r6 = await call("/cgi-bin/luci/filemgr/get_detail_info", { path: samplePath });
    dump("get_detail_info", r6, 1500);
  }

  // ---- 能力开关 / 电源 / 升级 / SMB ----
  dump("get_feature", await call("/cgi-bin/luci/system/get_feature", {}), 2500);
  dump("get_power_status", await call("/cgi-bin/luci/system/get_power_status", {}));
  dump("get_upgrade_status", await call("/cgi-bin/luci/system/get_upgrade_status", {}));
  dump("get_upgrade_history", await call("/cgi-bin/luci/system/get_upgrade_history", {}));
  dump("get_samba_info", await call("/cgi-bin/luci/netshare/get_samba_info", {}));
  dump("get_samba_account", await call("/cgi-bin/luci/netshare/get_samba_account", {}));
  dump("media_recently_watched", await call("/cgi-bin/luci/mediacenter/media_recently_watched", {}), 800);
  dump("get_safebox_info", await call("/cgi-bin/luci/safebox/get_safebox_info", {}), 800);
})();
