import unittest

from pydantic import ValidationError

from src.services.portfolio_snapshot_review import (
    BrokerSnapshot,
    build_snapshot_review,
    render_snapshot_review,
)


class SnapshotReviewTest(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "observed_at": "2026-01-06T14:38:00+08:00",
            "currency": "CNY",
            "total_assets": "1000",
            "market_value": "600",
            "available_cash": "400",
            "withdrawable_cash": "100",
            "broker_total_pnl": "-250",
            "broker_day_pnl": "-25",
            "positions": [
                {
                    "symbol": "000001",
                    "name": "测试标的",
                    "quantity": 100,
                    "sellable": 75,
                    "broker_unit_cost": "8.50",
                    "snapshot_price": "6",
                    "market_value": "600",
                    "broker_pnl": "-250",
                }
            ],
        }

    def test_report_preserves_source_values_and_calculates_asset_weight(self):
        report = build_snapshot_review(BrokerSnapshot.model_validate(self.payload))
        self.assertEqual(report["source"]["price_status"], "intraday_snapshot")
        self.assertEqual(report["facts"]["positions"][0]["broker_unit_cost"], "8.50")
        self.assertEqual(report["calculations"]["market_value_to_assets_pct"], "60.00")
        self.assertEqual(report["calculations"]["positions"][0]["quantity_not_sellable"], 25)
        self.assertIn("`000001`", render_snapshot_review(report))

    def test_rejects_inconsistent_holdings(self):
        for field, value in (("sellable", 101), ("market_value", "601"), ("snapshot_price", "NaN")):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                position = {**self.payload["positions"][0], field: value}
                BrokerSnapshot.model_validate({**self.payload, "positions": [position]})

    def test_rejects_duplicates_missing_timezone_and_cross_currency_totals(self):
        for overrides in (
            {"positions": self.payload["positions"] * 2},
            {"observed_at": "2026-01-06T14:38:00"},
            {"currency": "HKD"},
            {"market_value": "601"},
        ):
            with self.subTest(overrides=overrides), self.assertRaises(ValidationError):
                BrokerSnapshot.model_validate({**self.payload, **overrides})
