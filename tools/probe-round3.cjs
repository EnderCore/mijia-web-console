/**
 * 只读探测（第三轮）：验证参数形状细节。
 *  - get_detail_info: path 是字符串还是数组？
 *  - info_album: uuid 还是 album_uuid？
 *  - album/list_member: 相册照片分页参数
 *  - get_shared_user / subtitle_get_list 形状
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

function dump(name, r, maxLen = 1400) {
  let body = r.body;
  try { body = JSON.stringify(JSON.parse(r.body), null, 1); } catch (e) {}
  console.log(`--- ${name} (HTTP ${r.status})`);
  console.log(body.slice(0, maxLen) + (body.length > maxLen ? " …[截断]" : ""));
  console.log();
}

(async () => {
  if (!PORT) { console.error("未找到隧道端口"); process.exit(1); }
  const t = await call("/cgi-bin/luci/plugincenter/get_access_token", {});
  token = JSON.parse(t.body).data.token;

  const P = "/home/u2912935973/pool0/data/我的照片/IMG_20260213_155622_708.jpg";

  dump("detail path=string", await call("/cgi-bin/luci/filemgr/get_detail_info", { path: P }), 900);
  dump("detail path=[string]", await call("/cgi-bin/luci/filemgr/get_detail_info", { path: [P] }), 1200);
  dump("detail paths=[string]", await call("/cgi-bin/luci/filemgr/get_detail_info", { paths: [P] }), 400);

  dump("info_album uuid", await call("/cgi-bin/luci/album/info_album", { uuid: "1" }), 1200);
  dump("list_member uuid=1 count=5", await call("/cgi-bin/luci/album/list_member", { uuid: "1", count: 5 }), 1500);

  // 字幕：先找一部视频文件
  const vs = await call("/cgi-bin/luci/filemgr/search", {
    keyword: "", type: "video", page: { size: 5, token: "" },
  });
  dump("search video", vs, 900);
  let videoPath = "";
  try {
    const files = JSON.parse(vs.body).data.files || [];
    const f = files[0];
    videoPath = f ? (f.parent ? `${f.parent}/${f.name}` : f.path) : "";
  } catch (e) {}
  console.log("videoPath:", videoPath, "\n");
  if (videoPath) {
    dump("subtitle_get_list file_path", await call("/cgi-bin/luci/player/subtitle_get_list", { file_path: videoPath }), 900);
    dump("subtitle_get_list path", await call("/cgi-bin/luci/player/subtitle_get_list", { path: videoPath }), 500);
  }

  // 搜索历史返回结构
  dump("get_search_history", await call("/cgi-bin/luci/filemgr/get_search_history", {}), 800);
})();
