# -*- coding: utf-8 -*-
"""Portfolio risk service for concentration, drawdown and stop-loss proximity."""

from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

from src.config import Config, get_config
from src.repositories.portfolio_repo import PortfolioRepository
from src.services.decision_signal_service import DecisionSignalService
from src.services.decision_signal_summary import summarize_decision_signal
from src.services.portfolio_service import PortfolioService

logger = logging.getLogger(__name__)

DEFENSIVE_DECISION_SIGNAL_ACTIONS = ("sell", "reduce", "alert")


class PortfolioRiskService:
    """Compute portfolio risk blocks on top of replayed snapshot data."""

    # Board membership rarely changes, but each lookup goes through the provider
    # rate limiter (efinance sleeps 1.5-3s per call) and the risk endpoint builds
    # a new service per request, so non-empty results are shared per process.
    _BELONG_BOARDS_CACHE_TTL_SECONDS = 24 * 60 * 60
    _belong_boards_cache_lock = Lock()
    _belong_boards_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}

    def __init__(
        self,
        *,
        repo: Optional[PortfolioRepository] = None,
        portfolio_service: Optional[PortfolioService] = None,
        decision_signal_service: Optional[DecisionSignalService] = None,
        config: Optional[Config] = None,
    ):
        self.repo = repo or PortfolioRepository()
        self.portfolio_service = portfolio_service or PortfolioService(repo=self.repo)
        self.decision_signal_service = decision_signal_service or DecisionSignalService(portfolio_repo=self.repo)
        self.config = config or get_config()
        self._data_manager = None
        self._data_manager_init_error = ""

    def get_risk_report(
        self,
        *,
        account_id: Optional[int] = None,
        as_of: Optional[date] = None,
        cost_method: str = "fifo",
        include_realtime: bool = True,
    ) -> Dict[str, Any]:
        as_of_date = as_of or date.today()
        snapshot = self.portfolio_service.get_portfolio_snapshot(
            account_id=account_id,
            as_of=as_of_date,
            cost_method=cost_method,
            include_realtime=include_realtime,
        )

        thresholds = {
            "concentration_alert_pct": float(getattr(self.config, "portfolio_risk_concentration_alert_pct", 35.0)),
            "drawdown_alert_pct": float(getattr(self.config, "portfolio_risk_drawdown_alert_pct", 15.0)),
            "stop_loss_alert_pct": float(getattr(self.config, "portfolio_risk_stop_loss_alert_pct", 10.0)),
            "stop_loss_near_ratio": float(getattr(self.config, "portfolio_risk_stop_loss_near_ratio", 0.8)),
            "lookback_days": int(getattr(self.config, "portfolio_risk_lookback_days", 180)),
        }

        concentration = self._build_concentration(
            snapshot,
            thresholds["concentration_alert_pct"],
            as_of_date=as_of_date,
        )
        sector_concentration = self._build_sector_concentration(
            snapshot,
            thresholds["concentration_alert_pct"],
            as_of_date=as_of_date,
        )
        self._ensure_drawdown_snapshot_window(
            account_id=account_id,
            as_of_date=as_of_date,
            cost_method=cost_method,
            lookback_days=thresholds["lookback_days"],
            include_realtime=include_realtime,
        )
        drawdown = self._build_drawdown(
            account_id=account_id,
            as_of_date=as_of_date,
            cost_method=cost_method,
            threshold_pct=thresholds["drawdown_alert_pct"],
            lookback_days=thresholds["lookback_days"],
        )
        stop_loss = self._build_stop_loss(snapshot, thresholds)
        decision_signal_risk = self._build_decision_signal_risk(snapshot)

        return {
            "as_of": as_of_date.isoformat(),
            "account_id": account_id,
            "cost_method": cost_method,
            "currency": snapshot["currency"],
            "thresholds": thresholds,
            "concentration": concentration,
            "sector_concentration": sector_concentration,
            "drawdown": drawdown,
            "stop_loss": stop_loss,
            "decision_signal_risk": decision_signal_risk,
        }

    def get_position_diagnosis(
        self,
        *,
        account_id: int,
        symbol: str,
        as_of: Optional[date] = None,
        cost_method: str = "fifo",
        include_realtime: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Build a deterministic diagnosis for one held position."""
        as_of_date = as_of or date.today()
        target = self.portfolio_service._normalize_symbol_for_position(symbol)
        if not target:
            raise ValueError("symbol must not be empty")

        snapshot = self.portfolio_service.get_portfolio_snapshot(
            account_id=account_id,
            as_of=as_of_date,
            cost_method=cost_method,
            include_realtime=include_realtime,
        )
        account = next(
            (
                item
                for item in snapshot.get("accounts", [])
                if int(item.get("account_id") or 0) == int(account_id)
            ),
            None,
        )
        if account is None:
            return None

        position = next(
            (
                item
                for item in account.get("positions", [])
                if self.portfolio_service._normalize_symbol_for_position(
                    str(item.get("symbol") or "")
                ) == target
            ),
            None,
        )
        if position is None:
            return None

        profile = self.portfolio_service.get_strategy_profile(
            account_id=account_id,
            symbol=target,
        ) or {}

        concentration_threshold = float(
            profile.get("position_limit_pct")
            if profile.get("position_limit_pct") is not None
            else getattr(self.config, "portfolio_risk_concentration_alert_pct", 35.0)
        )
        stop_loss_threshold = float(
            getattr(self.config, "portfolio_risk_stop_loss_alert_pct", 10.0)
        )
        stop_loss_near_ratio = float(
            getattr(self.config, "portfolio_risk_stop_loss_near_ratio", 0.8)
        )
        stop_loss_near_threshold = stop_loss_threshold * stop_loss_near_ratio

        market_value = float(position.get("market_value_base") or 0.0)
        account_market_value = float(account.get("total_market_value") or 0.0)
        position_weight_pct = (
            market_value / account_market_value * 100.0
            if account_market_value > 0
            else None
        )
        pnl_pct_raw = position.get("unrealized_pnl_pct")
        pnl_pct = float(pnl_pct_raw) if pnl_pct_raw is not None else None
        loss_pct = max(0.0, -pnl_pct) if pnl_pct is not None else None
        last_price = float(position.get("last_price") or 0.0)
        price_available = bool(position.get("price_available", True)) and (
            str(position.get("price_source") or "") != "missing"
        ) and last_price > 0
        price_stale = bool(position.get("price_stale")) if price_available else False
        concentration_triggered = (
            position_weight_pct is not None
            and position_weight_pct >= concentration_threshold
        )
        stop_loss_triggered = (
            loss_pct is not None and loss_pct >= stop_loss_threshold
        )
        stop_loss_near = (
            loss_pct is not None
            and loss_pct >= stop_loss_near_threshold
            and not stop_loss_triggered
        )

        supporting_evidence: List[Dict[str, str]] = []
        opposing_evidence: List[Dict[str, str]] = []
        risk_triggers: List[Dict[str, str]] = []
        watch_items: List[Dict[str, str]] = []

        if price_available and not price_stale:
            supporting_evidence.append({
                "code": "price_fresh",
                "message": "价格数据可用且未标记陈旧。",
                "source": "portfolio_snapshot.position.price",
            })
        if pnl_pct is not None and pnl_pct >= 0:
            supporting_evidence.append({
                "code": "price_not_below_cost",
                "message": "当前估值价格不低于持仓成本。",
                "source": "portfolio_snapshot.position.unrealized_pnl_pct",
            })
        if price_available and position_weight_pct is not None and not concentration_triggered:
            supporting_evidence.append({
                "code": "within_concentration_limit",
                "message": "该持仓未触发账户单一持仓集中度阈值。",
                "source": "portfolio_rule.concentration",
            })
        if profile:
            supporting_evidence.append({
                "code": "strategy_profile_configured",
                "message": "该持仓已配置个人交易计划，可用于纪律检查。",
                "source": "portfolio_strategy_profile",
            })

        if not price_available:
            opposing_evidence.append({
                "code": "price_unavailable",
                "message": "当前持仓缺少可用价格，盈亏和风险判断不完整。",
                "source": "portfolio_snapshot.position.price",
            })
            risk_triggers.append({
                "code": "price_unavailable",
                "message": "价格不可用。",
                "source": "portfolio_snapshot.position.price",
            })
            watch_items.append({
                "code": "resolve_missing_price",
                "message": "补齐行情后重新生成诊断。",
                "source": "portfolio_snapshot.position.price",
            })
        elif price_stale:
            opposing_evidence.append({
                "code": "price_stale",
                "message": "当前估值使用陈旧价格。",
                "source": "portfolio_snapshot.position.price_date",
            })
            risk_triggers.append({
                "code": "price_stale",
                "message": "价格数据已陈旧。",
                "source": "portfolio_snapshot.position.price_date",
            })
            watch_items.append({
                "code": "refresh_stale_price",
                "message": "下一交易日确认最新收盘价或实时价。",
                "source": "portfolio_snapshot.position.price_date",
            })

        if pnl_pct is not None and pnl_pct < 0:
            opposing_evidence.append({
                "code": "price_below_cost",
                "message": "当前估值价格低于持仓成本。",
                "source": "portfolio_snapshot.position.unrealized_pnl_pct",
            })
        if concentration_triggered:
            opposing_evidence.append({
                "code": "concentration_limit_exceeded",
                "message": "该持仓触发账户单一持仓集中度阈值。",
                "source": "portfolio_rule.concentration",
            })
            risk_triggers.append({
                "code": "concentration_limit_exceeded",
                "message": "单一持仓集中度超限。",
                "source": "portfolio_rule.concentration",
            })
            watch_items.append({
                "code": "review_position_concentration",
                "message": "复核该持仓的仓位上限和减仓条件。",
                "source": "portfolio_rule.concentration",
            })
        if stop_loss_triggered:
            opposing_evidence.append({
                "code": "stop_loss_triggered",
                "message": "浮亏幅度已触发确定性止损阈值。",
                "source": "portfolio_rule.stop_loss",
            })
            risk_triggers.append({
                "code": "stop_loss_triggered",
                "message": "止损阈值已触发。",
                "source": "portfolio_rule.stop_loss",
            })
            watch_items.append({
                "code": "review_stop_loss_execution",
                "message": "检查原交易计划并记录止损规则的执行决定。",
                "source": "portfolio_rule.stop_loss",
            })
        elif stop_loss_near:
            opposing_evidence.append({
                "code": "stop_loss_near",
                "message": "浮亏幅度接近确定性止损阈值。",
                "source": "portfolio_rule.stop_loss",
            })
            risk_triggers.append({
                "code": "stop_loss_near",
                "message": "接近止损阈值。",
                "source": "portfolio_rule.stop_loss",
            })
            watch_items.append({
                "code": "monitor_stop_loss_distance",
                "message": "下一交易日检查价格与止损阈值距离。",
                "source": "portfolio_rule.stop_loss",
            })

        if not price_available:
            status = "data_incomplete"
        elif stop_loss_triggered:
            status = "risk_triggered"
        elif price_stale or concentration_triggered or stop_loss_near:
            status = "attention"
        else:
            status = "stable"

        missing_data = []
        if not profile.get("buy_thesis"):
            missing_data.append("buy_thesis")
        if not profile.get("target_holding_period"):
            missing_data.append("target_holding_period")
        if not profile.get("invalidation_condition"):
            missing_data.append("invalidation_condition")
        if profile.get("risk_budget_pct") is None:
            missing_data.append("risk_budget")
        if profile.get("position_limit_pct") is None:
            missing_data.append("position_limit")
        if not profile.get("add_conditions") and not profile.get("reduce_conditions"):
            missing_data.append("add_reduce_conditions")
        if not price_available:
            missing_data.append("current_price")

        return {
            "account_id": int(account_id),
            "account_name": str(account.get("account_name") or ""),
            "symbol": str(position.get("symbol") or target),
            "status": status,
            "valid_date": as_of_date.isoformat(),
            "generation_mode": "deterministic_rules",
            "strategy_profile": profile,
            "facts": {
                "market": position.get("market"),
                "currency": position.get("currency"),
                "quantity": float(position.get("quantity") or 0.0),
                "avg_cost": float(position.get("avg_cost") or 0.0),
                "last_price": last_price if price_available else None,
                "price_source": position.get("price_source"),
                "price_provider": position.get("price_provider"),
                "price_date": position.get("price_date"),
                "price_available": price_available,
                "price_stale": price_stale,
            },
            "calculations": {
                "total_cost": float(position.get("total_cost") or 0.0),
                "market_value": market_value if price_available else None,
                "unrealized_pnl": (
                    float(position.get("unrealized_pnl_base") or 0.0)
                    if price_available
                    else None
                ),
                "unrealized_pnl_pct": pnl_pct if price_available else None,
                "position_weight_pct": (
                    round(position_weight_pct, 4)
                    if position_weight_pct is not None and price_available
                    else None
                ),
            },
            "thresholds": {
                "concentration_alert_pct": concentration_threshold,
                "stop_loss_alert_pct": stop_loss_threshold,
                "stop_loss_near_pct": stop_loss_near_threshold,
            },
            "supporting_evidence": supporting_evidence,
            "opposing_evidence": opposing_evidence,
            "risk_triggers": risk_triggers,
            "watch_items": watch_items,
            "missing_data": missing_data,
        }

    def _build_decision_signal_risk(
        self,
        snapshot: Dict[str, Any],
    ) -> Dict[str, Any]:
        try:
            held_positions = self._held_position_identities(snapshot)
            if not held_positions:
                return self._empty_decision_signal_risk(available=True)
            stock_identities = sorted({
                (position["market"], position["signal_stock_code"])
                for position in held_positions
            })

            defensive_actions = set(DEFENSIVE_DECISION_SIGNAL_ACTIONS)
            latest_by_identity: Dict[Tuple[str, str], Dict[str, Any]] = {}
            page = 1
            while True:
                response = self.decision_signal_service.list_signals(
                    stock_identities=stock_identities,
                    status="active",
                    page=page,
                    page_size=100,
                )
                items = response.get("items", []) if isinstance(response, dict) else []
                for item in items:
                    if str(item.get("action") or "") not in defensive_actions:
                        continue
                    key = (
                        str(item.get("market") or "").strip().lower(),
                        str(item.get("stock_code") or "").strip().upper(),
                    )
                    if key[0] and key[1] and key not in latest_by_identity:
                        latest_by_identity[key] = item
                total = int(response.get("total", 0) or 0) if isinstance(response, dict) else 0
                if page * 100 >= total or not items:
                    break
                page += 1

            risk_items: List[Dict[str, Any]] = []
            action_counts = {action: 0 for action in DEFENSIVE_DECISION_SIGNAL_ACTIONS}
            seen: set[Tuple[Optional[int], str, str, int]] = set()
            for position in held_positions:
                signal = latest_by_identity.get((position["market"], position["signal_stock_code"]))
                summary = summarize_decision_signal(signal)
                if not summary:
                    continue
                action = str(summary.get("action") or "")
                if action not in action_counts:
                    continue
                signal_id = int(summary.get("id") or 0)
                dedupe_key = (position["account_id"], position["market"], position["signal_stock_code"], signal_id)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                action_counts[action] += 1
                risk_items.append({
                    "account_id": position["account_id"],
                    "symbol": position["symbol"],
                    "market": position["market"],
                    "signal": summary,
                })

            return {
                "available": True,
                "total": len(risk_items),
                "actions": action_counts,
                "items": risk_items,
            }
        except Exception:
            logger.exception("[PortfolioRiskService] Decision signal risk unavailable")
            return self._empty_decision_signal_risk(available=False)

    @staticmethod
    def _empty_decision_signal_risk(*, available: bool) -> Dict[str, Any]:
        return {
            "available": available,
            "total": 0,
            "actions": {action: 0 for action in DEFENSIVE_DECISION_SIGNAL_ACTIONS},
            "items": [],
        }

    @staticmethod
    def _held_position_identities(snapshot: Dict[str, Any]) -> List[Dict[str, Any]]:
        positions: List[Dict[str, Any]] = []
        for account in snapshot.get("accounts", []) or []:
            account_id = account.get("account_id")
            for pos in account.get("positions", []) or []:
                symbol = str(pos.get("symbol") or "").strip().upper()
                market = str(pos.get("market") or "").strip().lower()
                if not symbol or market not in {"cn", "hk", "us"}:
                    continue
                signal_stock_code = DecisionSignalService.normalize_stock_code_for_signal(symbol, market=market)
                positions.append({
                    "account_id": account_id,
                    "symbol": symbol,
                    "market": market,
                    "signal_stock_code": signal_stock_code,
                })
        return positions

    def _ensure_drawdown_snapshot_window(
        self,
        *,
        account_id: Optional[int],
        as_of_date: date,
        cost_method: str,
        lookback_days: int,
        include_realtime: bool,
    ) -> None:
        if lookback_days <= 0:
            return

        start_date = self._resolve_backfill_start_date(
            account_id=account_id,
            as_of_date=as_of_date,
            lookback_days=lookback_days,
        )
        if start_date > as_of_date:
            return

        existing_rows = self.repo.list_daily_snapshots_for_risk(
            as_of=as_of_date,
            cost_method=cost_method,
            account_id=account_id,
            lookback_days=lookback_days,
        )
        if account_id is not None:
            existing_dates = {row.snapshot_date for row in existing_rows if int(row.account_id) == int(account_id)}
            current_date = start_date
            while current_date <= as_of_date:
                if current_date not in existing_dates:
                    self.portfolio_service.get_portfolio_snapshot(
                        account_id=account_id,
                        as_of=current_date,
                        cost_method=cost_method,
                        include_realtime=include_realtime,
                    )
                    existing_dates.add(current_date)
                current_date += timedelta(days=1)
            return

        account_ids = [int(account.id) for account in self.repo.list_accounts(include_inactive=False)]
        if not account_ids:
            return
        existing_pairs = {(int(row.account_id), row.snapshot_date) for row in existing_rows}
        current_date = start_date
        while current_date <= as_of_date:
            if not all((aid, current_date) in existing_pairs for aid in account_ids):
                self.portfolio_service.get_portfolio_snapshot(
                    account_id=None,
                    as_of=current_date,
                    cost_method=cost_method,
                    include_realtime=include_realtime,
                )
                for aid in account_ids:
                    existing_pairs.add((aid, current_date))
            current_date += timedelta(days=1)

    def _resolve_backfill_start_date(
        self,
        *,
        account_id: Optional[int],
        as_of_date: date,
        lookback_days: int,
    ) -> date:
        window_start = as_of_date - timedelta(days=lookback_days)
        if account_id is not None:
            first_activity = self.repo.get_first_activity_date(account_id=account_id, as_of=as_of_date)
            return max(window_start, first_activity or as_of_date)

        first_activity_candidates: List[date] = []
        for account in self.repo.list_accounts(include_inactive=False):
            first_activity = self.repo.get_first_activity_date(account_id=int(account.id), as_of=as_of_date)
            if first_activity is not None:
                first_activity_candidates.append(first_activity)
        if not first_activity_candidates:
            return as_of_date
        return max(window_start, min(first_activity_candidates))

    def _build_concentration(self, snapshot: Dict[str, Any], threshold_pct: float, *, as_of_date: date) -> Dict[str, Any]:
        total_mv = float(snapshot.get("total_market_value", 0.0) or 0.0)
        exposure_by_symbol: Dict[str, float] = {}
        for account in snapshot.get("accounts", []):
            for pos in account.get("positions", []):
                symbol = str(pos.get("symbol") or "").strip().upper()
                if not symbol:
                    continue
                market_value = float(pos.get("market_value_base") or 0.0)
                valuation_currency = str(pos.get("valuation_currency") or account.get("base_currency") or "CNY")
                converted, _, _ = self.portfolio_service.convert_amount(
                    amount=market_value,
                    from_currency=valuation_currency,
                    to_currency="CNY",
                    as_of_date=as_of_date,
                )
                exposure_by_symbol[symbol] = exposure_by_symbol.get(symbol, 0.0) + converted

        rows = []
        for symbol, exposure in exposure_by_symbol.items():
            weight = (exposure / total_mv * 100.0) if total_mv > 0 else 0.0
            rows.append(
                {
                    "symbol": symbol,
                    "market_value_base": round(exposure, 6),
                    "weight_pct": round(weight, 4),
                    "is_alert": bool(weight >= threshold_pct),
                }
            )
        rows.sort(key=lambda item: item["market_value_base"], reverse=True)

        top_weight = rows[0]["weight_pct"] if rows else 0.0
        return {
            "total_market_value": round(total_mv, 6),
            "top_weight_pct": round(float(top_weight), 4),
            "alert": bool(top_weight >= threshold_pct),
            "top_positions": rows[:10],
        }

    def _build_sector_concentration(
        self,
        snapshot: Dict[str, Any],
        threshold_pct: float,
        *,
        as_of_date: date,
    ) -> Dict[str, Any]:
        total_mv = float(snapshot.get("total_market_value", 0.0) or 0.0)
        sector_exposure: Dict[str, float] = {}
        sector_symbols: Dict[str, set] = {}
        coverage = {
            "classified_count": 0,
            "unclassified_count": 0,
            "failed_count": 0,
        }
        errors: List[str] = []
        board_cache: Dict[Tuple[str, str], str] = {}

        for account in snapshot.get("accounts", []):
            for pos in account.get("positions", []):
                symbol = str(pos.get("symbol") or "").strip().upper()
                market = str(pos.get("market") or account.get("market") or "").strip().lower()
                if not symbol:
                    continue

                market_value = float(pos.get("market_value_base") or 0.0)
                valuation_currency = str(pos.get("valuation_currency") or account.get("base_currency") or "CNY")
                converted, _, _ = self.portfolio_service.convert_amount(
                    amount=market_value,
                    from_currency=valuation_currency,
                    to_currency="CNY",
                    as_of_date=as_of_date,
                )

                sector = self._resolve_primary_sector(
                    symbol=symbol,
                    market=market,
                    board_cache=board_cache,
                    coverage=coverage,
                    errors=errors,
                )
                sector_exposure[sector] = sector_exposure.get(sector, 0.0) + converted
                sector_symbols.setdefault(sector, set()).add(symbol)

        rows = []
        for sector, exposure in sector_exposure.items():
            weight = (exposure / total_mv * 100.0) if total_mv > 0 else 0.0
            rows.append(
                {
                    "sector": sector,
                    "market_value_base": round(exposure, 6),
                    "weight_pct": round(weight, 4),
                    "symbol_count": len(sector_symbols.get(sector, set())),
                    "is_alert": bool(weight >= threshold_pct),
                }
            )
        rows.sort(key=lambda item: item["market_value_base"], reverse=True)
        top_weight = rows[0]["weight_pct"] if rows else 0.0

        return {
            "total_market_value": round(total_mv, 6),
            "top_weight_pct": round(float(top_weight), 4),
            "alert": bool(top_weight >= threshold_pct),
            "top_sectors": rows[:10],
            "coverage": coverage,
            "errors": errors[:20],
        }

    def _resolve_primary_sector(
        self,
        *,
        symbol: str,
        market: str,
        board_cache: Dict[Tuple[str, str], str],
        coverage: Dict[str, int],
        errors: List[str],
    ) -> str:
        cache_key = (symbol, market)
        if cache_key in board_cache:
            return board_cache[cache_key]

        if market != "cn":
            coverage["unclassified_count"] += 1
            board_cache[cache_key] = "UNCLASSIFIED"
            return board_cache[cache_key]

        try:
            boards = self._fetch_belong_boards(symbol)
            sector_name = self._pick_primary_board_name(boards)
            if sector_name:
                coverage["classified_count"] += 1
                board_cache[cache_key] = sector_name
                return board_cache[cache_key]
        except Exception as exc:
            coverage["failed_count"] += 1
            errors.append(f"{symbol}: {exc}")

        coverage["unclassified_count"] += 1
        board_cache[cache_key] = "UNCLASSIFIED"
        return board_cache[cache_key]

    @classmethod
    def clear_belong_boards_cache_for_tests(cls) -> None:
        with cls._belong_boards_cache_lock:
            cls._belong_boards_cache.clear()

    def _fetch_belong_boards(self, symbol: str) -> List[Dict[str, Any]]:
        cls = self.__class__
        now = time.monotonic()
        with cls._belong_boards_cache_lock:
            cached = cls._belong_boards_cache.get(symbol)
        if cached and cached[0] > now:
            return [dict(item) for item in cached[1]]

        manager = self._get_data_manager()
        if manager is None:
            return []
        result = manager.get_belong_boards(symbol)
        if not isinstance(result, list):
            return []
        if result:
            # Empty or failed lookups are not cached, so the next request retries them.
            expires_at = time.monotonic() + cls._BELONG_BOARDS_CACHE_TTL_SECONDS
            with cls._belong_boards_cache_lock:
                for key in [key for key, value in cls._belong_boards_cache.items() if value[0] <= now]:
                    cls._belong_boards_cache.pop(key, None)
                cls._belong_boards_cache[symbol] = (
                    expires_at,
                    [dict(item) for item in result if isinstance(item, dict)],
                )
        return result

    @staticmethod
    def _pick_primary_board_name(boards: List[Dict[str, Any]]) -> Optional[str]:
        if not boards:
            return None

        preferred: Optional[str] = None
        fallback: Optional[str] = None
        for item in boards:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            if fallback is None:
                fallback = name
            type_text = str(item.get("type") or "").strip().lower()
            if "行业" in type_text or "industry" in type_text:
                preferred = name
                break
        return preferred or fallback

    def _get_data_manager(self):
        if self._data_manager is not None:
            return self._data_manager
        if self._data_manager_init_error:
            return None
        try:
            from data_provider import DataFetcherManager

            self._data_manager = DataFetcherManager()
            return self._data_manager
        except Exception as exc:  # pragma: no cover - fail-open initialization
            self._data_manager_init_error = str(exc)
            return None

    def _build_drawdown(
        self,
        *,
        account_id: Optional[int],
        as_of_date: date,
        cost_method: str,
        threshold_pct: float,
        lookback_days: int,
    ) -> Dict[str, Any]:
        rows = self.repo.list_daily_snapshots_for_risk(
            as_of=as_of_date,
            cost_method=cost_method,
            account_id=account_id,
            lookback_days=lookback_days,
        )
        if not rows:
            return {
                "series_points": 0,
                "max_drawdown_pct": 0.0,
                "current_drawdown_pct": 0.0,
                "alert": False,
                "fx_stale": False,
            }

        grouped: Dict[str, float] = {}
        stale_flag = False
        for row in rows:
            key = row.snapshot_date.isoformat()
            converted, stale, _ = self.portfolio_service.convert_amount(
                amount=float(row.total_equity or 0.0),
                from_currency=str(row.base_currency or "CNY"),
                to_currency="CNY",
                as_of_date=row.snapshot_date,
            )
            grouped[key] = grouped.get(key, 0.0) + converted
            stale_flag = stale_flag or stale or bool(row.fx_stale)

        series: List[Tuple[str, float]] = sorted(grouped.items(), key=lambda item: item[0])
        peak = 0.0
        max_drawdown = 0.0
        current_drawdown = 0.0
        for _, equity in series:
            peak = max(peak, equity)
            if peak <= 0:
                drawdown = 0.0
            else:
                drawdown = (peak - equity) / peak * 100.0
            max_drawdown = max(max_drawdown, drawdown)
            current_drawdown = drawdown

        return {
            "series_points": len(series),
            "max_drawdown_pct": round(max_drawdown, 4),
            "current_drawdown_pct": round(current_drawdown, 4),
            "alert": bool(max_drawdown >= threshold_pct),
            "fx_stale": stale_flag,
        }

    @staticmethod
    def _build_stop_loss(snapshot: Dict[str, Any], thresholds: Dict[str, Any]) -> Dict[str, Any]:
        stop_loss_pct = float(thresholds["stop_loss_alert_pct"])
        near_ratio = float(thresholds["stop_loss_near_ratio"])
        near_threshold = stop_loss_pct * near_ratio

        warnings: List[Dict[str, Any]] = []
        for account in snapshot.get("accounts", []):
            for pos in account.get("positions", []):
                avg_cost = float(pos.get("avg_cost", 0.0) or 0.0)
                last_price = float(pos.get("last_price", 0.0) or 0.0)
                if avg_cost <= 0:
                    continue
                loss_pct = max(0.0, (avg_cost - last_price) / avg_cost * 100.0)
                if loss_pct < near_threshold:
                    continue
                warnings.append(
                    {
                        "account_id": account.get("account_id"),
                        "symbol": pos.get("symbol"),
                        "avg_cost": round(avg_cost, 8),
                        "last_price": round(last_price, 8),
                        "loss_pct": round(loss_pct, 4),
                        "near_threshold_pct": round(near_threshold, 4),
                        "is_triggered": bool(loss_pct >= stop_loss_pct),
                    }
                )

        warnings.sort(key=lambda item: item["loss_pct"], reverse=True)
        return {
            "near_alert": len(warnings) > 0,
            "triggered_count": sum(1 for item in warnings if item["is_triggered"]),
            "near_count": len(warnings),
            "items": warnings[:20],
        }
