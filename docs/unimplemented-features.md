# 官方 App 功能 vs 网页版实现：未实现功能清单

逆向来源：`app.asar.unpacked/public/dist/` 下 17 个页面目录的全部 JS bundle
（`reqCommonDeal`/`luci` 路径字面量逐文件提取），与 `server/gateway.js` +
`web/src/` 现有实现逐项对照。日期：2026-09-20。

---

## 一、已实现（对照确认）

| 功能 | 网页版入口 | 数据来源 |
|------|-----------|---------|
| 文件浏览 / 全盘搜索 | 文件管理器 | `filemgr/search` |
| 上传 / 下载 / 删除 / 建目录 | 文件管理器 | WebDAV `PUT/GET/DELETE/MKCOL` |
| 缩略图 | 文件管理器 | WebDAV 原图 + 本地缓存 |
| 视频播放 / 转码清晰度 | 视频弹窗 | `player/transcode_*` |
| 任务中心（进度 / 速率 / 历史） | 任务中心面板 | `taskcenter/get_taskinfo` + `get_task_status` |
| 硬件监控（CPU / 风扇 / 硬盘 / 网络 / UPS） | 监控图表 | `get_device_status` + `get_storage_info` + `get_pool_info` + `get_system_version` |
| 插件列表与图标 | 功能中心 | `plugincenter/get_app_list` |
| 影视墙 | iframe | `/plugin/*` 网关代理（urlport + token 注入） |
| 用户列表（只读） | 用户管理弹窗 | `usermanager/user_list` |
| 敏感信息脱敏 | 顶栏开关 | 前端 `utils/privacy.js` |

---

## 二、未实现 —— 只读接口，可直接补做

这组全部是查询接口，与现有「只读探测」约束不冲突，补网关转发即可。

| 官方功能 | 接口 | 说明 |
|---------|------|------|
| ~~回收站浏览~~ | `filemgr/get_trashes`、`get_trashbins` | **本机不可达**：`get_trashbins` 返回空、`get_trashes` 固定 5000（探测于 2026-09-20） |
| **文件详情面板** | `filemgr/get_detail_info` | **已实现**：`path` 必须是**数组** `{path:["/abs/path"]}` |
| **最近打开** | `filemgr/get_open_history` | **已实现**：返回 `data.files[]`，含 access_time/name/parent/size |
| **搜索历史** | `filemgr/get_search_history` | **已实现**（经 /api/query 转发，本机返回空数组） |
| **共享列表** | `filemgr/get_shared_list`、`get_shared_user` | **已实现**（经 /api/query 转发）：须带 `myshare:true,share2me:true` |
| **相册浏览** | `album/list_album`、`album/list_member`、`album/info_album` | **已实现**：`list_album {}`→`data.albums[]`；`list_member {uuid,count,offset}`→`data.photos[]`；`info_album {uuid}`→`data.album` |
| **OCR 文字识别** | `filemgr/get_ocr` | 已加入 /api/query 白名单（未实测调用参数） |
| **字幕查询** | `player/subtitle_get_list`、`subtitle_search_online` | **已实现**：参数是 `video_path`（不是 `file_path`/`path`） |
| **系统能力开关** | `system/get_feature` | **已实现**：返回 `data.<module>.features.<key>.enable`，前端据此显示能力 |
| **电源状态** | `system/get_power_status` | **已实现**：`data.power` = `"on"` |
| **固件升级状态** | `system/get_upgrade_check`、`get_upgrade_status`、`get_upgrade_history` | **已实现**（经 /api/query 转发） |
| **SMB 信息** | `netshare/get_samba_info`、`get_samba_account` | **已实现**：`data.name/SMBv1/ip`、`data.account[]` |
| **保险箱信息** | `safebox/get_safebox_info` | **已实现**（经 /api/query 转发） |
| **同步空间** | `syncSpace/home`、`syncSpace/detail`、`syncSpace/index` | 未接入（优先级低） |
| **摄像头列表** | `ipcmgr/list_record_camera`、`check_if_oauth` | **本机不可达**：5000 dbus 失败 |
| **影视数据接口** | `mediacenter/file_list`、`media_recommend`、`media_recently_watched` | `file_list`/`media_recommend` 返回 2200（无影视库数据）；`media_recently_watched` 已加入白名单 |
| **通知列表** | MQTT `noticeList` 推送 + `notice/src` 页面 | 需要 MQTT 通道，见第四节 |

---

## 三、未实现 —— 写操作（按当前约束不做）

以下均会修改 NAS 状态，与「任何对 NAS 的操作都要优先问」的约束冲突，
仅列出备查；如以后要做需逐条征得同意。

