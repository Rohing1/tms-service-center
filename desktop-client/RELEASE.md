# TMS Desktop v1.0.0

连接已部署的 TMS Service Center，使用服务器上的账号、线路、自助中心、套餐与续期功能。**这是桌面客户端，不包含本机数据库、Java 后台或代理内核。**

## 下载

| 系统 | 普通版 | 内置 WebView2 版 |
| --- | --- | --- |
| Windows 10/11 64 位 | `windows-x64-setup.exe` | `windows-x64-webview2-setup.exe` |
| Windows ARM64 | `windows-arm64-setup.exe` | `windows-arm64-webview2-setup.exe` |
| macOS Apple 芯片 | `macos-arm64.dmg` | 不需要 |
| macOS Intel | `macos-x64.dmg` | 不需要 |
| Linux 64 位 | `linux-x64.deb` / `linux-x64.rpm` | 不需要 |
| Linux ARM64 | `linux-arm64.deb` / `linux-arm64.rpm` | 不需要 |
| Linux ARMv7 | `linux-armv7.deb` / `linux-armv7.rpm` | 不需要 |

所有文件名前缀为 `TMS-Desktop-1.0.0-`。`SHA256SUMS` 用于校验完整性。

## 使用

安装后填写面板首页地址，例如 `https://panel.example.com`。使用现有账号登录；通过顶部 **TMS → 服务器设置** 切换服务器。关闭面板窗口返回设置，选择 **退出 TMS** 结束程序。

- Windows 普通版使用系统 WebView2，缺失时安装程序联网补装；内置版随应用提供固定版运行环境，无需另行安装 WebView2。不支持 Windows 7/8。
- macOS 要求 12 或更新版本；Linux 要求 glibc 2.36+、GTK3、WebKitGTK 4.1，适合 Debian 12+ / Ubuntu 24.04+ 等带桌面环境的系统。RPM 也必须满足这些依赖，不能用于缺少桌面/WebKitGTK 的精简服务器或旧版 CentOS。
- 软件尚未配置商业代码签名证书和 Apple 公证，系统可能显示发布者或验证提示。不要把未签名等同于已通过系统信誉认证。
- 同源页面在应用内打开，外部新窗口网页交给浏览器；代理客户端的自定义协议导入链接请在浏览器中使用。登录状态由各服务器页面的 WebView 存储管理，移除地址记录不会清除该站点登录状态，请先在面板退出账号。
- 服务器页面没有桌面文件读写或命令执行权限。应用只保存服务器名称和地址，不另存账号密码。
- 各平台由自动构建生成；跨架构构建通过不等同于所有系统均完成实体设备测试。固定版 WebView2 需要随客户端新版更新。

桌面版本使用独立 `desktop-v*` 标签，不替换 Linux 面板安装脚本使用的服务端 latest Release。
