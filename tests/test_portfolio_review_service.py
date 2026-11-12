from __future__ import annotations

import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import pandas as pd
from fastapi.testclient import TestClient

import src.auth as auth
from api.app import create_app
from src.config import Config
from src.services.portfolio_review_service import PortfolioReviewService
from src.services.portfolio_risk_service import PortfolioRiskService
from src.services.portfolio_service import PortfolioService
from src.storage import DatabaseManager


class PortfolioReviewServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        auth._auth_enabled = None
        self.temp_dir = tempfile.TemporaryDirectory()
        data_dir = Path(self.temp_dir.name)
        self.db_path = data_dir / "portfolio_review.db"
        self.env_path = data_dir / ".env"
        self.env_path.write_text(
            f"ADMIN_AUTH_ENABLED=false\nDATABASE_PATH={self.db_path}\nGEMINI_API_KEY=test\n",
            encoding="utf-8",
        )
        os.environ["ENV_FILE"] = str(self.env_path)
        os.environ["DATABASE_PATH"] = str(self.db_path)
        Config.reset_instance()
        DatabaseManager.reset_instance()
        self.db = DatabaseManager.get_instance()
        self.portfolio = PortfolioService()
        self.board_patch = patch.object(PortfolioRiskService, "_fetch_belong_boards", return_value=[])
        self.board_patch.start()
        account = self.portfolio.create_account(name="Main", broker="Demo", market="cn", base_currency="CNY")
        self.account_id = account["id"]
        self.portfolio.record_cash_ledger(
            account_id=self.account_id,
            event_date=date(2026, 1, 1),
            direction="in",
            amount=2000,
            currency="CNY",
        )
        self.portfolio.record_trade(
            account_id=self.account_id,
            symbol="000001",
            trade_date=date(2026, 1, 1),
            side="buy",
            quantity=10,
            price=100,
            market="cn",
            currency="CNY",
        )
        self.db.save_daily_data(
            pd.DataFrame([{
                "date": date(2026, 1, 2),
                "open": 80,
                "high": 80,
                "low": 80,
                "close": 80,
                "volume": 1,
                "amount": 80,
                "pct_chg": 0,
            }]),
            code="000001",
            data_source="portfolio-review-test",
        )
        self.client = TestClient(create_app(static_dir=data_dir / "empty-static"))

    def tearDown(self) -> None:
        self.board_patch.stop()
        DatabaseManager.reset_instance()
        Config.reset_instance()
        os.environ.pop("ENV_FILE", None)
        os.environ.pop("DATABASE_PATH", None)
        self.temp_dir.cleanup()

    def test_review_versions_are_append_only_and_traceable(self) -> None:
        service = PortfolioReviewService(portfolio_service=self.portfolio)
        first = service.create_review(
            account_id=self.account_id,
            review_date=date(2026, 1, 2),
            include_realtime=False,
        )
        second = service.create_review(
            account_id=self.account_id,
            review_date=date(2026, 1, 2),
            include_realtime=False,
        )

        self.assertEqual((first["version"], second["version"]), (1, 2))
        self.assertEqual(first["payload"]["generation_mode"], "rules")
        position = first["payload"]["facts"]["positions"][0]
        self.assertEqual(position["price_provider"], "portfolio-review-test")
        self.assertEqual(position["price_date"], "2026-01-02")
        self.assertEqual(first["payload"]["rule_findings"]["loss_over_10_pct"], ["000001"])
        self.assertIn("## 数据限制", first["markdown"])
        listed = service.list_reviews(account_id=self.account_id)
        self.assertEqual(listed["total"], 2)
        self.assertEqual([item["version"] for item in listed["items"]], [2, 1])

    def test_review_api_generates_lists_and_reads_content(self) -> None:
        created = self.client.post(
            "/api/v1/portfolio/reviews",
            json={
                "account_id": self.account_id,
                "review_date": "2026-01-02",
                "cost_method": "fifo",
                "include_realtime": False,
            },
        )
        self.assertEqual(created.status_code, 200, created.text)
        review_id = created.json()["id"]

        listed = self.client.get(
            "/api/v1/portfolio/reviews",
            params={"account_id": self.account_id, "date_from": "2026-01-02", "date_to": "2026-01-02"},
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(listed.json()["total"], 1)
        detail = self.client.get(f"/api/v1/portfolio/reviews/{review_id}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertIn("# 2026-01-02 持仓复盘", detail.json()["markdown"])

        invalid_range = self.client.get(
            "/api/v1/portfolio/reviews",
            params={"date_from": "2026-01-03", "date_to": "2026-01-02"},
        )
        self.assertEqual(invalid_range.status_code, 400)
        self.assertEqual(self.client.get("/api/v1/portfolio/reviews/999999").status_code, 404)


if __name__ == "__main__":
    unittest.main()
