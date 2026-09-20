# 小米智能存储：官方接口与可获取数据清单

本文档回答一个问题：**官方 App 和它的本地隧道接口，到底能拿到哪些数据？**

所有结论都是从官方客户端实际代码里还原出来的，不是推测。还原方法见文末。
标注为「未开放」的项，意思是官方客户端**自己也没有**对应的调用——不是我们没找到，
而是这个能力在官方 API 层面不存在。

---

## 一、两条数据通道

| 通道 | 端口 | 协议 | 认证 | 用途 |
|------|------|------|------|------|
| **LuCI API** | `urlport` (base+0) | HTTPS + POST JSON | mTLS 客户端证书 + `token` Cookie/Header | 目录检索、用户配额、插件列表、转码、字幕 |
| **WebDAV** | `webdavport` (base+1) | HTTPS | mTLS + HTTP Basic（动态轮换） | 上传、下载、重命名、建目录 |

LuCI 请求的基准 URL 由 `getBaseUrl()` 拼出：`https://127.0.0.1:<urlport>/cgi-bin/luci`。
所有接口均为 **POST**，必须带 `Content-Type: application/json`（否则 `1010`），
缺必填字段返回 `1002`，字段格式不对返回 `1003`，用 GET 调用返回 `1009`。

---

## 二、LuCI 接口全清单（已从客户端代码还原）

### 2.1 目录与文件检索

| 接口 | 请求体 | 返回 |
|------|--------|------|
| `/cgi-bin/luci/filemgr/search` | 列目录：`{type:"directory", page:{size:500,token:""}, options:{option:["path"], path:{parent:"<绝对路径>", recursion:false}}, show_dotfile:false}`<br>关键词搜索：`{keyword:"<词>", type:"all", page:{size:200,token:""}}` | `data.files[]` |
| `/cgi-bin/luci/filemgr/list_directory` | `{page:{size,token}}` | `files[]`（同步模块用） |
| `/cgi-bin/luci/filemgr/xxHashsum` | 路径参数 | 文件 XXHash（断点续传校验） |

`files[]` 每项字段：`name`、`parent`、`path`、`size`（字节）、`modified_time`（毫秒时间戳）、
`xattr.directory`（true 表示是目录）、`isdir`、`hash`。

> 注意 `type` 取 `"directory"` 时是「列出某目录下的内容」，取 `"all"` 时是「全盘关键词搜索」，
> 两种语义不要混用。

### 2.2 缩略图能力探测

| 接口 | 请求体 | 返回 |
|------|--------|------|
| `/cgi-bin/luci/filemgr/get_thumbnail_config` | `{}` | 支持的图片/视频扩展名与三档尺寸规格 |

尺寸档位：`small` (150×200)、`medium`、`big` (600×800)、`preview` (1080×1920)。

> **重要**：官方客户端**没有**用 LuCI 接口去取缩略图。它的做法是
> `downloadThumbnail.js` 通过 **WebDAV 下载原图**，再用 `heic-convert` 本地转换、按档位缩放，
> 然后由 `localServer.js` 在 `http://127.0.0.1:<本地端口>` 上把结果以 `image/jpeg` 提供出去。
> 也就是说「生成缩略图」这件事发生在客户端本机，不在 NAS 上。

### 2.3 用户与配额

| 接口 | 请求体 | 返回 |
|------|--------|------|
| `/cgi-bin/luci/usermanager/user_list` | `{}` | 用户列表、UID、`used_size` |
| `/cgi-bin/luci/usermanager/deactive_user` | — | 注销用户（客户端登录流程用） |

### 2.4 插件与应用

| 接口 | 请求体 | 返回 |
|------|--------|------|
| `/cgi-bin/luci/plugincenter/get_app_list` | `{}` | 已安装插件列表，含各插件真实 URL（如影视墙 `mediacenter`） |
| `/cgi-bin/luci/plugincenter/get_access_token` | `{}` | Access Token（后续所有调用的凭据） |

### 2.5 播放与转码

| 接口 | 请求体 | 返回 |
|------|--------|------|
| `/cgi-bin/luci/player/transcode_create_task` | `{}`（**官方不带参数**） | `data.data.task_id` |
| `/cgi-bin/luci/player/transcode_switchable` | `{task_id, file_path}` | `data.data.switchable`（能否切换清晰度） |
| `/cgi-bin/luci/player/transcode_get_resolution` | `{task_id, file_path}` | `data.data.resolution_list[]` |
| `/cgi-bin/luci/player/transcode_destroy_task` | `{task_id}` | 释放转码资源 |

清晰度列表的结构是嵌套的：

```
data.data.resolution_list[]
        └── url_list[]
                └── m3u8_url      ← 真正的播放地址
```

客户端拿到后会**剥掉 `m3u8_url` 的前缀路径**（只保留最后几段），再交给播放器。
字段名是 `resolution_list` / `url_list` / `m3u8_url`，不是 `resolutions` 或 `url`。

### 2.6 字幕

| 接口 | 请求体 |
|------|--------|
| `/cgi-bin/luci/player/subtitle_get_list` | `{video_path}` |
| `/cgi-bin/luci/player/subtitle_search_online` | `{keyword, video_path}` |
| `/cgi-bin/luci/player/subtitle_add_online` | `{keyword, index, video_path}` |
| `/cgi-bin/luci/player/subtitle_add_local` | `{subtitle_path, video_path}` |
| `/cgi-bin/luci/player/subtitle_delete` | `{video_path, index}` |

