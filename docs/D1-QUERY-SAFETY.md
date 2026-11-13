# D1 历史数据查询安全规范

## 事故背景与边界

2026-11-13 01:57 UTC，D1 Analytics 记录到约 7,104 万行读取的突发峰值，超过免费版每日读取额度。查询明细是采样数据，不能据此百分之百确定具体 SQL。项目平时的监控读取量远低于每日限额。

**Worker 不能拦截通过 Cloudflare 控制台、API 或 Wrangler 直接执行的 D1 SQL。** 生产排查优先使用 D1 Insights/Analytics（独立于 D1 数据库查询），不要直接运行未经评估的历史表 SQL。

## 索引与每周换表

- metrics_history 以编码分区和时间的 id 主键提供常规监控查询，保留现有高效读取方式。
- 额外维护 (server_id, timestamp DESC) 联合索引，保护按服务器、时间检索最新记录的诊断场景。
- 使用两个交替索引名：idx_metrics_history_server_ts_a / idx_metrics_history_server_ts_b。每周日将当前表改名为 metrics_history_old 后，旧索引随表保留；新表使用另一个索引名，不重建旧索引。
- 每小时检查当前表索引，遇到 D1 免费额度耗尽会记录告警并在下一次整点重试。不会删除历史数据或调整探针上报频率。

## 生产 SQL 安全要求

1. 优先通过现有 API 获取最新状态；通过 D1 Insights/GraphQL 查看高读取 SQL。
2. 任何直接查询历史表的诊断 SQL，必须先执行 EXPLAIN QUERY PLAN；计划必须使用整数主键 SEARCH 或 (server_id, timestamp) 联合索引 SEARCH。
3. 拒绝历史表全表 SCAN、无索引的相关子查询、笛卡尔积，以及对大表直接 ORDER BY RANDOM()。
4. WHERE server_id = ? 和 ORDER BY timestamp DESC LIMIT 20 可以使用联合索引；单独 LIMIT 20 **不能**保证低行读取。
5. 批量排查必须分批、限时、监控 rows_read；先在本地 D1/Miniflare 中测试，不能在生产环境做压力测试。
6. 对旧表的查询同样检查执行计划。新增代码须通过 scripts/check-d1-history-sql.mjs 和 test/d1-history-index.test.js；静态检查只是防线之一，不代替实际执行计划。

安全查询示例（绑定服务器 ID，勿直接拼接用户输入）：

~~~sql
EXPLAIN QUERY PLAN
SELECT timestamp, ping_ct, ping_cu, ping_cm
FROM metrics_history
WHERE server_id = ?
ORDER BY timestamp DESC
LIMIT 20;
~~~

执行计划确认使用联合索引后，才能执行去掉 EXPLAIN QUERY PLAN 的实际查询。
