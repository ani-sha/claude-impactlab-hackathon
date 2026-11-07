"""Affordable sale price for an owner home under California Health and Safety Code 50052.5(b).

Statute text (subdivision (b), owner housing assisted on or after Jan 1, 1991), read 2026-11-07:
  (1) extremely low: 30% x 30% of area median income (AMI) adjusted for family size appropriate for the unit
  (2) very low:      30% x 50% of AMI
  (3) lower:         30% x 70% of AMI
  (4) moderate:      35% x 110% of AMI (and not less than 28% of the household's gross income)
(f) AMI = as published by HCD under Section 50093.
(h) "family size appropriate to the unit" = bedrooms + 1 (studio 1, 1BR 2, 2BR 3, 3BR 4, 4BR 5).

"Affordable housing cost" includes mortgage principal and interest, property tax, insurance, HOA
dues and utilities (and similar); those cost inputs are ASSUMPTIONS the user can change.
"""
from .model import Line

STATUTE_URL = "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=HSC&sectionNum=50052.5"
STATUTE_SRC = "Cal. Health & Safety Code 50052.5(b),(h) (text read 2026-11-07 via codes.findlaw.com mirror; official: leginfo)"

# band -> (share of income, share of AMI)
BANDS = {
    "extremely_low": (0.30, 0.30, "50052.5(b)(1)"),
    "very_low": (0.30, 0.50, "50052.5(b)(2)"),
    "lower": (0.30, 0.70, "50052.5(b)(3)"),
    "moderate": (0.35, 1.10, "50052.5(b)(4)"),
}
BAND_LABELS = {"extremely_low": "Extremely low income", "very_low": "Very low income",
               "lower": "Lower income (≤80% AMI)", "moderate": "Moderate income (≤120% AMI)"}


def household_size_for_unit(bedrooms: int) -> int:
    """50052.5(h): studio=1 person, then bedrooms + 1."""
    return max(1, bedrooms + 1)


def monthly_payment_factor(annual_rate: float, years: int = 30) -> float:
    r = annual_rate / 12
    n = years * 12
    return r / (1 - (1 + r) ** -n) if r else 1 / n


def affordable_price(*, band: str, bedrooms: int, ami_by_size: dict, annual_rate: float,
                     down_payment_pct: float, property_tax_rate: float,
                     monthly_insurance: float, monthly_hoa: float, monthly_utilities: float,
                     ami_source: str = "") -> dict:
    """Return the max price a household in `band` can pay for a unit with `bedrooms`.

    Solves: cap = P&I(loan) + tax(price) + insurance + HOA + utilities,
    with loan = price * (1 - down). Closed form (no circularity):
      price = (cap - fixed) / ((1 - down) * k + tax_rate / 12)
    """
    share, ami_share, cite = BANDS[band]
    hh = household_size_for_unit(bedrooms)
    ami = ami_by_size.get(str(hh)) or ami_by_size.get(hh)
    if ami is None:
        return {"price": Line("Family price", None, "UNKNOWN", ami_source,
                              f"No AMI on file for a {hh}-person household")}
    annual_cap = share * ami_share * ami
    monthly_cap = annual_cap / 12
    fixed = monthly_insurance + monthly_hoa + monthly_utilities
    k = monthly_payment_factor(annual_rate)
    price = max(0.0, (monthly_cap - fixed) / ((1 - down_payment_pct) * k + property_tax_rate / 12))
    loan = price * (1 - down_payment_pct)
    return {
        "household_size": Line("Household size for unit", hh, "SOURCED", STATUTE_SRC,
                               f"{bedrooms}-bedroom unit → {hh} persons (50052.5(h))"),
        "ami": Line(f"Area median income, {hh}-person", ami, "SOURCED", ami_source),
        "monthly_cap": Line("Max monthly housing cost", monthly_cap, "DERIVED", STATUTE_SRC,
                            f"{share:.0%} × {ami_share:.0%} of AMI ÷ 12 ({cite})"),
        "loan": Line("Mortgage the family can carry", loan, "DERIVED", "",
                     f"30-yr fixed at {annual_rate:.2%}"),
        "price": Line("Family price (max affordable sale price)", price, "DERIVED", STATUTE_SRC,
                      f"{BAND_LABELS[band]}, {hh}-person household, rate {annual_rate:.2%}"),
    }
