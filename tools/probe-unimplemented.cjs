/**
 * 只读探测：确认「尚未实现」的那些接口里，哪些真的可用。
 *
 * 目的：为功能对照表提供依据 —— 区分「接口可用但没做」与「接口不可用所以做不了」。
 *
 * 严格只读：
 *   - 只发 POST 查询，不调用任何写操作（不 restore / 不 share / 不 delete / 不 poweroff）
 *   - 不修改 NAS 任何状态
 *
 * 用法：node tools/probe-unimplemented.cjs
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
        timeout: 12000,
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
  if (!PORT) { console.error("未找到隧道端口"); process.exit(1); }
  const t = await call("/cgi-bin/luci/plugincenter/get_access_token", {});
  try { token = JSON.parse(t.body).data.token || ""; } catch (e) {}
  console.log("urlport:", PORT, "token:", token ? "OK" : "FAIL");
  console.log();

  // 全部为只读查询；参数取自官方客户端代码
  const probes = [
    ["回收站目录", "/cgi-bin/luci/filemgr/get_trashbins", {}],
    ["回收站内容", "/cgi-bin/luci/filemgr/get_trashes", { page: { size: 50, id: 1 } }],
    ["搜索历史", "/cgi-bin/luci/filemgr/get_search_history", {}],
    ["打开历史", "/cgi-bin/luci/filemgr/get_open_history", {}],
    ["共享列表", "/cgi-bin/luci/filemgr/get_shared_list", { page: { size: 50, id: 1 } }],
    ["相册列表", "/cgi-bin/luci/album/list_album", {}],
    ["相册成员", "/cgi-bin/luci/album/list_member", { album_uuid: "1" }],
    ["摄像头列表", "/cgi-bin/luci/ipcmgr/list_record_camera", { did: "" }],
    ["影视库列表", "/cgi-bin/luci/mediacenter/file_list", { page: { size: 20, id: 1 } }],
    ["最近观看", "/cgi-bin/luci/mediacenter/media_recently_watched", {}],
    ["推荐影视", "/cgi-bin/luci/mediacenter/media_recommend", {}],
    ["能力开关", "/cgi-bin/luci/system/get_feature", {}],
    ["电源状态", "/cgi-bin/luci/system/get_power_status", {}],
    ["升级状态", "/cgi-bin/luci/system/get_upgrade_status", {}],
    ["检查更新", "/cgi-bin/luci/system/get_upgrade_check", {}],
    ["保险箱信息", "/cgi-bin/luci/safebox/get_safebox_info", {}],
    ["插件详情", "/cgi-bin/luci/plugincenter/plugin_list", {}],
    ["设备档案", "/cgi-bin/luci/home/get_profile", {}],
    ["UPS 状态", "/cgi-bin/luci/system/get_ups_status", {}],
  ];

  for (const [name, action, body] of probes) {
    const r = await call(action, body);
    let note = r.body.trim().slice(0, 180);
    try {
      const j = JSON.parse(r.body);
      const code = j.code;
      const result = j.result;
      // 用返回体长度和关键字段判断是否真拿到数据
      const hasData = j.data && (Array.isArray(j.data) ? j.data.length : Object.keys(j.data || {}).length) > 0;
      note = `code=${code} result=${result} ${hasData ? "有数据" : "空数据"}`;
    } catch (e) { /* 保持原文 */ }
    console.log(`${String(r.status).padEnd(4)} ${name.padEnd(12)} ${action}`);
    console.log(`     ${note}`);
  }
})();
