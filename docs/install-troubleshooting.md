# 初始化文件权限故障恢复

适用场景：首次安装时 MySQL 日志包含以下错误，随后数据库进程恢复运行，但面板初始化未完成：

```text
/docker-entrypoint-initdb.d/init.sql: Permission denied
```

以 root 下载文件时，如果设置了 `umask 077`，`gost.sql` 默认只有 root 可读。Compose 将该文件只读挂载到容器后，容器内的 mysql 用户无法读取，导致初始化 SQL 没有执行。仅重启数据库不会自动补跑失败的初始化脚本。

`gost.sql` 是公开的初始表结构模板，可以设为 `0644`；`.env` 含数据库密码和 JWT 密钥，必须保持 `0600`。不要对整个目录执行递归放宽权限的命令。

## 保留数据的恢复步骤

先检查进程状态和日志：

```bash
docker logs --tail 100 gost-mysql
docker inspect --format 'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} health={{.State.Health.Status}}' gost-mysql
```

只有确认 MySQL 已运行、此次是首次初始化失败时，才执行下面的命令。路径按实际安装位置修改。它会先检查业务库表数量，**只向空库导入**；若已存在表或认证失败，则停止，不会启动后续服务或强行覆盖。

```bash
cd /opt/tms-service-center &&
chmod 644 gost.sql &&
chmod 600 .env &&
docker exec -i gost-mysql sh -ec '
export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
tables=$(mysql -uroot "$MYSQL_DATABASE" -Nse \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()")
if [ "$tables" != "0" ]; then
  echo "停止：数据库已经存在表，未执行导入。请先检查现有表。"
  exit 1
fi
mysql --default-character-set=utf8mb4 -uroot "$MYSQL_DATABASE"
echo "初始化表导入成功"
' < gost.sql &&
docker compose up -d &&
docker compose ps
```

如果导入过程中发生 SQL 错误，可能已创建部分表。不要反复导入，更不要加 `--force` 忽略错误；保留日志并检查已执行到哪条语句。

不要运行 `docker compose down -v`、删除 `mysql_data` 卷或重新执行 `panel_install.sh install`。这些操作会删除数据库，而不是修复权限。

## 检查恢复结果

```bash
docker compose ps
docker logs --tail 80 springboot-backend
```

确认数据库与后台健康、前端运行后，再用安装时设置的前端端口访问。默认是 `http://服务器公网IP:6366`，首次登录后修改默认账号密码。

首次安装若在启动容器阶段退出，后续的节点对接地址配置和 `tms` 管理命令可能尚未完成。恢复容器后还需检查这两项，不能通过重新执行完整安装来补齐。

## 源码与 Release

源码中的安装脚本会在启动容器前校验并设置 `gost.sql` 的读取权限，同时在写入 `.env` 前限制其权限。已发布的 `v1.0.0` 附件不会自动改变；需要发布新的服务端版本，`releases/latest/download/panel_install.sh` 才会包含此修复。桌面客户端安装包不受此权限问题影响。