返回字段：`subtitle_list[]`（各项含 `subtitle_path`、`index`）。

### 2.7 影视记录

| 接口 | 请求体 |
|------|--------|
| `/mediacenter/file_update_last_seen` | 更新「最近观看」进度 |

---

## 三、WebDAV 通道

根路径是 `alias_root`（形如 `/home/u<UID>`），**不是文件系统根**。
传绝对路径会被 Nginx 拦下返回 **451**（反爬规则：裸根路径或纯 IP Host 直接拒）。

| 方法 | 用途 | 证据 |
|------|------|------|
| `GET` | 下载 / 取文件头（`getFileHeaderContent`） | `download.js`、`webDav.js` |
| `PUT` | 上传（支持 `Content-Range` 断点续传） | `upload.js` |
| `MOVE` | 重命名（`fileRenametransmit`） | `upload.js` |
| `MKCOL` | 新建目录（`createDirectory`） | `webDav.js` |
| `DELETE` | 删除 | 标准 WebDAV |

上传流程的几个关键点（`upload.js` 还原）：

1. 先 `GET` 文件头拿已上传长度，实现断点续传。
2. 请求 XXHash 校验，客户端本地也算一份，不一致会重传。
3. 上传到**临时文件**，全部完成后用 `MOVE` 改名到目标路径。
4. 过程中如果 WebDAV 密码轮换（每次客户端重启都会变），会重试。

> **注意**：`PROPFIND` 在还原结果里**没有出现**。官方不靠 PROPFIND 列目录，
> 列目录走 LuCI 的 `filemgr/search`。所以本项目的网关也不该假设 WebDAV 支持 PROPFIND。

---

## 四、明确「未开放」的数据

以下项目在官方客户端**四万多个字符串里一次都没出现**，属于官方 API 层面不存在：
官方 App 自己也是不显示的。

| 数据 | 状态 | 说明 |
|------|------|------|
| CPU 使用率 / 核心占用 | **未开放** | `home/get_profile` 恒定返回 `1003 参数错误`，客户端只是尝试性调用后放弃 |
| 内存占用率 | **未开放** | 同上 |
| 硬盘温度 / 风扇转速 | **未开放** | 无任何对应接口 |
| 单块硬盘型号 / SMART | **未开放** | 无对应接口 |
| 存储池总容量 | **未上报** | `user_list` 通常只给 `used_size`，`total_size` 为 0 |
| 离线下载 / 同步任务队列 | **未开放** | 无查询接口 |
| Samba / NFS / 休眠策略读写 | **未开放** | 无接口 |
| 保险箱文件索引 | **未开放** | 无接口 |
| 系统日志 / 固件版本查询 | **未开放** | 无接口 |

关于 `home/get_profile`：客户端确实会调它，但把它当作「有则用之、无则忽略」的可选信息，
并不依赖其返回值。实测它稳定返回 `1003`，所以**不能**把它当作硬件信息来源。

---

## 五、还原方法（可复现）

官方客户端 JS 使用 `javascript-obfuscator` 的字符串数组 + 带密钥 RC4 混淆：

```
表项 = base64( 百分号编码( RC4 密文 ) )
解码 = base64解 → 百分号解 → RC4解 → 百分号解
调用 = _0xEFBE2A(0x186, 'sQaS')
```

三个容易踩的坑：

1. **文件顶部的 IIFE 会旋转字符串表**（`push(shift())` 直到校验和匹配）。
   跳过它，所有索引都会偏移，解出来全是乱码。必须整个文件一起执行。
2. **密钥写在每个函数自己的对象字面量里**。同一个属性名
   （如 `_0x152262`）在不同函数中代表不同字符串，用全局映射会得到乱码，
   必须按「离调用点最近的那个对象字面量」解析。
3. **索引既可能是字面量也可能是属性引用**：`decode(0x183,'#)%s')` 与
   `decode(_0xV._0xI, _0xV._0xK)` 两种形态都存在。只匹配字面量会漏掉
   `transcode_create_task` 这类接口。

工具（均只读，不触网、不写文件、不修改源文件）：

- `tools/dump-player-endpoints.cjs` —— 还原单个文件的全部字符串
- `tools/dump-player-by-function.cjs` —— 按函数名还原（函数名未被混淆的文件适用）
- `tools/scan-client-endpoints.cjs` —— 扫描整个客户端目录，汇总所有接口路径

复现：

```bash
node tools/scan-client-endpoints.cjs "<客户端 electron 目录>"
```

---

## 六、与网页版实现的对照

| 能力 | 网页版实现 | 数据来源 |
|------|-----------|---------|
| 目录浏览 | ✅ 真实 | `filemgr/search` |
| 上传 / 下载 / 删除 / 建目录 | ✅ 真实 | WebDAV |
| 已用容量 | ✅ 真实 | `usermanager/user_list` |
| 总容量 | ⚠️ 估算 | NAS 未上报，按机型规格声明 |
| 插件列表与图标 | ✅ 真实 | `plugincenter/get_app_list` |
| 缩略图 | ✅ 真实（方案不同） | 官方接口未开放生成能力，改为经 WebDAV 取原图 + 本地缓存 |
| 视频播放与清晰度 | ✅ 真实 | `player/transcode_*` |
| CPU / 内存 / 温度 / 风扇 | ❌ 不展示 | 官方 API 未开放，界面标注「未上报」 |
| 任务中心 / 设置 / 保险箱 | ❌ 不展示 | 官方 API 未开放，界面说明原因 |
