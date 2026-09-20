# 小米智能存储：官方 App 功能清单与实现方式

本文档记录**官方 App 到底有哪些功能、每个功能是怎么实现的**，以及哪些数据能拿到。

结论全部来自实际逆向与实机验证，不是推测。数据分三个来源：

| 来源 | 说明 |
|------|------|
| **主进程 JS** | `%LOCALAPPDATA%\Programs\SmartStorage\resources\app.asar` 解包出的 Electron 主进程代码（混淆） |
| **渲染层 UI** | 同目录 `app.asar.unpacked\public\dist\` 下的 Vue 页面（未混淆，可直接读） |
| **实机探测** | 通过官方客户端建立的 P2P 隧道，用客户端证书调 NAS 接口验证（只读） |

---

## 一、架构：三层，不是两层

早期只逆向到前两层，漏了第三层，导致误判"官方没开放硬件接口"。

```
[渲染层 Vue 页面]  app.asar.unpacked/public/dist/<page>/index.html
        │  HTTP（127.0.0.1:<urlport>，mTLS + token）
        ▼
[NAS Web UI 后端]  /cgi-bin/luci/<module>/<action>   ← 硬件/存储/任务/相册都在这层
        │
        ├── 还有一路：MQTT（wss://）推送实时事件
        ▼
[NAS 系统层]  磁盘、风扇、CPU、UPS 等真实硬件
```

**关键区别**：主进程只调用 5 个 LuCI 接口（用户列表、插件列表、Token、缩略图配置、设备档案），
而**渲染层的 Vue 页面调用了另外 40 多个接口**——硬件信息全在这一层。

---

## 二、官方 App 的页面清单

`public/dist/` 下的目录名就是功能清单：

| 目录 | 功能 |
|------|------|
| `file-manager/` | 文件管理（浏览、上传、下载、复制、移动、压缩、收藏） |
| `file-pictures/` | 照片（相册、时光轴、AI 分类） |
| `file-preview/` | 文件预览 |
| `file-taskCenter/` | 任务中心（传输队列） |
| `appCenter/` | 应用中心（插件安装与管理） |
| `sysSetting/` | **系统设置 ← 硬盘信息在这里** |
| `networkneighbor/` | 网络邻居（SMB 等共享协议） |
| `user-manager/` | 用户管理 |
| `safe/` | 保险箱 |
| `recycleBin/` | 回收站 |
| `syncSetting/` | 同步设置 |
| `videoDetail/` | 影视详情（播放、转码、字幕） |
| `notice/` | 通知中心 |
| `xunleiProject/` | 迅雷下载 |
| `tray-win/` | 托盘窗口 |

---

## 三、完整接口清单（已逐条实机验证）

### 3.1 系统与硬件 ← 之前漏掉的关键部分

| 接口 | 请求 | 返回的真实字段 |
|------|------|---------------|
| `system/get_device_status` | `{}` | `cpu.use`(如 `"7%"`)、`cpu.temp`(如 `"53℃"`)、`fan.rpm`、`fan.mode`、`deviceinfo.MAC/SN/model`、`net.ipv4.address/netmask/gateway/DNS`、`net.upload/download`、`disk.totalsize/usedsize/unusedsize/hibernate`、`ups.status/health`、`led.status` |
| `storage/get_storage_info` | `{}` | **每块硬盘**：`dev`(sda/sdb)、`slot`(槽位)、`type`(HDD/SSD)、`model`(如 `WDC WD40EFPX-71C6CN0`)、`serial`、`temperature`、`health`(normal)、`run_time`(通电小时)、`total_size`、`used_size`、`state` |
| `filemgr/get_pool_info` | `{}` | `internal_pool[].total_size/used_size/pool_type/pool_name`、`external_pool[]`、`webDAV` 凭据 |
| `system/get_system_version` | `{}` | `version`(如 `1.0.8.425.F24C26D19-REL`)、`channel`、`autoupgrade` |
| `system/get_feature` | `{}` | 各模块能力开关（backup/ipc/safebox/user 等） |
| `system/get_power_status` | `{}` | `power`: on/off |
| `system/get_upgrade_status` | `{}` | `state`、`progress` |
| `system/set_fan_mode` | 模式 | **写操作**：设置风扇模式 |
| `system/nas_power` | 开关 | **写操作**：关机/重启 |

> `system/get_ups_status` 与 `home/get_profile` 均返回 403/1003，不可用。

### 3.2 文件管理

| 接口 | 用途 |
|------|------|
| `filemgr/search` | 列目录（`type:"directory"` + `options.path.parent`）或全盘搜索（`type:"all"` + `keyword`） |
| `filemgr/list_directory` | 目录列表（同步模块用） |
| `filemgr/get_thumbnail_config` | 支持的图片/视频格式与三档尺寸（small 150×200 / big 600×800 / preview 1080×1920） |
| `filemgr/get_detail_info` | 文件详情 |
| `filemgr/get_open_history` / `add_open_history` | 最近打开记录 |
| `filemgr/get_shared_list` | 共享列表（需参数） |
| `filemgr/xxHashsum` | 文件 XXHash（断点续传校验） |
| `filemgr/copy` / `move` / `remove` | 复制 / 移动 / 删除 |
| `filemgr/compress` / `decompress` | 压缩 / 解压 |
| `filemgr/favorite` / `unfavorite` | 收藏 / 取消收藏 |
| `filemgr/enable_dual_backup` / `disable_dual_backup` | 双盘备份开关 |

**缩略图怎么来的**：官方**没有** LuCI 缩略图接口。
`downloadThumbnail.js` 走 WebDAV 下载原图 → 本机用 `heic-convert` 转换、按档位缩放 →
由 `localServer.js` 在 `http://127.0.0.1:<本地端口>` 以 `image/jpeg` 提供。

