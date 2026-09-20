# MQTT 实时推送通道：实现评估与分步计划

> 日期：2026-09-20。约束：不得以任何形式写入或影响 NAS；所有联调测试由用户手动执行。
> 本文只涉及只读订阅（subscribe），网关永不 publish。

## 一、已逆向确认的事实

来源：`app.asar.unpacked/public/dist/assets/layout-ve9Zk-di.js`（渲染层）+
`extracted/app-asar/public/electron/service/mqttService/mqttService.js`（主进程，解混淆）+
`config.default.js`。

### 1.1 连接参数（官方客户端的完整形状）

渲染层调用：

```js
connectMqtt({ ip, port, uid, deviceId, token })
// 实际取值：ip = store.baseIp（P2P 即 127.0.0.1）
//          port = store.baseport（即我们说的 urlport，当前 51831）
//          uid = loginInfo.uid（2912935973）
//          deviceId = did（1181294988）
//          token = accessToken（与 LuCI 同一个 token）
```

主进程 `MqttService` 组装的真实 mqtt.js options：

```js
{
  clientId: 'dev-' + deviceUid,          // deviceUid 来自 deviceIdService（本机 GUID）
  port: <urlport>,                        // 与 LuCI 同端口，不是 config 里的 0x1bb
  username: '<uid>_' + <deviceUid>,      // 例如 "2912935973_dev-xxxx"
  password: <accessToken>,               // LuCI access token
  protocol: 'wss',                        // mqtt.connect('wss://127.0.0.1:<port>')
  wsOptions: {                            // 走 WebSocket，TLS 参数透传
    rejectUnauthorized: true,
    ca, cert, key,                        // minasCert 同一套证书
    checkServerIdentity                   // DID SHA1 指纹校验
  },
  keepalive: 30,
  reconnectPeriod: 0,                     // 官方自己管重连，不用 mqtt.js 自动重连
  connectTimeout: 30000,
  resubscribe: true,
}
```

**关键点**：MQTT broker 就挂在 `urlport` 这一个端口上，与 HTTPS LuCI 共用。
不需要探测新端口；证书、token、DID 指纹校验全部复用网关现有资产。

### 1.2 订阅主题表（从 layout bundle 原样提取）

| 主题 | 事件 | 数据价值 |
|------|------|---------|
| `/sys/nas/alluser/meminfo/update` | 内存信息推送 | **唯一内存数据源**，无 HTTP 接口 |
| `/sys/nas/alluser/usbinfo/update` | USB 设备插拔 | 通知 |
| `/sys/nas/alluser/disk` | 磁盘将满 | 告警 |
| `/sys/nas/alluser/storage/modifypool` | 存储池变更 | 刷新存储面板 |
| `/sys/+/${uid}/filemgr` | 文件操作完成（任务中心刷新） | 任务完成即时通知 |
| `/sys/+/${uid}/homepage` | 首页文管操作 | 刷新文件列表 |
| `/sys/+/${uid}/safebox` | 保险箱变更 | 状态刷新 |
| `/sys/+/${uid}/plugin` | 插件安装/卸载/升级 | 应用列表刷新 |
| `/sys/+/${uid}/ipc_yolo` | 摄像头事件 | 通知 |
| `/sys/+/${uid}/ipc_delete` | IPC 删除任务 | 通知 |
| `/sys/nas/${uid}/album/member_update` | 相册成员变更 | 相册刷新 |
| `/sys/nas/${uid}/album/new_album` | 新建相册 | 相册刷新 |
| `/sys/nas/${uid}/album/del_album` | 删除相册 | 相册刷新 |
| `/sys/nas/${uid}/album/rename_album` | 相册重命名 | 相册刷新 |

`+` 是 MQTT 单层通配符，原样使用；`${uid}` 替换成登录 UID。
另有不走主题表的通知类消息经主进程 `mqttMsgDeal` 分发为
`controller/mqtt/{noticeList,diskFullNotification,fileMgrNotification,...}`。

### 1.3 主进程消息分发（mqttMsgDeal.js 解混淆结果）

收到消息后按主题映射到处理器：`handleFilemgrMessage`、
`handleDiskFullMessage`、`handleUsbInfoMessage`、`handlePluginMessage`、
`handleSafeboxMessage`、`handlePictureMessage`、相册增删改三个 handler，
然后 `webContents.send('controller/mqtt/xxx', payload)` 推到渲染层。
我们不需要复刻这层——网关直接把原始 `{topic, payload}` 抛给前端即可。

## 二、风险与约束分析

