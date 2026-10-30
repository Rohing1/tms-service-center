# TMS Service Center

基于 [Teminuosi/Tms](https://github.com/Teminuosi/Tms) 二次开发的线路管理与用户自助面板，集中管理协议、转发、用户配额、套餐分配和人工续期。

[发布版本](https://github.com/Rohing1/tms-service-center/releases/latest) · [客户端下载](#桌面客户端下载) · [功能介绍](#功能介绍) · [界面预览](#界面预览) · [安装面板](#安装面板) · [源码部署](#源码部署) · [使用流程](#使用流程)

本仓库提供独立的 Release、Linux 节点文件和前后端 Docker 镜像。安装脚本、Compose、节点安装入口和更新检查均指向 `Rohing1/tms-service-center`。

| 发布内容 | 地址 |
| --- | --- |
| Release 与安装文件 | [最新版本](https://github.com/Rohing1/tms-service-center/releases/latest) |
| 后端镜像 | `ghcr.io/rohing1/tms-service-center/springboot-backend:latest` |
| 前端镜像 | `ghcr.io/rohing1/tms-service-center/vite-frontend:latest` |
| 固定版本 | 将镜像标签 `latest` 替换为对应 Release 标签，例如 `v1.0.0` |

镜像支持 `linux/amd64` 和 `linux/arm64`。现有一键面板安装仍使用 MySQL 5.7，推荐在 AMD64 Linux 主机上运行；ARM64 的数据库部署需要另行适配。节点二进制提供 AMD64 和 ARM64 两种架构。

## 功能介绍

| 模块 | 功能 |
| --- | --- |
| 线路详情 | 查看关联用户、当前线路流量、前置机历史流量、监测延迟与丢包，执行一键诊断 |
| 用户自助中心 | 查看线路额度、用量、到期时间，复制订阅或扫码，提交人工续期申请并查看进度 |
| 套餐模板 | 配置直连或中转线路、GB 额度、有效天数、可选限速，支持编辑和停用 |
| 批量分配 | 每批最多 50 人，分配前预览，逐人显示结果，已有相同线路自动跳过 |
| 人工续期 | 增加有效期，保持、追加或设置流量额度，保留已有订阅和已用流量 |
| 站内提醒 | 到期前 7 天、流量使用达到 80%、流量耗尽及账号或线路异常提示 |
| 操作记录 | 记录执行结果、操作人、内部备注及变更前后的额度和到期时间 |
| 原有管理能力 | 多协议、直连与中转、端口转发、用户管理、限速、流量与到期控制 |

支持通用订阅及 Clash / Mihomo 订阅。本版本**不包含在线支付、自动扣费或外部消息推送**。

### 数据与操作说明

- 线路累计流量来自当前关联的转发记录；前置机历史流量和探测数据包含机器层面的信息，不等同于单线路计费或用户端到端质量。
- 一键诊断检查支持的协议监听与落地连接。UDP 协议不会通过 TCP 探测直接判定失败，实际使用仍需客户端验证。
- 续期不会清零已用流量；账号状态、账号总额度和账号到期仍独立生效。
- 提醒在打开或刷新页面时计算，不会自动发邮件、短信或 Telegram。
- 批量分配由浏览器逐项提交。离开页面后，尚未提交的用户不会继续执行；已提交结果保存在服务端。
- 操作显示「需核对」或长时间「处理中」时，先检查记录和节点状态，避免重复增加天数。

完整说明：[线路详情](docs/line-detail.md) · [自助中心、套餐与续期](docs/service-center.md)

## 界面预览

以下截图使用本地测试数据，订阅地址和账号均为演示内容，部分导航文字可能与当前版本略有差异。

### 用户自助中心

![用户自助中心：线路概览、到期与用量提醒、订阅入口](docs/images/self-center.jpg)

<details>
<summary>查看线路详情与操作记录</summary>

### 线路详情

![线路详情：线路信息、关联用户数量与流量趋势](docs/images/line-detail.jpg)

### 续期与分配记录

![操作记录：执行结果、变更前后值与操作人](docs/images/service-records.jpg)

</details>

## 安装面板

需要桌面应用请查看 [全平台客户端下载](#桌面客户端下载)。客户端连接已经部署的服务器；下面的安装步骤用于部署服务器本身。

在新的 Linux 面板服务器上，从本仓库最新 Release 获取安装脚本：

```bash
curl -fL https://github.com/Rohing1/tms-service-center/releases/latest/download/panel_install.sh -o panel_install.sh
bash panel_install.sh
```

根据菜单完成安装。脚本会使用本仓库的前后端镜像并生成配置；已有面板迁移前先备份数据库和 `.env`，不要直接覆盖旧部署。新库默认账号与密码均为 `admin_user`，首次登录后立即修改。

安装后在面板新增转发机，再通过该节点的安装入口生成命令。Release 中的 `gost-amd64`、`gost-arm64` 是节点文件，`SHA256SUMS` 可校验下载完整性。

如镜像拉取提示 `denied`，维护者需确认两个 GHCR 包均设为 Public；发布后的首次可见性设置见 [发布说明](docs/releasing.md)。

## 桌面客户端下载

[TMS Desktop v1.0.0](https://github.com/Rohing1/tms-service-center/releases/tag/desktop-v1.0.0) 是连接服务器的桌面客户端，不包含本机数据库或 Java 后台。填写面板首页地址后，使用原有账号登录。

### Windows（不支持 Win7/8）

**正常版本（推荐）**

- [64 位（常用）](https://github.com/Rohing1/tms-service-center/releases/download/desktop-v1.0.0/TMS-Desktop-1.0.0-windows-x64-setup.exe) | [ARM64](https://github.com/Rohing1/tms-service-center/releases/download/desktop-v1.0.0/TMS-Desktop-1.0.0-windows-arm64-setup.exe)

普通版使用系统 WebView2，缺少时会联网安装。

**内置 WebView2 版本（体积较大，无法单独安装 WebView2 时使用）**

- [64 位](https://github.com/Rohing1/tms-service-center/releases/download/desktop-v1.0.0/TMS-Desktop-1.0.0-windows-x64-webview2-setup.exe) | [ARM64](https://github.com/Rohing1/tms-service-center/releases/download/desktop-v1.0.0/TMS-Desktop-1.0.0-windows-arm64-webview2-setup.exe)

### macOS

- [Apple M 芯片](https://github.com/Rohing1/tms-service-center/releases/download/desktop-v1.0.0/TMS-Desktop-1.0.0-macos-arm64.dmg) | [Intel 芯片](https://github.com/Rohing1/tms-service-center/releases/download/desktop-v1.0.0/TMS-Desktop-1.0.0-macos-x64.dmg)

要求 macOS 12 或更新版本。

### Linux

**DEB 包（Debian / Ubuntu 系）**

- [64 位](https://github.com/Rohing1/tms-service-center/releases/download/desktop-v1.0.0/TMS-Desktop-1.0.0-linux-x64.deb) | [ARM64](https://github.com/Rohing1/tms-service-center/releases/download/desktop-v1.0.0/TMS-Desktop-1.0.0-linux-arm64.deb) | [ARMv7](https://github.com/Rohing1/tms-service-center/releases/download/desktop-v1.0.0/TMS-Desktop-1.0.0-linux-armv7.deb)

**RPM 包（RPM 系发行版）**

- [64 位](https://github.com/Rohing1/tms-service-center/releases/download/desktop-v1.0.0/TMS-Desktop-1.0.0-linux-x64.rpm) | [ARM64](https://github.com/Rohing1/tms-service-center/releases/download/desktop-v1.0.0/TMS-Desktop-1.0.0-linux-arm64.rpm) | [ARMv7](https://github.com/Rohing1/tms-service-center/releases/download/desktop-v1.0.0/TMS-Desktop-1.0.0-linux-armv7.rpm)

Linux 要求带桌面环境、glibc 2.36+ 和 WebKitGTK 4.1。

软件暂未配置商业签名和 Apple 公证，系统可能提示验证发布者。更多使用和构建说明见 [桌面客户端](desktop-client/README.md)。

## 源码部署

下面使用仓库现有的 [docker-compose-hybrid.yml](docker-compose-hybrid.yml) 构建面板，适合先在独立 Linux 测试机上验收。需要 Git、Docker、Docker Compose 插件及 OpenSSL，构建时需要访问镜像和依赖仓库。

该 Compose 文件使用固定容器名、网络名和数据卷名，数据库镜像为 MySQL 5.7。不要与已有 TMS 实例直接混用，也不要把旧部署目录或数据库当成全新环境初始化。

### 1. 获取本仓库源码

```bash
git clone https://github.com/Rohing1/tms-service-center.git
cd tms-service-center
```

### 2. 创建环境配置

在仓库根目录执行。下列命令只在 `.env` 不存在时创建配置，并生成随机数据库密码和 JWT 密钥：

```bash
if [ ! -f .env ]; then
  umask 077
  cat > .env <<EOF
DB_NAME=gost
DB_USER=gost
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
BACKEND_PORT=6365
FRONTEND_PORT=6366
EOF
fi
```

端口如有冲突，请先修改 `.env`。已有数据库部署必须沿用原数据库凭据，不能随意重新生成密码。`.env` 已被 Git 忽略，请单独妥善备份。

### 3. 构建并启动面板

```bash
docker compose -f docker-compose-hybrid.yml --env-file .env up -d --build
docker compose -f docker-compose-hybrid.yml --env-file .env ps
docker compose -f docker-compose-hybrid.yml --env-file .env logs --tail=100 backend
```

构建和服务启动完成后，访问 `http://服务器IP:6366`；若修改了 `FRONTEND_PORT`，使用实际端口。

全新数据库的默认账号和密码均为 `admin_user`。首次登录后立即修改密码。

初次初始化使用 `gost.sql`。不要在全新库上重复导入 `hybrid-schema-v1.sql` 至 `v3.sql`；它们是旧版本升级文件。后端启动时会为套餐与续期新增四张表，数据库账号需具备相应建表权限，详情见 [部署与存储](docs/service-center.md#部署与存储)。

发布流程会使用临时 MySQL 启动 AMD64 前后端容器，检查首页、登录拦截和四张业务表。真实节点及客户端链路仍需在部署环境验收。

### 4. 接入节点和配置域名

在管理端「转发机」中新增节点，使用该节点的安装入口生成命令。安装脚本会下载本仓库最新 Release 中对应架构的节点文件。安装前确认目标机器，接入后先验证一条直连和一条中转。

面板配置 HTTPS 时，将反向代理指向前端端口，并转发 WebSocket 升级头。详细配置见 [反向代理说明](docs/反向代理.md)。

### 5. 后续更新

更新前备份数据库与 `.env`。在本仓库目录执行：

```bash
git pull --ff-only origin main
docker compose -f docker-compose-hybrid.yml --env-file .env up -d --build
docker compose -f docker-compose-hybrid.yml --env-file .env logs --tail=100 backend
```

前后端需要一起更新。若本地有未提交修改或分支已分叉，先处理差异；不要用强制重置覆盖自己的配置和代码。

维护者通过 Actions 的「Publish TMS release」手动发布新版本。流程完成测试和构建后生成 Release、版本镜像及 `latest` 标签，具体见 [发布说明](docs/releasing.md)。

## 使用流程

### 管理员

1. 在「转发机」「协议管理」或「中转」中准备线路，确认节点可用。
2. 打开「套餐与续期」→「套餐模板」，设置线路、额度、有效天数与可选限速。
3. 在「批量分配」中选择模板和用户，核对预览后执行，查看每位用户的结果。
4. 在「续期申请」中处理用户需求，预览并确认人工续期，或填写不通过的回复。
5. 在「到期与用量提醒」和「操作记录」中查看需要处理的线路及变更记录。

已有相同线路会被跳过；修改模板只影响后续分配。旧的用户管理续期入口也会跳转到新流程。

### 用户

1. 登录后进入「自助中心」，查看线路用量、到期与提醒。
2. 按客户端类型复制通用或 Clash / Mihomo 订阅，或扫码导入。
3. 需要续期时提交申请，写明所需天数或流量。
4. 在「续期申请」查看管理员回复，在「服务记录」查看已执行的变更。

提交申请不会自动修改套餐。处理完成后刷新页面，并在客户端更新订阅。

## 开发与验证

| 组件 | 目录 | 环境 |
| --- | --- | --- |
| 前端 | `vite-frontend` | React、TypeScript、Vite；Dockerfile 使用 Node.js 20.19.0 |
| 后端 | `springboot-backend` | Spring Boot、MyBatis Plus；Java 21、Maven 3.9 |
| 节点 | `go-gost` | Go；版本以 `go.mod` 的 `go` / `toolchain` 声明为准 |
| 移动端源码 | `android-app`、`ios-app` | 保留原项目源码，本次功能未做原生客户端发布验证 |

### 前端构建

```bash
cd vite-frontend
npm ci --legacy-peer-deps
npm run build
```

### 后端测试

在仓库根目录执行：

```bash
cd springboot-backend
mvn -Dtest=ServiceCenterServiceTest,ServiceCenterControllerTest,RenewalPolicyTest,LineDetailServiceTest,LineDetailControllerTest test-compile org.apache.maven.plugins:maven-surefire-plugin:3.2.5:test
```

最近一次本地验证（2026-10-30）：

- 前端生产构建通过。
- 23 项后端测试通过，覆盖权限隔离、重复提交、线路互斥、续期规则、申请处理和线路详情。
- 使用临时 H2 数据库与模拟节点，不连接业务数据库。
- 浏览器使用测试数据检查模板创建、批量分配、用户申请、人工续期、记录、手机布局及空白/错误状态。

发布流程额外检查双架构镜像构建、节点交叉编译及临时 MySQL + 前后端容器启动。ARM64 镜像仅完成构建，真实节点配置下发、客户端连通性和生产迁移仍需部署环境验收。

## 文档与反馈

- [线路详情与诊断说明](docs/line-detail.md)
- [自助中心、套餐、批量分配与人工续期说明](docs/service-center.md)
- [反向代理与 WebSocket 配置](docs/反向代理.md)
- [Release 与镜像发布说明](docs/releasing.md)
- [提交问题或功能建议](https://github.com/Rohing1/tms-service-center/issues)

反馈时请说明操作步骤、预期结果和错误现象；日志或截图中的订阅 token、节点密钥及数据库密码应先隐藏。

## 致谢与许可证

本仓库基于 [Teminuosi/Tms](https://github.com/Teminuosi/Tms) 二次开发，使用 [go-gost/gost](https://github.com/go-gost/gost) 与 [go-gost/x](https://github.com/go-gost/x) 等开源项目，保留原有版权与许可证文件。

项目根目录许可证为 [Apache License 2.0](LICENSE)；各组件及第三方依赖遵循其各自许可证。项目按许可证所述以现状提供，不作担保，请在合法、获得授权的场景中使用。