### 3.3 相册

| 接口 | 用途 |
|------|------|
| `album/list_album` | 相册列表（含 `photo_count`、`video_count`、封面路径） |
| `album/new_album` / `del_album` / `rename_album` | 新建 / 删除 / 重命名 |
| `album/list_member` | 成员列表 |
| `album/add_member` / `member_update` | 添加成员 / 更新权限 |

### 3.4 用户

| 接口 | 用途 |
|------|------|
| `usermanager/user_list` | 用户列表（`uid`、`used_size`、`permission`；**`total_size` 恒为 0**） |
| `usermanager/active_user` / `deactive_user` | 启用 / 停用 |
| `usermanager/set_nickname` | 改昵称 |
| `usermanager/set_space_limit` | 设置空间配额 |
| `usermanager/delete_user` | 删除用户 |

### 3.5 插件

| 接口 | 用途 |
|------|------|
| `plugincenter/get_access_token` | 换 Token（后续所有调用的凭据） |
| `plugincenter/get_app_list` | 已安装应用列表 |
| `plugincenter/plugin_list` | 插件详情（含前端 URL、端口、版本、大小、热插拔信息） |
| `plugincenter/plugin_control` | **写操作**：启停/安装插件 |

### 3.6 任务中心

| 接口 | 用途 |
|------|------|
| `taskcenter/get_taskinfo` | 任务详情（需参数） |
| `taskcenter/get_task_status` | 任务状态（需参数） |
| `taskcenter/ctrl_task` | **写操作**：暂停/继续/取消任务 |
| `taskcenter/delete_history` | **写操作**：删除历史记录 |

### 3.7 播放与转码

| 接口 | 请求 | 用途 |
|------|------|------|
| `player/transcode_create_task` | `{}`（**官方不带参数**） | 创建转码任务，返回 `task_id` |
| `player/transcode_switchable` | `{task_id, file_path}` | 查能否切清晰度 |
| `player/transcode_get_resolution` | `{task_id, file_path}` | 清晰度列表 |
| `player/transcode_destroy_task` | `{task_id}` | 释放资源 |
| `player/subtitle_get_list` | `{video_path}` | 字幕列表 |
| `player/subtitle_search_online` | `{keyword, video_path}` | 在线搜字幕 |
| `player/subtitle_add_online` | `{keyword, index, video_path}` | 添加在线字幕 |
| `player/subtitle_add_local` | `{subtitle_path, video_path}` | 添加本地字幕 |
| `player/subtitle_delete` | `{video_path, index}` | 删除字幕 |

