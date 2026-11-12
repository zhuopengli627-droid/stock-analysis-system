# Stock Analysis System

基于持仓、交易记录和市场行情的智能股票分析系统。

## 核心功能
- 持仓管理
- 股票交易记录
- 每日投资复盘
- 交易纪律与风险分析
- 市场行情与板块资金流追踪

## 开发方式
GitHub + OpenAI Codex

## 状态
V1 开发准备中

## V1 本地开发基线

底座为 [daily_stock_analysis ef44660](https://github.com/ZhuLinsen/daily_stock_analysis/tree/ef44660f00e08ce66dcd4dc4d2e700836c45e833)。目录保留上游模块边界，见 [架构方案](ARCHITECTURE.md)。项目处于基线验证阶段。

Windows PowerShell 需要 Python 3.12、Node.js 20.19–26 和 npm 10 或更新版本。从仓库根目录执行：

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
npm --prefix apps/dsa-web ci
npm --prefix apps/dsa-web run build
Copy-Item .env.example .env
.venv/Scripts/python.exe main.py --serve-only --host 127.0.0.1 --port 8000
```

打开 http://127.0.0.1:8000。持仓工作台位于 /portfolio。请将模型密钥保存在本地 .env，提交前确认暂存区无真实成交、数据库或报告。

持仓核算和 API 基线测试：

```powershell
.venv/Scripts/python.exe -m unittest discover -s tests -p 'test_portfolio*.py'
```

已有券商持仓截图时，可以在本地生成 [持仓快照复盘](docs/portfolio-snapshot-review.md)。
