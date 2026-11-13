"""Deterministic position-diagnosis rules."""

from __future__ import annotations

import unittest
from datetime import date
from types import SimpleNamespace

from src.services.portfolio_risk_service import PortfolioRiskService


class _PortfolioServiceStub:
    def __init__(self, snapshot, profile=None):
        self.snapshot = snapshot
        self.profile = profile or {}

    @staticmethod
    def _normalize_symbol_for_position(symbol: str) -> str:
        return str(symbol or "").strip().upper()

    def get_portfolio_snapshot(self, **_kwargs):
        return self.snapshot

    def get_strategy_profile(self, **_kwargs):
        return dict(self.profile)


def _snapshot(*, pnl_pct=-5.0, price_available=True, price_stale=False, market_value=60.0):
    return {
        "accounts": [
            {
                "account_id": 7,
                "account_name": "Main",
                "total_market_value": 100.0,
                "positions": [
                    {
                        "symbol": "600519",
                        "market": "cn",
                        "currency": "CNY",
                        "quantity": 10.0,
                        "avg_cost": 10.0,
                        "total_cost": 100.0,
                        "last_price": 6.0 if price_available else 0.0,
                        "market_value_base": market_value if price_available else 0.0,
                        "unrealized_pnl_base": -40.0 if price_available else 0.0,
                        "unrealized_pnl_pct": pnl_pct if price_available else None,
                        "price_source": "history_close" if price_available else "missing",
                        "price_provider": "unit-test" if price_available else None,
                        "price_date": "2026-01-03" if price_available else None,
                        "price_available": price_available,
                        "price_stale": price_stale,
                    }
                ],
            }
        ]
    }


class PortfolioPositionDiagnosisTestCase(unittest.TestCase):
    def _service(self, snapshot, profile=None):
        config = SimpleNamespace(
            portfolio_risk_concentration_alert_pct=35.0,
            portfolio_risk_stop_loss_alert_pct=10.0,
            portfolio_risk_stop_loss_near_ratio=0.8,
        )
        return PortfolioRiskService(
            repo=SimpleNamespace(),
            portfolio_service=_PortfolioServiceStub(snapshot, profile),
            decision_signal_service=SimpleNamespace(),
            config=config,
        )

    def test_reports_concentration_and_stop_loss_as_rule_triggers(self):
        diagnosis = self._service(_snapshot(pnl_pct=-12.0)).get_position_diagnosis(
            account_id=7,
            symbol="600519",
            as_of=date(2026, 1, 3),
        )

        self.assertIsNotNone(diagnosis)
        assert diagnosis is not None
        self.assertEqual(diagnosis["status"], "risk_triggered")
        self.assertEqual(diagnosis["valid_date"], "2026-01-03")
        self.assertEqual(diagnosis["calculations"]["position_weight_pct"], 60.0)
        trigger_codes = {item["code"] for item in diagnosis["risk_triggers"]}
        self.assertEqual(
            trigger_codes,
            {"concentration_limit_exceeded", "stop_loss_triggered"},
        )
        self.assertIn("buy_thesis", diagnosis["missing_data"])
        self.assertEqual(diagnosis["generation_mode"], "deterministic_rules")

    def test_missing_price_degrades_without_fake_valuation(self):
        diagnosis = self._service(
            _snapshot(price_available=False, market_value=0.0)
        ).get_position_diagnosis(
            account_id=7,
            symbol="600519",
            as_of=date(2026, 1, 3),
        )

        self.assertIsNotNone(diagnosis)
        assert diagnosis is not None
        self.assertEqual(diagnosis["status"], "data_incomplete")
        self.assertIsNone(diagnosis["calculations"]["market_value"])
        self.assertIsNone(diagnosis["calculations"]["unrealized_pnl_pct"])
        self.assertIn("current_price", diagnosis["missing_data"])
        self.assertEqual(
            [item["code"] for item in diagnosis["risk_triggers"]],
            ["price_unavailable"],
        )

    def test_returns_none_when_account_or_position_is_not_held(self):
        service = self._service(_snapshot())

        self.assertIsNone(service.get_position_diagnosis(account_id=8, symbol="600519"))
        self.assertIsNone(service.get_position_diagnosis(account_id=7, symbol="000001"))

    def test_strategy_profile_replaces_default_position_limit(self):
        profile = {
            "buy_thesis": "长期需求改善",
            "target_holding_period": "6-12 months",
            "invalidation_condition": "核心收入下降",
            "risk_budget_pct": 3.0,
            "position_limit_pct": 70.0,
            "add_conditions": "估值回落",
            "reduce_conditions": "逻辑失效",
        }
        diagnosis = self._service(_snapshot(pnl_pct=5.0), profile).get_position_diagnosis(
            account_id=7,
            symbol="600519",
            as_of=date(2026, 1, 3),
        )

        self.assertIsNotNone(diagnosis)
        assert diagnosis is not None
        self.assertEqual(diagnosis["status"], "stable")
        self.assertEqual(diagnosis["missing_data"], [])
        self.assertEqual(diagnosis["thresholds"]["concentration_alert_pct"], 70.0)
        self.assertEqual(diagnosis["strategy_profile"]["buy_thesis"], "长期需求改善")


if __name__ == "__main__":
    unittest.main()