清晰度结构是嵌套的：

```
data.data.resolution_list[]
        └── url_list[]
                └── m3u8_url      ← 真正的播放地址
```

### 3.8 保险箱

| 接口 | 用途 |
|------|------|
| `safebox/get_safebox_info` | 是否启用、hash_salt |
| `safebox/init_safebox` / `set_safebox_pwd` | 初始化 / 设密码 |
| `safebox/unlock_safebox` / `lock_safebox` / `renew_lock_time` | 解锁 / 上锁 / 续期 |
| `safebox/check_safebox_task` / `reset_safebox` | 任务查询 / 重置 |
| `safebox/verify_xiaomi_account` | 验证小米账号 |

### 3.9 其他

| 接口 | 用途 |
|------|------|
| `ipcmgr/list_record_camera` | 摄像头列表（需 did） |
| `ipcmgr/check_if_oauth` | 授权检查 |
| `mediacenter/file_update_last_seen` | 更新影视观看进度 |
| `helpercenter/upload_log` | 上传日志 |

---

## 四、MQTT 实时推送

除 HTTP 请求外，客户端还连一个 MQTT 服务（`wss://`）接收实时事件。
固定主题只有两个，定义在 `config.default.js`：

| 主题 | 内容 |
|------|------|
| `/sys/nas/alluser/usbinfo/update` | USB / 磁盘插拔与容量变化 |
| `/sys/nas/alluser/meminfo/update` | 内存信息 |

派发到渲染层的 IPC 事件（`controller/mqtt/*`）：

```
diskFullNotification        磁盘将满
usbInfoNotification         USB 变化
fileMgrNotification         文件系统变化
pictureNotification         照片变化
pluginNotification          插件变化
safeboxNotification         保险箱变化
ipcDeleteNotification       摄像头录像删除
newAlbum / deleteAlbum / renameAlbum   相册变化
noticeList                  通知列表
homepageHandlerNotification 首页刷新
```

MQTT 消息原样透传给渲染层，**字段名由 NAS 决定**——逆向时无法从客户端代码确定，
需要实际订阅一次才能看到完整结构。

---

## 五、WebDAV 通道

根路径是 `alias_root`（形如 `/home/u<UID>`），**不是文件系统根**。
传绝对路径会被 Nginx 拦下返回 **451**。

| 方法 | 用途 | 证据 |
|------|------|------|
| `GET` | 下载 / 取文件头（断点续传） | `download.js`、`webDav.js` |
| `PUT` | 上传（支持 `Content-Range`） | `upload.js` |
| `MOVE` | 重命名（`fileRenametransmit`） | `upload.js` |
| `MKCOL` | 新建目录（`createDirectory`） | `webDav.js` |
| `DELETE` | 删除 | 标准 WebDAV |

上传流程（`upload.js` 还原）：

1. 先 `GET` 文件头拿已上传长度 → 断点续传
2. 请求 XXHash 校验，本地也算一份，不一致重传
3. 上传到**临时文件**，完成后用 `MOVE` 改名到目标
4. WebDAV 密码轮换（每次客户端重启都变）时自动重试

> `PROPFIND` 在还原结果里**没有出现**。官方不靠 PROPFIND 列目录，列目录走 `filemgr/search`。

---

## 六、明确拿不到的

| 数据 | 状态 | 说明 |
|------|------|------|
| 内存总量 / 占用率 | **未开放** | 只有 `meminfo/update` 这个 MQTT 主题，但无 HTTP 查询接口 |
| CPU 型号 | **未开放** | 只有占用率与温度，没有型号字符串 |
| 硬盘 SMART 详细属性 | **未开放** | 只有 `health`(normal) 与温度，没有坏道/重映射计数 |
| 风扇目标转速 | **未开放** | 只有当前 `rpm` 与 `mode`，不能读目标曲线（可写 `set_fan_mode`） |
| `home/get_profile` | **不可用** | 恒定返回 `1003 参数错误`，客户端自身也不用它 |
| `system/get_ups_status` | **不可用** | 返回 403（UPS 状态在 `get_device_status.ups` 里） |

