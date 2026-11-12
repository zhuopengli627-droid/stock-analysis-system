# Portfolio Copilot P0

## 底座决策

采用 daily_stock_analysis 的 MIT 代码作为底座，固定可追踪的上游版本。保留原始许可证和第三方声明。保留 FastAPI、React 和 SQLAlchemy 模块边界。独立开发会重复账本、行情和分析任务；目前已有服务边界足以做增量扩展。

| 项目 | 复用与缺口 |
| --- | --- |
| [daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis) | 源码中 PortfolioService 已有账户、交易、现金、公司行为、可售校验、账本重放、估值、汇率；Web 已调用持仓 API。复用 FIFO/均价、CSV 预览、行情与分析任务，逐项验证复权、A 股可售规则、ETF 例外和缺价/缺汇处理。账户级收盘报告、对账和表格导入的覆盖仍需验收。 |
| [Vibe AStock](https://github.com/simonlin1212/vibe-astock) | 参考情绪复盘、交易日志和明日验证交互。P1 再实现计划及验证记录。 |
| [Ghostfolio](https://github.com/ghostfolio/ghostfolio) | 参考账户活动、资产分布和绩效口径。AGPLv3 代码不引入。 |
| [AKShare](https://github.com/akfamily/akshare) | 通过底座行情适配器接入，保留实际供应商与回退来源。 |
| [QuantStats](https://github.com/ranaroussi/quantstats) | 在获得现金流调整后的收益序列后用于绩效；首轮无需新增依赖。 |

## 结构与数据契约

保留 api/v1/endpoints、api/v1/schemas、src/services、src/repositories、data_provider、apps/dsa-web、tests。账本、估值、分析和报告分别在原有服务层实现。SQLite 保存本地数据，使用 ORM 边界，数据库迁移和 PostgreSQL 兼容性另行验证。

- 账户关联交易、现金流水和公司行动。账户内券商成交 ID 唯一，缺 ID 时将内容相同的记录标为疑似重复。按日期及可复现的事件顺序重放。手续费和税费进入成本或冲减卖出收入。现金按币种记账。分红计入现金，送转改变数量并保留总成本。
- 行情记录包含证券、交易日、供应商、抓取时间、复权、完整性。估值使用不复权收盘价，技术指标使用独立复权序列。缺价、错误价、陈旧行情和缺汇时显式标记，汇总标记为不完整。
- 持仓快照按账户、日期和成本口径生成。报告保存生成时间、目标交易日、来源、计算结果、规则版本和结构化证据，Markdown 与 JSON 同版本追加保存。
- 复用 /api/v1/portfolio 下的 accounts、trades、cash-ledger、corporate-actions、snapshot、risk、imports/csv、fx/refresh、positions/{symbol}/analysis。增量接口拟提供 POST /api/v1/portfolio/reconciliation、GET/POST /api/v1/portfolio/reviews 及 GET /api/v1/portfolio/reviews/{id}。

## 实施与验收

1. 固定底座版本并在 Windows 本地运行 API 和 Web，记录版本、启动命令和现有测试结果。
2. 以现有导入和持仓页面为入口，测试多买部分卖、费用、分红、送转、可售数量、币种隔离、重复导入与券商差额；根据测试结果补齐 Excel 和对账。
3. 验证真实 A/H/ETF 和指数日线，记录数据血缘；对非交易日、延迟、错误行情和重试分别验证。账户首页只在价格和汇率齐备时显示完整净值。
4. 复用逐仓分析和市场复盘任务。报告由账本快照和行情证据生成，外部模型仅接收最小必要上下文，可配置兼容接口、模型、超时和预算。未配置模型时仍可生成规则版报告，保存时标注生成方式。
5. 用真实收盘数据与明确标识的测试账户验证导入至报告的链路。个人数据库、报告和 API Key 均排除在 Git 外。定时任务在收盘数据完整后执行，延迟可重试且同日不会覆盖历史。

首轮交付标准为本地启动、导入成交、展示带来源的真实行情，以及生成可追溯的持仓报告。长期绩效、次日验证、组合优化和消息提醒留到后续阶段。
