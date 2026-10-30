# TMS Desktop

Tauri 2 桌面客户端，通过独立 WebView 加载用户指定的 TMS 服务端首页。服务器端功能无需复制到客户端；更新服务端后界面同步更新。本程序不运行 Java / MySQL / gost，不接管系统网络代理。

## 开发

安装 Node.js 22+、Rust 1.96.1 与对应平台的 [Tauri 构建依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
cd desktop-client
npm ci
npm run dev
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

原生设置页面位于 `ui/`，不依赖前端框架。Rust 负责地址验证、连接预检、设置保存、窗口与菜单。

```sh
npm run build -- --ci --target x86_64-pc-windows-msvc --bundles nsis
```

Windows 内置 WebView2 版需要 PowerShell 7：

```powershell
./scripts/prepare-webview.ps1 -Architecture x64
npm run build -- --ci --target x86_64-pc-windows-msvc --bundles nsis --config .cache/fixed-webview.json
```

脚本仅从 Microsoft 官方网页解析固定版 CAB 地址，验证解压后的 Microsoft 数字签名，再生成构建配置。固定运行环境不会自动更新；维护者应定期重新构建。保留随运行环境提供的许可证。

## 发布

GitHub Actions 的 **Build TMS desktop clients** 手动构建 12 个安装包：Windows 两种架构各普通/内置版、macOS 两种架构、Linux 三种架构各 DEB/RPM。Linux 使用 Debian 12 编译，ARMv7 使用交叉编译，避免模拟器长时间编译；软件包仍要求 glibc 2.36+、GTK3 和 WebKitGTK 4.1。生成 Release 前检查完整数量并写入 SHA256SUMS。

首版固定为 `desktop-v1.0.0`。升级时同步修改 package.json、Cargo.toml、tauri.conf.json、UI 版本、collect.mjs、工作流标签、RELEASE.md 和首页下载表。已公开版本不可覆盖。

发布明确使用 `--latest=false`，避免桌面 Release 覆盖服务端 `releases/latest/download/panel_install.sh`。不要合并为节点或面板工作流。

## 安全与存储

- 仅本地 `settings` 窗口能调用自定义命令；远端 `panel-*` 窗口不在任何本地能力授权列表内。每个命令还检查窗口来源。
- 仅接收无账号密码、无查询参数的 HTTP(S) 首页 URL；不放宽 TLS 验证，不接受文件、脚本或任意系统协议。
- 预检限制重定向为相同来源；应用内页面跳转也限制同源。弹窗 HTTP(S) 链接交给默认浏览器，其余协议拒绝。
- 地址按原子替换写入系统的应用配置目录 `io.github.rohing1.tms-desktop/servers.json`。账号登录状态在 WebView 的独立站点存储中，移除服务器记录不会退出账号。
- 下载/订阅导入不授予远端本地命令权限；如果网站依赖自定义协议，请通过菜单在浏览器打开后操作。
- 未配置 Windows 商业代码签名或 Apple 公证，发布时需要明确这一限制。

## 验证边界

7 项 Rust 测试覆盖地址规范化、危险地址与伪造设置来源拒绝，并通过真实本机 HTTP 请求验证 HTML 接受、API 地址拒绝、跨站跳转阻止与不可用服务器错误。平台 CI 检查编译、安装包生成和 Linux 包架构。必须另外验证桌面启动、连接失败提示、成功加载面板、切换服务器和退出行为；未进行实体设备测试的平台不得宣称完成运行验收。
