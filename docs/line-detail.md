# 线路详情页

入口：管理员登录后，在「协议管理」或「中转」线路卡片点击「线路详情」。

- 直连：`/line/:nodeId`
- 中转：`/line/:nodeId?landingId=:landingId`

本页按前置机和落地出口汇总协议线路，保留每个关联用户独立的额度、到期和状态。普通转发隧道不纳入本页。

## 数据口径

- 顶部流量及用户明细：汇总当前线路关联的 `forward.in_flow/out_flow`，与现有线路配额使用同一计费口径；同一转发只计算一次。错误归属、缺失的转发记录不计入其他用户，而显示异常。
- 历史流量图：现有 `monitor_metric` 前置机网卡数据，包含该机器上其他线路，不等同于本线路计费流量。
- 延迟、丢包：现有 `monitor_probe` 前置机到监测目标的数据，不是用户经落地的端到端检测。无数据、过时和不支持的节点会单独提示。
- 清零或删除转发会改变当前累计流量。本次未新增线路历史采集表，也没有数据库迁移。

## 一键诊断

逐项调用节点现有 TCP 探测能力检查本地协议监听，已支持的 SOCKS5 落地复用已有出口检测。进度即时显示，可以停止后续检测。

Hysteria2、TUIC 等 UDP 协议不会用 TCP 检测判断失败。暂不支持在线检测的落地显示「未检测」。本地 TCP 连通不等于公网入口、协议认证或完整业务链路正常，仍需客户端联调。

## 后端接口

两个接口都经过登录拦截和管理员权限校验，不返回节点密钥、协议密码、订阅 token 或原始落地链接。

- `POST /api/v1/line/detail`：`{ "nodeId": 1, "landingId": null }`
- `POST /api/v1/line/diagnose`：`{ "nodeId": 1, "landingId": null, "kind": "protocol", "inboundId": 10 }`
- 落地检测用 `kind: "landing"`，无需 `inboundId`。

诊断只能选择数据库中属于当前线路的协议或落地，不能由请求任意指定目标地址。

## 构建与验证

前端：在 `vite-frontend` 执行 `npm ci --legacy-peer-deps`、`npm run build`。

后端：使用 Java 21，在 `springboot-backend` 执行：

```text
mvn -Dtest=LineDetailServiceTest,LineDetailControllerTest test-compile org.apache.maven.plugins:maven-surefire-plugin:3.2.5:test
```

测试使用模拟依赖，不启动业务数据库，覆盖管理员权限、参数校验、直连/落地范围、去重汇总、错误归属、停用/孤儿记录和 UDP/离线诊断状态。

部署时需同时更新前后端。真实环境验收应选择一条直连和一条中转，核对用户明细与已有配额页面，测试离线节点、UDP 协议和落地异常。浏览器测试数据仅用于本地界面验证，不属于生产接口实现。
