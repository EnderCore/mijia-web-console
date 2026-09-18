# OpenList 集成配置说明

OpenList (原 AList 社区分支) 可以作为小米智能存储的高级 Web 文件管理器挂载运行。

## 1. 下载 OpenList 二进制
从官方 Releases 页面下载 Windows amd64 压缩包：
https://github.com/OpenListTeam/OpenList/releases

解压得到 `openlist.exe` 并放置于当前 `openlist/` 目录下。

## 2. 挂载小米智能存储
启动本项目的 `start.bat` 后，网关将在本地映射活跃的 WebDAV 穿透通道：
- 协议: WebDAV
- 地址: `https://127.0.0.1:51832` (注意：该端口直接由官方客户端 mTLS 保护)
- 或者在 web 控制台中直接使用内置的高性能文件管理器 (已预装)，它直接对接 NAS 底层 Btrfs 检索与 Range 流媒体引擎。

## 3. 运行 OpenList
双击运行 `start-openlist.bat` 即可在 `http://127.0.0.1:5244` 访问。
