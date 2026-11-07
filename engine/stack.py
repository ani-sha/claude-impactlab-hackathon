"""The $0 equation: family price + subsidies + earned income + fundraising - cost to create = 0.

All arithmetic happens here, in code. Claude never computes a number.
"""
from .model import Line


def time_cost(months: float | None, monthly_carrying_cost: float, months_line: Line | None = None) -> Line:
    """Lane 2: cost of waiting = months to permit x monthly carrying cost per home (ASSUMPTION input)."""
    if months is None:
        return Line("Time costs while waiting", None, "UNKNOWN", "",
                    "Months to permit unknown for this city")
    src = months_line.source if months_line else ""
    return Line("Time costs while waiting", months * monthly_carrying_cost, "DERIVED", src,
                f"{months:.1f} months × ${monthly_carrying_cost:,.0f}/month carrying cost (ASSUMPTION: "
                "loan interest, taxes, insurance, management)")


def program_amount(program: dict, price: float) -> float | None:
    """Amount a program contributes per home, ONLY from rules read on the program page.
    Returns None when the page gives no usable per-home amount (the UI then asks the user)."""
    rule = program.get("rule") or {}
    if rule.get("type") == "pct_of_price":
        amt = price * rule["pct"]
        if rule.get("cap") is not None:
            amt = min(amt, rule["cap"])
        return amt
    return None


def build_stack(cost_lines: list[Line], family_price: Line, programs: list[dict],
                earned_income: Line | None = None) -> dict:
    """programs: [{name, status, side, amount(Line)}] already resolved to a per-home amount.

    Only programs with status 'confirmed' count toward closing the gap. 'funds_unconfirmed'
    and 'unknown' are shown but kept OUT of the total (a funder would not count them either).
    """
    total_cost = sum(l.value for l in cost_lines if l.known)
    unknown_costs = [l.name for l in cost_lines if not l.known]
    gap_before = total_cost - (family_price.value or 0)
    remaining = gap_before
    steps = []
    if earned_income and earned_income.known and earned_income.value:
        remaining -= earned_income.value
        steps.append(("Earned income", earned_income.value, earned_income))
    counted, held_out = [], []
    for p in programs:
        amt: Line = p["amount"]
        if not amt.known or not amt.value:
            held_out.append((p, "no amount"))
            continue
        if p["status"] != "confirmed":
            held_out.append((p, p["status"]))
            continue
        use = min(amt.value, max(remaining, 0))
        remaining -= use
        counted.append((p, use))
        steps.append((p["name"], use, amt))
    return {
        "total_cost": total_cost,
        "unknown_costs": unknown_costs,
        "gap_before_subsidy": gap_before,
        "counted": counted,
        "held_out": held_out,
        "steps": steps,
        "fundraising_needed": max(remaining, 0),
        "surplus": max(-remaining, 0),
    }
