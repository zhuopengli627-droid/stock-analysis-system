# 持仓快照复盘

当成交历史尚未补齐时，可以将同一时点的券商截图手工抄录为 JSON，再生成 Markdown 和结构化 JSON 报告。命令读取本地文件，校验持仓数量、可卖数量和市值，计算市值占总资产比例，并保留券商显示的成本及盈亏。

从仓库根目录运行：

```powershell
.venv/Scripts/python.exe -m scripts.portfolio_snapshot_review data/portfolio-snapshot.json
```

每次运行在 `reports/portfolio-snapshots/` 下创建一个目录，终端会显示完整路径。报告不会覆盖以前的版本。输入和输出所在目录默认被 Git 忽略。命令没有数据库、外部行情或模型调用。

以下为虚构输入示例。价格和金额可用十进制字符串，数量用整数，截图时间须包含时区偏移。当前支持人民币账户和六位证券代码。

```json
{
  "observed_at": "2026-01-06T14:38:00+08:00",
  "currency": "CNY",
  "total_assets": "1000.00",
  "market_value": "600.00",
  "available_cash": "400.00",
  "withdrawable_cash": "100.00",
  "broker_total_pnl": "-250.00",
  "broker_day_pnl": "-25.00",
  "positions": [
    {
      "symbol": "000001",
      "name": "测试标的",
      "quantity": 100,
      "sellable": 75,
      "broker_unit_cost": "8.50",
      "snapshot_price": "6.00",
      "market_value": "600.00",
      "broker_pnl": "-250.00"
    }
  ]
}
```
