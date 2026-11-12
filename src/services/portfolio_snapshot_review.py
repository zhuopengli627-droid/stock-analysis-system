"""Build a deterministic review from a user-provided broker snapshot."""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class SnapshotPosition(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    symbol: str = Field(pattern=r"^\d{6}$")
    name: str = Field(min_length=1)
    quantity: int = Field(gt=0, strict=True)
    sellable: int = Field(ge=0, strict=True)
    broker_unit_cost: Decimal
    snapshot_price: Decimal = Field(gt=0)
    market_value: Decimal = Field(gt=0, decimal_places=2)
    broker_pnl: Decimal = Field(decimal_places=2)

    @model_validator(mode="after")
    def validate_position(self):
        if self.sellable > self.quantity:
            raise ValueError("Sellable quantity exceeds position quantity")
        if self.market_value != (self.snapshot_price * self.quantity).quantize(Decimal("0.01")):
            raise ValueError("Position value does not match snapshot price and quantity")
        return self


class BrokerSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    observed_at: AwareDatetime
    currency: Literal["CNY"]
    total_assets: Decimal = Field(gt=0, decimal_places=2)
    market_value: Decimal = Field(ge=0, decimal_places=2)
    available_cash: Decimal = Field(ge=0, decimal_places=2)
    withdrawable_cash: Decimal = Field(ge=0, decimal_places=2)
    broker_total_pnl: Decimal = Field(decimal_places=2)
    broker_day_pnl: Decimal = Field(decimal_places=2)
    positions: list[SnapshotPosition]

    @model_validator(mode="after")
    def validate_positions(self):
        if len({position.symbol for position in self.positions}) != len(self.positions):
            raise ValueError("Duplicate position symbol")
        if sum(position.market_value for position in self.positions) != self.market_value:
            raise ValueError("Positions do not add up to reported market value")
        return self


def build_snapshot_review(snapshot: BrokerSnapshot) -> dict:
    positions = sorted(snapshot.positions, key=lambda position: position.market_value, reverse=True)
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {"kind": "user_broker_screenshot", "price_status": "intraday_snapshot"},
        "facts": snapshot.model_dump(mode="json"),
        "calculations": {
            "market_value_to_assets_pct": str(
                (snapshot.market_value / snapshot.total_assets * 100).quantize(Decimal("0.01"))
            ),
            "positions": [
                {
                    "symbol": position.symbol,
                    "weight_of_assets_pct": str(
                        (position.market_value / snapshot.total_assets * 100).quantize(Decimal("0.01"))
                    ),
                    "quantity_not_sellable": position.quantity - position.sellable,
                }
                for position in positions
            ],
        },
        "limitations": [
            "价格、成本及盈亏取自券商盘中截图。券商成本口径未经成交流水重算。",
            "持仓占比以截图总资产为分母。可用资金和可取资金采用各自的券商字段。",
            "缺少收盘行情、完整成交、交易费用及期初余额，无法验证收盘表现或累计投资收益。",
        ],
    }


def render_snapshot_review(review: dict) -> str:
    facts = review["facts"]
    calculations = review["calculations"]
    positions = {position["symbol"]: position for position in facts["positions"]}
    lines = [
        "# 持仓快照复盘",
        "",
        f"来源为用户提供的券商盘中截图，观察时间 {facts['observed_at']}，币种 {facts['currency']}。",
        "",
        "## 券商显示",
        "",
        f"- 总资产 {facts['total_assets']} 元，持仓市值 {facts['market_value']} 元。",
        f"- 可用资金 {facts['available_cash']} 元，可取资金 {facts['withdrawable_cash']} 元。",
        f"- 总盈亏 {facts['broker_total_pnl']} 元，当日盈亏 {facts['broker_day_pnl']} 元。",
        "",
        "## 持仓与占比",
        "",
        f"持仓市值占总资产 {calculations['market_value_to_assets_pct']}%。",
        "",
        "| 证券 | 持仓 | 可卖 | 券商成本 | 截图价 | 市值（元） | 总资产占比 | 券商盈亏（元） |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for metric in calculations["positions"]:
        position = positions[metric["symbol"]]
        name = " ".join(position["name"].split()).replace("|", "&#124;")
        lines.append(
            f"| {name} `{position['symbol']}` | {position['quantity']} | {position['sellable']} | "
            f"{position['broker_unit_cost']} | {position['snapshot_price']} | {position['market_value']} | "
            f"{metric['weight_of_assets_pct']}% | {position['broker_pnl']} |"
        )
    lines += ["", "## 数据限制", "", *(f"- {item}" for item in review["limitations"]), ""]
    return "\n".join(lines)