| 功能组 | 接口 |
|--------|------|
| 文件复制 / 移动 / 重命名 | `filemgr/copy`、`move`；重命名走 WebDAV `MOVE` |
| 压缩 / 解压 | `filemgr/compress`、`decompress` |
| 收藏 / 取消收藏 | `filemgr/favorite`、`unfavorite` |
| 文件共享管理 | `filemgr/share`、`unshare`、`add_shared`、`add_shared_user`、`edit_shared_directory`、`edit_shared_user`、`cancel_shared`、`cancel_shared_user`、`quit_shared` |
| 回收站操作 | `filemgr/move2trashbin`、`restore_trash`、`restore_trash_to`、`remove_trash` |
| 双盘备份 | `filemgr/enable_dual_backup`、`disable_dual_backup` |
| 相册管理 | `album/new_album`、`del_album`、`rename_album`、`add_member`、`del_member`、`member_update`、`set_album_cover`、`set_album_attr`、`set_album_source`、`del_photo`、`share_album`、`hide_album`、`confirm_member`、`ref_album` |
| 用户管理 | `usermanager/active_user`、`deactive_user`、`set_nickname`、`set_space_limit`、`delete_user` |
| SMB 配置 | `netshare/add_samba_account`、`del_samba_account`、`set_samba_account`、`set_samba_mode`、`set_samba_status`、`judge_samba_account` |
| 保险箱全生命周期 | `safebox/init_safebox`、`set_safebox_pwd`、`unlock_safebox`、`lock_safebox`、`renew_lock_time`、`check_safebox_task`、`reset_safebox`、`verify_xiaomi_account` |
| 任务控制 | `taskcenter/ctrl_task`（暂停/继续/取消）、`delete_history` |
| 插件管理 | `plugincenter/plugin_control`（install/uninstall/upgrade/info/update）、`plugin_set_config`（自动升级开关） |
| 系统控制 | `system/nas_power`（关机/重启）、`set_fan_mode`（本机 `fan_mode:0` 不生效）、`set_auto_upgrade`、`nas_upgrade` |
| 存储池变更 | `storage/modifypool` |
| 历史记录清理 | `filemgr/add_open_history`、`del_open_history`、`clean_search_history` |
| 观看进度上报 | `mediacenter/file_update_last_seen` |
| 字幕添加 / 删除 | `player/subtitle_add_online`、`subtitle_add_local`、`subtitle_delete` |
| 日志上传 | `helpercenter/upload_log` |

---

## 四、未实现 —— 通道/平台级

| 功能 | 现状 | 说明 |
|------|------|------|
| **MQTT 实时推送** | 未接入 | 官方连 `wss://` 收 `usbinfo/update`、`meminfo/update`、`noticeList`、相册/保险箱/插件变更等十余种事件。网页版目前全靠轮询。接入后「磁盘将满」「任务完成」等可实时弹通知 |
| **迅雷下载** | 未实现 | `get_feature` 显示 `plugin_xunlei:1`。客户端有独立 `xunleiProject/` 渲染页；也可尝试像影视墙一样 `/plugin/<uid>/xunlei/` 代理（待验证插件是否带 Web 前端） |
| **托盘窗口** | N/A | Windows 桌面专属，网页版无对应物 |
| **帮助中心** | 未实现 | 走云端 `nas/help/articles` 接口，不是 NAS LuCI；且内容在线，价值低 |
| **内存信息** | 半实现 | 只有 MQTT `meminfo/update` 推送，无 HTTP 查询接口；接了 MQTT 才能显示 |

---

## 五、建议优先级（2026-09-20 第二轮执行结果）

已完成（全部经新增的 `/api/query` 白名单转发实现，只读）：

1. ~~回收站浏览~~ —— **跳过**：`get_trashes` 本机固定 5000、`get_trashbins` 空数据，接口不可达。
2. **相册真实数据** —— **已实现**：`list_album`（68 个相册）+ `list_member` 分页照片。
3. **`get_feature` 能力开关** —— **已实现**：系统设置弹窗展示电源/SMB/风扇/迅雷能力。
4. **文件详情 / 最近打开** —— **已实现**：文件管理器卡片/表格新增 ℹ️ 详情与「最近打开」入口。
5. **字幕查询** —— **已实现**：视频播放器顶栏字幕下拉（`video_path` 参数）。
6. **MQTT 通道** —— 未做，建议作为独立任务。

本轮跳过的写操作（见第三节）一律未实现，仅 `filemgr/get_ocr` 等查询接口加入白名单备用。
