"""Generate and persist deterministic portfolio daily reviews."""

from __future__ import annotations

import json
from datetime import date
from typing import Any, Dict, Optional

from src.repositories.portfolio_repo import PortfolioRepository
from src.services.portfolio_risk_service import PortfolioRiskService
from src.services.portfolio_service import PortfolioService


class PortfolioReviewService:
    def __init__(
        self,
        *,
        repo: Optional[PortfolioRepository] = None,
        portfolio_service: Optional[PortfolioService] = None,
        risk_service: Optional[PortfolioRiskService] = None,
    ):
        self.repo = repo or PortfolioRepository()
        self.portfolio_service = portfolio_service or PortfolioService(repo=self.repo)
        self.risk_service = risk_service or PortfolioRiskService(
            repo=self.repo,
            portfolio_service=self.portfolio_service,
        )

    def create_review(
        self,
        *,
        account_id: Optional[int] = None,
        review_date: Optional[date] = None,
        cost_method: str = "fifo",
        include_realtime: bool = False,
    ) -> Dict[str, Any]:
        target_date = review_date or date.today()
        snapshot = self.portfolio_service.get_portfolio_snapshot(
            account_id=account_id,
            as_of=target_date,
            cost_method=cost_method,
            include_realtime=include_realtime,
        )
        risk = self.risk_service.get_risk_report(
            account_id=account_id,
            as_of=target_date,
            cost_method=cost_method,
            include_realtime=include_realtime,
        )
        payload = self._build_payload(snapshot=snapshot, risk=risk, target_date=target_date)
        markdown = self._render_markdown(payload)
        row = self.repo.add_review(
            account_id=account_id,
            review_date=target_date,
            cost_method=cost_method,
            generation_mode="rules",
            data_quality=str(snapshot.get("data_quality") or "ok"),
            payload_json=json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")),
            markdown=markdown,
        )
        return self._serialize(row, payload=payload)

    def get_review(self, review_id: int) -> Optional[Dict[str, Any]]:
        row = self.repo.get_review(review_id)
        return self._serialize(row) if row is not None else None

    def list_reviews(
        self,
        *,
        account_id: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        rows, total = self.repo.list_reviews(
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            page=page,
            page_size=page_size,
        )
        return {
            "items": [self._serialize(row, include_content=False) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    @staticmethod
    def _build_payload(*, snapshot: Dict[str, Any], risk: Dict[str, Any], target_date: date) -> Dict[str, Any]:
        positions = [
            {
                "account_id": account["account_id"],
                "symbol": position["symbol"],
                "quantity": position["quantity"],
                "avg_cost": position["avg_cost"],
                "review_price": position["last_price"],
                "market_value": position["market_value_base"],
                "unrealized_pnl": position["unrealized_pnl_base"],
                "unrealized_pnl_pct": position.get("unrealized_pnl_pct"),
                "price_source": position.get("price_source"),
                "price_provider": position.get("price_provider"),
                "price_date": position.get("price_date"),
                "price_stale": bool(position.get("price_stale")),
                "price_available": bool(position.get("price_available", True)),
            }
            for account in snapshot.get("accounts", [])
            for position in account.get("positions", [])
        ]
        triggered = [item for item in positions if item.get("unrealized_pnl_pct") is not None and item["unrealized_pnl_pct"] <= -10]
        return {
            "schema_version": 1,
            "review_date": target_date.isoformat(),
            "generation_mode": "rules",
            "facts": {
                "currency": snapshot["currency"],
                "account_count": snapshot["account_count"],
                "total_cash": snapshot["total_cash"],
                "total_market_value": snapshot["total_market_value"],
                "total_equity": snapshot["total_equity"],
                "realized_pnl": snapshot["realized_pnl"],
                "unrealized_pnl": snapshot["unrealized_pnl"],
                "positions": positions,
            },
            "calculations": {
                "position_count": len(positions),
                "market_exposure_pct": round(
                    snapshot["total_market_value"] / snapshot["total_equity"] * 100, 2
                ) if snapshot["total_equity"] else None,
                "concentration": risk.get("concentration", {}),
                "drawdown": risk.get("drawdown", {}),
            },
            "rule_findings": {
                "concentration_alert": bool(risk.get("concentration", {}).get("alert")),
                "drawdown_alert": bool(risk.get("drawdown", {}).get("alert")),
                "loss_over_10_pct": [item["symbol"] for item in triggered],
            },
            "inferences": [],
            "assumptions": [],
            "limitations": list(snapshot.get("limitations", [])),
        }

    @staticmethod
    def _render_markdown(payload: Dict[str, Any]) -> str:
        facts = payload["facts"]
        calculations = payload["calculations"]
        findings = payload["rule_findings"]
        lines = [
            f"# {payload['review_date']} 持仓复盘",
            "",
            "## 账户事实",
            "",
            f"- 净资产 {facts['total_equity']:.2f} {facts['currency']}，现金 {facts['total_cash']:.2f}，持仓市值 {facts['total_market_value']:.2f}。",
            f"- 已实现盈亏 {facts['realized_pnl']:.2f}，未实现盈亏 {facts['unrealized_pnl']:.2f}。",
            "",
            "## 计算结果",
            "",
            f"- 持仓数量 {calculations['position_count']}，仓位 {calculations['market_exposure_pct'] if calculations['market_exposure_pct'] is not None else '数据不足'}%。",
            "",
            "## 规则检查",
            "",
            f"- 集中度预警：{'触发' if findings['concentration_alert'] else '未触发'}。",
            f"- 回撤预警：{'触发' if findings['drawdown_alert'] else '未触发'}。",
            f"- 浮亏超过 10%：{', '.join(findings['loss_over_10_pct']) or '无'}。",
            "",
            "## 持仓明细",
            "",
            "| 代码 | 数量 | 市值 | 未实现盈亏 | 价格日期 | 来源 | 状态 |",
            "| --- | ---: | ---: | ---: | --- | --- | --- |",
        ]
        for position in facts["positions"]:
            status = "缺价" if not position["price_available"] else ("陈旧" if position["price_stale"] else "可用")
            source = position.get("price_provider") or position.get("price_source") or "unknown"
            lines.append(
                f"| {position['symbol']} | {position['quantity']:.2f} | {position['market_value']:.2f} | "
                f"{position['unrealized_pnl']:.2f} | {position.get('price_date') or '-'} | {source} | {status} |"
            )
        lines.extend(["", "## 数据限制", ""])
        lines.extend(f"- {item}" for item in payload["limitations"])
        if not payload["limitations"]:
            lines.append("- 无已知数据限制。")
        return "\n".join(lines) + "\n"

    def verify_review(self, review_id: int, *, as_of: Optional[date] = None) -> Optional[Dict[str, Any]]:
        row = self.repo.get_review(review_id)
        if row is None:
            return None
        target_date = as_of or date.today()
        payload = json.loads(row.payload_json)
        review_date = row.review_date
        items = []
        for position in payload.get("facts", {}).get("positions", []):
            symbol = str(position.get("symbol") or "")
            review_price = position.get("review_price")
            if not position.get("price_available", True) or not review_price:
                items.append({
                    "symbol": symbol,
                    "status": "not_automatable",
                    "reason": "review_price_unavailable",
                })
                continue
            close = self.repo.get_next_close_with_metadata(
                symbol=symbol,
                after_date=review_date,
                as_of=target_date,
            )
            if close is None:
                items.append({
                    "symbol": symbol,
                    "status": "pending" if target_date <= review_date else "insufficient_data",
                    "reason": "next_close_unavailable",
                })
                continue
            close_price, close_date, provider = close
            items.append({
                "symbol": symbol,
                "status": "verified_true" if close_price >= float(review_price) else "verified_false",
                "judgment": "next_close_not_below_review_price",
                "review_price": float(review_price),
                "observed_close": close_price,
                "observed_date": close_date.isoformat(),
                "provider": provider,
            })
        statuses = {item["status"] for item in items}
        if not items or statuses == {"not_automatable"}:
            status = "not_automatable"
        elif "insufficient_data" in statuses:
            status = "insufficient_data"
        elif "pending" in statuses:
            status = "pending"
        elif "verified_false" in statuses:
            status = "verified_false"
        else:
            status = "verified_true"
        details = {
            "review_id": review_id,
            "review_date": review_date.isoformat(),
            "as_of": target_date.isoformat(),
            "method": "next_close",
            "status": status,
            "items": items,
        }
        verification = self.repo.add_review_verification(
            review_id=review_id,
            as_of=target_date,
            status=status,
            method="next_close",
            details_json=json.dumps(details, ensure_ascii=False, allow_nan=False, separators=(",", ":")),
        )
        return self._serialize_verification(verification, details=details)

    def list_verifications(self, review_id: int) -> Optional[list[Dict[str, Any]]]:
        if self.repo.get_review(review_id) is None:
            return None
        return [self._serialize_verification(row) for row in self.repo.list_review_verifications(review_id)]

    @staticmethod
    def _serialize_verification(row: Any, *, details: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return {
            "id": row.id,
            "review_id": row.review_id,
            "as_of": row.as_of.isoformat(),
            "status": row.status,
            "method": row.method,
            "details": details if details is not None else json.loads(row.details_json),
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }

    @staticmethod
    def _serialize(row: Any, *, payload: Optional[Dict[str, Any]] = None, include_content: bool = True) -> Dict[str, Any]:
        item = {
            "id": row.id,
            "account_id": row.account_id,
            "review_date": row.review_date.isoformat(),
            "version": row.version,
            "cost_method": row.cost_method,
            "generation_mode": row.generation_mode,
            "data_quality": row.data_quality,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        if include_content:
            item["payload"] = payload if payload is not None else json.loads(row.payload_json)
            item["markdown"] = row.markdown
        return item