| 风险 | 评估 | 对策 |
|------|------|------|
| 对 NAS 产生影响 | 订阅是 broker 的标准只读操作；但 SUBSCRIBE 本身也算一次连接行为 | 全程**禁止 publish**；连接、订阅、收消息三步均可只读完成 |
| 与官方客户端抢连接 | MQTT 同一 username+clientId 可能被 broker 踢掉旧连接 | clientId 用 `dev-zcode-web-<rand>`，与官方 `dev-<deviceUid>` 区分；username 复用 `uid_deviceUid` 但 deviceUid 可自取随机后缀——**这是唯一需要实测确认的点**（broker 是否按 username 唯一踢人）。若会踢官方客户端，就必须放弃或改方案（见备选） |
| token 过期 | keepalive 30s + token 30 分钟轮换 | 复用 `ensureReady()`；连接断开时先刷新 token 再重连 |
| 官方客户端不在线 | MQTT 依赖 P2P 隧道，隧道不在则整个方案不成立 | 与现有所有接口相同的前提，无需额外处理 |
| 端口复用 | wss 与 https 同端口，需确认 NAS 的 nginx 支持 upgrade | 官方就是这么连的，端口已确认 |

**备选方案（若实测发现会踢官方连接）**：
- 用另一个 username 后缀：官方 username 形如 `<uid>_<deviceUid>`，我们可试
  `<uid>_zcode-<rand>`——broker 若只按 clientId 判重则互不影响。
- 真不行就放弃实时推送，保持轮询；meminfo 仍不可得，其余价值是通知及时性。

## 三、分步实现计划

### 里程碑 0 —— 只读探针（不改网关/前端，验证可行性）

交付物：`tools/probe-mqtt.cjs`

- 用 `mqtt` npm 包（client 自带 node_modules 里有，或直接 `npm i mqtt` 到 tools 作用域）
- 连接参数完全复刻官方：wss://127.0.0.1:<urlport>，cert/key/ca，username `<uid>_<rand-suffix>`，password = accessToken，clientId `dev-zcode-probe-<rand>`
- 只 subscribe：`/sys/nas/alluser/meminfo/update` + `/sys/nas/alluser/usbinfo/update` + `/sys/nas/alluser/disk`
- 打印每条消息的 topic + payload，运行 90 秒自动退出
- **验证点**：① 能否连上；② meminfo 推送的字段结构；③ 连接期间官方客户端是否掉线（用户观察）

验收：用户运行 `node tools/probe-mqtt.cjs`，确认收到推送且官方客户端无异常。

### 里程碑 1 —— 网关 MQTT→SSE 桥

交付物：gateway.js 新增 `/api/events`（Server-Sent Events）+ 内部 MqttBridge 模块

- 复用 cert/key/ca/ensureReady()，username 用 `<uid>_zcode-<rand>`
- 订阅全部 14 个主题，收到消息 → `{topic, data, ts}` 推给所有 SSE 客户端
- meminfo 推送单独解析出 `{totalBytes, usedBytes, usagePercent}` 合并进 `/api/system` 响应（补上现在 null 的内存字段）
- 断线重连：先 `ensureReady()` 刷 token，指数退避（1s→30s 封顶）
- **不 publish、不响应任何 NAS 侧请求**

验收：用户打开 `http://127.0.0.1:8090/api/events` 或 curl 能看到事件流。

### 里程碑 2 —— 前端接入

- `EventSource('/api/events')` 全局监听
- `meminfo/update` → 更新 MonitorChart 内存条（首次有真实数据）
- `filemgr`/`homepage` → 任务中心自动刷新 + toast「任务完成」
- `album/*` → 相册弹窗开着时自动刷新列表
- `disk`/`usbinfo` → 右上角通知条
- `storage/modifypool` → 重新拉 `/api/system`
- 事件源断开时静默回退到现有 8s 轮询（已经存在，零成本兜底）

### 里程碑 3 —— 通知中心（可选，依赖里程碑 2 稳定后）

noticeList 消息走主进程 DB（msgDbBase）存储再分发，渲染层有独立 `notice` 页面。
评估后可做可不做：站内信查询可能另有 HTTP 接口，优先级最低。

## 四、不做清单（写边界）

- 永不调用 `client.publish()`
- 不碰 `storage/modifypool` 等主题对应的 LuCI 写接口——主题只是通知通道
- 不主动发 PINGREQ 以外任何包（keepalive 由 mqtt.js 自动管理，属协议维持，不是业务写）

## 五、当前阻塞点

里程碑 0 的探针脚本已可写，但**运行验证必须由用户执行**（约束）。
唯一技术不确定项：broker 是否容忍第二个并发 MQTT 会话（见风险表）。
