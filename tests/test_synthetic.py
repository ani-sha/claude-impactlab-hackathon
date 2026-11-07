"""The organizers' synthetic deal must reproduce its $95k fundraising gap.
Source: travcjohnson/claude-impact-lab-uci lanes/3-fund-it/data/synthetic-example-deal.json (SYNTHETIC)."""
import json
from pathlib import Path

from engine.affordability import affordable_price, household_size_for_unit
from engine.model import Line
from engine.stack import build_stack, program_amount

DEAL = json.loads((Path(__file__).parent.parent / "data" / "synthetic_deal.json").read_text())


def L(name, v):
    return Line(name, v, "ASSUMPTION", "synthetic deal")


def test_synthetic_gap_is_95k():
    c = DEAL["cost_to_create"]
    costs = [L(k, c[k]["value"]) for k in ("land_and_building_purchase", "time_costs_while_waiting",
                                         "construction_and_repairs", "fees_design_legal_sales")]
    p = DEAL["paid_by"]
    programs = [{"name": "Public subsidies (placeholder)", "status": "confirmed", "side": "project",
                 "amount": L("subsidy", p["public_subsidies"]["value"])}]
    s = build_stack(costs, L("family", p["family_price"]["value"]), programs,
                    earned_income=L("rent", p["rent_earned_while_waiting"]["value"]))
    assert s["total_cost"] == 535_000
    assert s["fundraising_needed"] == 95_000


def test_unconfirmed_funds_are_not_counted():
    costs = [L("cost", 500_000)]
    programs = [{"name": "X", "status": "funds_unconfirmed", "side": "buyer", "amount": L("x", 100_000)}]
    s = build_stack(costs, L("family", 300_000), programs)
    assert s["fundraising_needed"] == 200_000


def test_household_size_rule():
    assert [household_size_for_unit(b) for b in range(5)] == [1, 2, 3, 4, 5]


def test_price_falls_when_rate_rises():
    kw = dict(band="lower", bedrooms=3, ami_by_size={"4": 100_000}, down_payment_pct=0.03,
              property_tax_rate=0.011, monthly_insurance=100, monthly_hoa=0, monthly_utilities=200)
    lo = affordable_price(annual_rate=0.0718, **kw)["price"].value
    hi = affordable_price(annual_rate=0.0740, **kw)["price"].value
    assert hi < lo
    # payment check: 30% x 70% x 100k / 12 = 1750/month total housing cost
    assert abs(affordable_price(annual_rate=0.0718, **kw)["monthly_cap"].value - 1750) < 1e-6


def test_pct_of_price_rule_with_cap():
    assert program_amount({"rule": {"type": "pct_of_price", "pct": 0.20, "cap": 150_000}}, 1_000_000) == 150_000
    assert program_amount({"rule": {}}, 1_000_000) is None