---

## 七、与网页版实现的对照

| 能力 | 网页版 | 数据来源 |
|------|--------|---------|
| 目录浏览 | ✅ 真实 | `filemgr/search` |
| 上传 / 下载 / 删除 / 建目录 | ✅ 真实 | WebDAV |
| 已用容量 / 总容量 | ✅ 真实 | `filemgr/get_pool_info` + `usermanager/user_list` |
| **每块硬盘型号 / 序列号 / 温度 / 健康 / 通电时长** | ✅ **真实** | `storage/get_storage_info` |
| **CPU 占用 / 温度** | ✅ **真实** | `system/get_device_status` |
| **风扇转速 / 模式 / UPS / 实时速率 / IP / MAC** | ✅ **真实** | `system/get_device_status` |
| **固件版本 / 机型 / 序列号** | ✅ **真实** | `get_device_status` + `get_system_version` |
| 插件列表与图标 | ✅ 真实 | `plugincenter/get_app_list` |
| 缩略图 | ✅ 真实（方案不同） | 经 WebDAV 取原图 + 本地缓存 |
| 视频播放与清晰度 | ✅ 真实 | `player/transcode_*` |
| 内存占用率 / CPU 型号 | ❌ 不展示 | 官方 API 未开放 |
| 任务中心 / 风扇设置 / 保险箱 | ❌ 不展示 | 只读查询接口需参数或属写操作，网页版不做 |

---

## 八、逆向方法（可复现）

### 8.1 主进程 JS（混淆）

`javascript-obfuscator` 的字符串数组 + 带密钥 RC4：

```
表项 = base64( 百分号编码( RC4 密文 ) )
调用 = _0xEFBE2A(0x186, 'sQaS')
```

三个必须注意的点：

1. **文件顶部的 IIFE 会旋转字符串表**（`push(shift())` 直到校验和匹配）。
   跳过它，所有索引都会偏移，解出来全是乱码。必须整个文件一起执行。
2. **密钥写在各函数自己的对象字面量里**。同名属性在不同函数代表不同字符串，
   用全局映射会得到乱码，必须按「离调用点最近的对象字面量」解析。
3. **索引既可能是字面量也可能是属性引用**。只匹配字面量会漏掉
   `transcode_create_task` 这类接口。

工具：

- `tools/dump-all-client-strings.cjs` — 还原所有 JS 的字符串表
- `tools/scan-client-endpoints.cjs` — 汇总所有接口路径
- `tools/dump-player-by-function.cjs` — 按函数名还原（函数名未混淆的文件）

### 8.2 渲染层 UI（未混淆，直接读）

这是**最重要的一步**，之前的分析漏了它。文件在
`app.asar.unpacked/public/dist/`，是标准 ES module，可直接 grep：

```bash
grep -rhoE "cgi-bin/luci/[a-zA-Z0-9_/]*" \
  "$LOCALAPPDATA/Programs/SmartStorage/resources/app.asar.unpacked/public/dist" | sort -u
```

> asar 头部结构：`[0-3]=4`、`[4-7]=pickle 大小`、`[8-11]`、
> `[12-15]=JSON 精确长度`，JSON 从偏移 16 开始，文件内容从 `16+jsonSize` 开始。
> 标了 `unpacked: true` 的文件在 asar 外的同名目录里，不在归档中。

### 8.3 实机验证（只读）

```bash
node tools/probe-nas-capabilities.cjs   # 探测接口是否存在
node tools/probe-nas-webui.cjs          # 探测 Web 端口页面
```

两个脚本都只发 POST 查询 / HTTP GET，不调用任何写操作，不写 NAS 数据。
