# 小米智能存储 · 网页版控制台 (Mijia Web)

> **1:1 逆向复刻** — 基于对小米智能存储官方 Windows 客户端的逆向分析，在浏览器中原样重现米家 App 风格的 NAS 管理控制台。

官方客户端需在后台运行（提供 P2P 隧道、mTLS 证书与动态 WebDAV 凭据），本项目的本地网关据此直连 NAS，让任意现代浏览器获得比官方客户端更完整的存储管理体验：文件浏览、上传下载、视频在线播放与多清晰度切换。

---

## ✨ 核心特性

| 模块 | 说明 |
|------|------|
| **设备状态栏** | 实时 DID 显示、在线状态脉冲指示、内网映射端口、一键刷新 |
| **存储空间仪表盘** | 已用容量取自 NAS 上报值、双盘镜像健康度、Btrfs 文件系统信息 |
| **硬件与链路监控** | 处理器型号与内存规格、2.5GbE 链路、端到端 RTT 延迟 SVG 波形图 |
| **应用九宫格** | 动态拉取 NAS 插件列表（相册/文件/影视/保险箱/迅雷/百度网盘等），原厂图标代理缓存 |
| **全功能文件管理器** | 真实目录逐层钻取、面包屑导航、关键词过滤、网格/列表双视图、分类统计 |
| **文件上传下载** | 通过 WebDAV 通道上传（带进度条）、下载、新建文件夹、删除，完整支持中文文件名 |
| **视频在线播放** | Video.js 播放器，HTTP 206 拖拽快进；清晰度档位来自 NAS 转码接口，取不到时仅提供原画 |
| **文档在线预览** | PDF 原生渲染、文本/代码/配置文件阅读、音频播放、未知格式回退下载 |
| **影视墙弹窗** | 通过 `webPort` 直连官方 `mediacenter` 插件页面，可全屏嵌入播放 |
| **mTLS 隧道网关** | 自动读取 `%LOCALAPPDATA%\minasCert\` 证书，只读探测活跃 P2P 端口，自动换取 Access Token |
| **动态凭据读取** | 自动从客户端运行时数据提取轮换的 WebDAV 用户名/密码，无需手工配置 |

> **关于"哪些数据是真实的"**：官方 LuCI **没有**开放 CPU 占用率、内存占用率、硬盘温度、风扇转速、离线下载队列、Samba/休眠策略等接口（`/cgi-bin/luci/home/get_profile` 恒定返回 `1003 参数错误`）。因此本项目**不展示这些数值**——相关位置会明确标注"未上报 / 官方 API 未开放"，而不是填入看起来合理的假数字。已用容量、文件列表、缩略图、插件列表、转码清晰度均来自 NAS 真实返回；总容量与内存规格需在 `server/gateway.js` 顶部的 `HARDWARE` 常量中按你的实际设备声明。

---

## 🏗️ 架构原理（逆向还原）

```
[浏览器: Vue 3 仿米家 UI]
        │  fetch /api/*  与  /api/upload | /api/download
        ▼
[本地网关: Node.js 原生 HTTP 服务 (127.0.0.1:8090)]
        │  ① 读取 %LOCALAPPDATA%\minasCert\ → cert/key/ca + DID
        │  ② netstat + TLS 握手 → 识别活跃端口 (urlport / webdavport / webport)
        │  ③ POST /cgi-bin/luci/plugincenter/get_access_token → Token
        │  ④ 读客户端运行时数据 → WebDAV 动态凭据 (username / password / alias_root)
        ▼
[小米智能存储.exe P2P 隧道] ──mTLS──▶ [远端 NAS: OpenWrt + LuCI]
```

**两条数据通道**：

| 通道 | 端口 | 用途 | 认证方式 |
|------|------|------|---------|
| **LuCI API** | `urlport` (base+0) | 文件检索、用户配额、插件列表、转码控制 | mTLS 客户端证书 + Token |
| **WebDAV** | `webdavport` (base+1) | 文件上传、下载、删除、新建目录 | mTLS 客户端证书 + HTTP Basic |

**端口模型**：`urlport`=管理网关（mTLS）、`webdavport`=WebDAV（mTLS）、`webport`=明文 Web、`transcodeport`=转码流、`ipcPort`=监控、`clawPort`=控制通道。网关只读探测，绝不调用破坏性 `p2pinit`。

### 两个关键逆向发现

1. **WebDAV 根路径是 `alias_root`**（形如 `/home/u<UID>`），不是文件系统根。请求路径必须相对于它，传绝对路径会被 Nginx 反爬规则拦截并返回 **451**。
2. **WebDAV 密码每次客户端重启都会轮换**，存在 Electron 渲染进程的 Local Storage（leveldb）里，因此网关运行时读取（5 分钟缓存），不能硬编码。

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
│   ├── gateway.js         # mTLS 握手 / Token / WebDAV 读写 / API 透传 / 磁盘缓存
│   └── cache/             # 缩略图与图标磁盘缓存（自动创建，已 gitignore）
├── tools/                 # 逆向与诊断脚本（只读探测用）
│   └── scan-upload-api.cjs
└── web/                   # Vue 3 + Vite 前端
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.js
        ├── App.vue                        # 主布局与数据编排
        ├── assets/style.css               # 米家设计系统变量
        ├── utils/cache.js                 # IndexedDB 离线缓存
        └── components/
            ├── TopHeader.vue              # 顶部导航/在线状态/刷新
            ├── StorageMeter.vue           # 存储容量仪表盘
            ├── MonitorChart.vue           # 硬件监控 + RTT SVG 波形
            ├── AppGrid.vue                # 应用九宫格
            ├── RecentMedia.vue            # 媒体瀑布流与分类筛选
            ├── FileExplorerModal.vue      # 全功能文件管理器（钻取/上传/下载/删除）
            ├── VideoPlayerModal.vue       # Video.js 播放器（多清晰度切换）
            ├── DocumentViewerModal.vue    # PDF/文本/代码/音频预览
            └── MediaCenterModal.vue       # 官方影视墙 iframe 弹窗
```

---

## 🔌 API 接口（网关本地透传）

### 只读接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 穿透链路状态、DID、活跃端口、数据根目录、Token 就绪标志 |
| `/api/system` | GET | 处理器型号/核心数/内存规格（**运行时占用率恒为 null**，官方无此接口） |
| `/api/users` | GET | 管理员 UID、已用容量、配额（`/cgi-bin/luci/usermanager/user_list`） |
| `/api/apps` | GET | 已安装插件与应用列表（`/cgi-bin/luci/plugincenter/get_app_list`） |
| `/api/files` | GET | 文件检索与目录钻取（`?parent=<绝对路径>` 列出子目录） |
| `/api/stream` | GET | 视频/大文件流式传输（Range 透传，支持 206 拖拽快进） |
| `/api/thumbnail` | GET | NAS 缩略图代理（带磁盘缓存） |
| `/api/image` | GET | 应用图标代理（带磁盘缓存） |
| `/api/monitor` | GET | 端到端 RTT 采样（最近 20 次历史；探测失败时如实返回 `status: "error"`，不生成随机值） |

### 读写接口（经 WebDAV 通道）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/upload` | POST | 上传文件（`?parent=<目录>&filename=<文件名>`，请求体为原始字节流） |
| `/api/download` | GET | 下载文件（`?path=<绝对路径>`，带 `Content-Disposition`） |
| `/api/delete` | GET | 删除文件或目录（`?path=<绝对路径>`） |
| `/api/mkdir` | GET | 新建文件夹（`?path=<绝对路径>`） |
| `/api/video/task` | GET | 转码任务生命周期（`?action=create\|resolutions\|destroy`） |

> 所有路径参数均支持中文与特殊字符，网关会做逐段百分号编码后转发给 NAS。

---

## ⚠️ 注意事项

- **必须运行官方客户端**：本项目的所有数据都来自官方客户端建立的 P2P 隧道，客户端未运行时网关无法获取任何 NAS 数据（会优雅降级并给出提示，但不提供模拟数据）。
- **证书安全**：`.gitignore` 已排除 `*.pem`/`*.key`/`*.p12`，请勿将 `%LOCALAPPDATA%\minasCert\` 中的私钥提交到仓库。
- **动态端口**：P2P 端口每次客户端重启都会变化（`urlport`/`webdavport`/`webport` 为连续高位端口），网关会自动重新探测，请勿在代码中硬编码端口号。
- **只读探测**：网关仅通过 TLS 握手识别端口，不会发送 `p2pinit`（该命令会销毁并重建隧道，导致端口跳变、连接中断）。
- **端口冲突**：8090 被占用时网关会给出明确提示，通常是有旧的网关进程未退出。
- **开源许可**：Apache-2.0，仅供学习与个人使用；小米/米家相关商标与素材版权归小米科技所有。

---

## 🙏 致谢

本项目 UI 与交互逻辑基于对 **小米智能存储 Windows 客户端 (SmartStorage 1.0.8.449)** 的逆向分析成果，感谢官方团队的产品设计。
