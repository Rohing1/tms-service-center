# Release 与镜像发布

本仓库使用 `.github/workflows/docker-build.yml` 统一构建面板镜像和节点文件，避免节点专用 Release 替换 `latest` 后缺少面板安装附件。不会复制上游历史版本或发布统计。

## 发布新版本

在 GitHub 仓库的 **Actions → Publish TMS release → Run workflow** 选择 `main`，输入新的 `v主版本.次版本.修订号`，例如 `v1.0.1`。

流程依次进行：

1. 校验版本号，运行 23 项后端测试及安装脚本语法检查。
2. 构建并上传 AMD64/ARM64 前后端镜像，先使用对应提交的 `sha-...` 标签。
3. 交叉编译两种架构的 Linux 节点，打包脚本、Compose、初始化 SQL 和 SHA256 校验文件。
4. 在独立 GitHub runner 中使用临时 MySQL 启动 AMD64 镜像，检查首页、登录拦截和自助中心表初始化；结束后清理测试容器和数据卷。
5. 上传草稿 Release 的附件，再设置版本和 `latest` 镜像标签，最后公开 Release。

已公开的版本不可重复发布。失败的构建不会公开 Release；同一提交上的草稿可以重试，不要把已有草稿用于另一份源码。

## 两个镜像包

- `ghcr.io/rohing1/tms-service-center/springboot-backend`
- `ghcr.io/rohing1/tms-service-center/vite-frontend`

每个包包含固定版本、`latest` 和源码提交标签；OCI 元数据将包关联到本仓库，因此仓库侧栏可显示 Packages。

### 首次发布后设置为公开

GitHub Container Registry 首次发布的包默认是 Private，即使源码仓库是公开的。需要包所有者在 GitHub 页面操作一次：

1. 从仓库右侧 **Packages** 进入一个镜像包。
2. 点击 **Package settings**。
3. 在 **Danger Zone → Change package visibility** 中选择 **Public**，按页面提示确认。
4. 对另一个镜像包重复操作。

公开后，安装者无需登录 GHCR 即可拉取；未来发布到同一个包的版本沿用该可见性。参考 [GitHub 官方包可见性说明](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)。

## 安装与更新地址

面板安装脚本、Compose、数据库模板和节点文件从本仓库 `releases/latest/download/` 获取。节点安装命令由面板生成。前后端镜像指向上述两个包，面板更新检查只读取本仓库统一发布工作流的成功记录。

Release 只表示自动构建与容器检查通过；真实节点、客户端链路、ARM64 容器运行与已有业务库迁移仍需独立验收。
