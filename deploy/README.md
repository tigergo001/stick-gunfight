# 阿里云 Docker 部署

目标：阿里云 ECS `typeflow-ecs`，域名 `g.xiaodoudou.ink`。

- 应用目录：`/opt/stick-gunfight`
- 应用容器：`stick-gunfight`
- 数据目录：`/opt/stick-gunfight/data`
- Docker 网络：`typeflow-production_default`
- 对外入口：现有 TypeFlow Caddy `typeflow-production-edge-1`
- 上游：`stick-gunfight:8080`
- Caddy 站点文件：`/opt/typeflow/infra/caddy/Caddyfile.production`

部署：

```bash
cd /opt/stick-gunfight
docker compose up -d
docker exec typeflow-production-edge-1 \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# 当前 edge 配置启用了 admin off，无法使用 caddy reload，只能重启 edge 容器。
docker restart typeflow-production-edge-1
```

验证：

```bash
curl -fsS https://g.xiaodoudou.ink/healthz
docker compose ps
docker compose logs --tail=100
```

回滚应用：

```bash
cd /opt/stick-gunfight
SGF_IMAGE=<previous-tag> docker compose up -d
```

回滚 Caddy：恢复部署前备份的 `Caddyfile.production`，然后重启 edge 容器：

```bash
docker restart typeflow-production-edge-1
```

首次部署前的完整备份位于：

```text
/opt/stick-gunfight/backups/Caddyfile.production.de1773dd904a.20260929-185312
```
