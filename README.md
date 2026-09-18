# 小米智能存储 · 网页版控制台 (Mijia Web)

> **1:1 逆向复刻** — 基于对小米智能存储官方 Windows 客户端的逆向分析，在浏览器中原样重现米家 App 风格的 NAS 管理控制台。

无需安装官方客户端，只要官方客户端在后台运行（提供 P2P 隧道与 mTLS 证书），本项目的本地网关即可直连 NAS 的 LuCI API，让任意现代浏览器获得与官方客户端一致的存储管理体验。

---

## ✨ 核心特性

| 模块 | 说明 |
|------|------|
| **设备状态栏** | 实时 DID 显示、在线/离线脉冲指示、内网映射端口、一键刷新 |
| **存储空间仪表盘** | 已用/总容量精确到 GB、Dual-Backup 双盘镜像健康度、Btrfs 文件系统信息 |
| **硬件与链路监控** | CPU 使用率/温度、RAM 占用、2.5GbE 链路状态、RTT 延迟 SVG 波形图 |
| **应用九宫格** | 动态拉取 NAS 插件列表（相册/文件/影视/保险箱/迅雷/百度网盘等），支持原厂图标代理缓存 |
| **最近媒体流** | 全盘文件检索（`/cgi-bin/luci/filemgr/search`），照片/视频/文档分类筛选，真实缩略图代理 |
| **影视墙弹窗** | 通过 `webPort` 直连官方 `mediacenter` 插件页面，可全屏嵌入播放 |
| **mTLS 隧道网关** | 自动读取 `%LOCALAPPDATA%\minasCert\` 证书，只读探测活跃 P2P 端口，自动换取 Access Token |
| **离线高速模式** | 客户端未启动时自动降级为高保真演示数据 + IndexedDB/Disk 二级缓存，启动后无缝切回真实数据 |

---

## 🏗️ 架构原理（逆向还原）

```
[浏览器: Vue 3 仿米家 UI]
        │  fetch /api/*
        ▼
[本地网关: Node.js 原生 HTTP 服务 (127.0.0.1:8090)]
        │  ① 读取 %LOCALAPPDATA%\minasCert\ → cert/key/ca + DID
        │  ② netstat + TLS 握手 → 识别 urlport (mTLS 端口)
        │  ③ POST /cgi-bin/luci/plugincenter/get_access_token → Token
        │  ④ 携带 Cookie: token=... + client cert 调用 LuCI API
        ▼
[小米智能存储.exe P2P 隧道] ──mTLS──▶ [远端 NAS: OpenWrt + LuCI]
```

**端口模型**（来自逆向结论）：`urlport`=管理网关（mTLS）、`webdavport`=WebDAV（mTLS）、`webport`=明文 Web、`transcodeport`=转码流、`ipcPort`=监控、`clawPort`=控制通道。网关只读探测，绝不调用破坏性 `p2pinit`。

---

## 🚀 快速开始

### 前置条件
- Windows 10/11
- Node.js ≥ 18
- 已安装并登录过小米智能存储官方客户端（用于生成 `%LOCALAPPDATA%\minasCert\` 证书与 P2P 隧道）

### 一键启动（推荐）
双击 `start.bat`，然后浏览器打开 [http://127.0.0.1:8090](http://127.0.0.1:8090)。

### 手动启动
```bash
# 启动网关 + 静态托管
cd server
node gateway.js

# 如需前端热重载开发（另开终端）
cd web
npm install
npm run dev   # http://localhost:3000
```

生产构建：`cd web && npm run build`，产物由 `gateway.js` 统一托管。

---

## 📁 目录结构

```
web-test/
├── start.bat              # Windows 一键启动
├── package.json           # 根工作区配置
├── README.md
├── LICENSE                # Apache-2.0
├── .gitignore
├── server/                # 本地中继网关（零外部依赖）
│   ├── package.json
│   ├── gateway.js         # mTLS 握手 / Token 代理 / API 透传 / 磁盘缓存
│   └── cache/             # 缩略图与图标磁盘缓存（自动创建，已 gitignore）
└── web/                   # Vue 3 + Vite 前端
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.js
        ├── App.vue                  # 主布局与数据编排
        ├── assets/style.css         # 米家设计系统变量
        ├── utils/cache.js           # IndexedDB 离线缓存
        └── components/
            ├── TopHeader.vue        # 顶部导航/在线状态/刷新
            ├── StorageMeter.vue     # 存储容量仪表盘
            ├── MonitorChart.vue     # 硬件监控 + RTT SVG 波形
            ├── AppGrid.vue          # 应用九宫格
            ├── RecentMedia.vue      # 媒体瀑布流与分类筛选
            └── MediaCenterModal.vue # 官方影视墙 iframe 弹窗
```

---

## 🔌 API 接口（网关本地透传）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 穿透链路状态、DID、活跃端口、Token 就绪标志 |
| `/api/system` | GET | CPU/内存/硬件型号/运行时间/存储池（NAS 离线时返回高保真模拟数据） |
| `/api/users` | GET | 管理员 UID、已用/总容量、配额（`/cgi-bin/luci/usermanager/user_list`） |
| `/api/apps` | GET | 已安装插件与应用列表（`/cgi-bin/luci/plugincenter/get_app_list`） |
| `/api/files` | GET | 全盘文件/相册检索（`/cgi-bin/luci/filemgr/search`） |
| `/api/thumbnail` | GET | NAS 缩略图代理（`/cgi-bin/luci/filemgr/get_thumbnail`，带磁盘缓存） |
| `/api/image` | GET | 应用图标代理（带磁盘缓存） |
| `/api/monitor` | GET | 端到端 RTT 采样（最近 20 次历史） |

---

## ⚠️ 注意事项

- **证书安全**：`.gitignore` 已排除 `*.pem`/`*.key`/`*.p12`，请勿将 `%LOCALAPPDATA%\minasCert\` 中的私钥提交到仓库。
- **只读探测**：网关仅做 TLS 握手识别端口，不会发送 `p2pinit`（该命令会销毁并重建隧道导致端口跳变）。
- **离线模式**：未检测到官方客户端进程时，网关自动进入演示模式，前端显示高保真模拟数据与本地缓存内容。
- **开源许可**：Apache-2.0，仅供学习与个人使用；小米/米家相关商标与素材版权归小米科技所有。

---

## 🙏 致谢

本项目 UI 与交互逻辑基于对 **小米智能存储 Windows 客户端 (SmartStorage 1.0.8.449)** 的逆向分析成果，感谢官方团队的产品设计。
