"""Gap Stack + Cost of Delay: the funding gap on each affordable for-sale home in Orange County,
how much of it is time waiting on permits, and who can pay for the rest.

Run: streamlit run app.py
"""
import json
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from dotenv import load_dotenv

import memo
from engine.affordability import BAND_LABELS, BANDS, STATUTE_URL, affordable_price
from engine.model import Line
from engine.stack import build_stack, program_amount, time_cost

load_dotenv()
DATA = Path(__file__).parent / "data"
st.set_page_config(page_title="Gap Stack · OC affordable homes", page_icon="🏠", layout="wide")


@st.cache_data
def load():
    il = json.loads((DATA / "income_limits.json").read_text())
    tl = json.loads((DATA / "city_timelines.json").read_text())
    pr = json.loads((DATA / "programs.json").read_text())
    fu = json.loads((DATA / "oc_financing_used.json").read_text())
    pm = pd.read_csv(DATA / "pmms.csv", usecols=["date", "pmms30"]).dropna()
    pm["date"] = pd.to_datetime(pm["date"], format="%m/%d/%Y")
    pm = pm.sort_values("date")
    return il, tl, pr, fu, pm


il, tl, pr, fu, pm = load()
cities = {c["city"]: c for c in tl["cities"]}
AMI = il["by_household_size"]["median"]
AMI_SRC = f"{il['table']}, Orange County, revised {il['revision_date']} ({il['source_page']})"
PMMS_SRC = "Freddie Mac PMMS 30-yr fixed, weekly (PMMS_history.csv, downloaded 2026-11-07)"


def money(v):
    return "unknown" if v is None else f"${v:,.0f}"


def rate_on(date_str):
    d = pd.Timestamp(date_str)
    row = pm[pm["date"] <= d].iloc[-1]
    return float(row["pmms30"]) / 100, row["date"].date().isoformat()


latest_rate, latest_date = float(pm.iloc[-1]["pmms30"]) / 100, pm.iloc[-1]["date"].date().isoformat()

# ---------------------------------------------------------------- header
st.warning("**Prototype, not financial, legal or lending advice.** Every number shows its source or is "
           "tagged ASSUMPTION. Talk to a housing finance professional before deciding anything.", icon="⚠️")
st.title("Gap Stack + Cost of Delay")
st.caption("For the finance lead at a small Orange County nonprofit building for-sale homes: how big is the gap "
           "on each home, how much of it is time waiting on the city, and who can pay for the rest.")

# ---------------------------------------------------------------- sidebar inputs
with st.sidebar:
    st.header("The project")
    known_cities = sorted([c for c, r in cities.items() if r["label"] == "SOURCED"])
    city = st.selectbox("City", known_cities, index=known_cities.index("Santa Ana") if "Santa Ana" in known_cities else 0)
    homes = st.number_input("Number of homes", 1, 50, 8)
    bedrooms = st.selectbox("Bedrooms per home", [1, 2, 3, 4], index=2)
    band = st.selectbox("Buyer income band (HSC 50052.5)", list(BANDS), index=2, format_func=BAND_LABELS.get)

    st.header("Cost per home  ·  ASSUMPTION")
    st.caption("Defaults are the organizers' SYNTHETIC worked example. Replace with your deal's numbers.")
    land = st.number_input("Land and building purchase", 0, 3_000_000, 360_000, 5_000)
    build = st.number_input("Construction and repairs", 0, 3_000_000, 40_000, 5_000)
    fees = st.number_input("Fees, design, legal, sales", 0, 1_000_000, 50_000, 5_000)

    st.header("Carrying cost while waiting  ·  ASSUMPTION")
    acq_rate = st.number_input("Acquisition loan interest rate (%/yr)", 0.0, 20.0, 8.0, 0.25) / 100
    hold_tax = st.number_input("Property tax while holding (%/yr)", 0.0, 3.0, 1.1, 0.05) / 100
    hold_other = st.number_input("Insurance + management ($/month)", 0, 10_000, 250, 50)
    extra_months = st.number_input("Other waiting not in state data (months)", 0, 48, 0,
                                   help="Rezoning, design, funding rounds. State data only measures approval → permit.")

    st.header("Buyer's costs  ·  ASSUMPTION")
    rate_choice = st.selectbox("Mortgage rate", [f"Latest: {latest_rate:.2%} ({latest_date})", "Custom"])
    rate = latest_rate if rate_choice.startswith("Latest") else st.number_input("Rate (%)", 2.0, 12.0, 7.18, 0.01) / 100
    down = st.number_input("Down payment (%)", 0.0, 20.0, 3.0, 0.5) / 100
    ptax = st.number_input("Property tax (%/yr of price)", 0.0, 3.0, 1.1, 0.05) / 100
    ins = st.number_input("Home insurance ($/month)", 0, 2_000, 150, 10)
    hoa = st.number_input("HOA dues ($/month)", 0, 2_000, 0, 25)
    util = st.number_input("Utilities allowance ($/month)", 0, 1_000, 250, 10)
    earned = st.number_input("Earned income per home while waiting (e.g. rent)  ·  ASSUMPTION", 0, 500_000, 0, 5_000)

# ---------------------------------------------------------------- engine
aff_kw = dict(band=band, bedrooms=bedrooms, ami_by_size=AMI, down_payment_pct=down, property_tax_rate=ptax,
              monthly_insurance=ins, monthly_hoa=hoa, monthly_utilities=util, ami_source=AMI_SRC)
aff = affordable_price(annual_rate=rate, **aff_kw)
price = aff["price"]

monthly_carry = land * (acq_rate + hold_tax) / 12 + hold_other
crow = cities[city]
months_line = Line("Months approval → permit", crow["median_months_entitlement_to_permit"], crow["label"],
                   crow["source"], f"median of {crow['n_projects']} {crow['tenure']} projects")
months = (crow["median_months_entitlement_to_permit"] or 0) + extra_months
tcost = time_cost(months, monthly_carry, months_line)

costs = [Line("Land and building purchase", land, "ASSUMPTION"),
         tcost,
         Line("Construction and repairs", build, "ASSUMPTION"),
         Line("Fees, design, legal, sales", fees, "ASSUMPTION")]

# programs: rule-based amounts, or user-entered expected awards (ASSUMPTION)
if "awards" not in st.session_state:
    st.session_state.awards = {}
progs = []
for p in pr["programs"]:
    if p.get("city") and p["city"] != city:
        continue
    amt = program_amount(p, price.value or 0)
    if amt is not None:
        line = Line(p["name"], amt, "DERIVED", p["source_url"], p["terms_read"])
        status = p["status"]
    else:
        a = st.session_state.awards.get(p["name"], {"amount": 0, "letter": False})
        line = Line(p["name"], a["amount"] or None, "ASSUMPTION" if a["amount"] else "UNKNOWN",
                    p["source_url"], "Expected award entered by user" if a["amount"] else "Per-home amount not on page")
        status = "confirmed" if a["letter"] and a["amount"] else p["status"]
    progs.append({**p, "status": status, "amount": line})

stack = build_stack(costs, price, progs, Line("Earned income", earned, "ASSUMPTION"))
need = stack["fundraising_needed"]

# ---------------------------------------------------------------- headline
c1, c2, c3, c4 = st.columns(4)
c1.metric("Cost to create, per home", money(stack["total_cost"]))
c2.metric("Family price (by statute)", money(price.value),
          help=f"{aff['monthly_cap'].note}; {aff['household_size'].note}")
c3.metric("Of the cost: waiting on permits", money(tcost.value),
          help=tcost.note)
c4.metric("Left to fundraise, per home", money(need), help="After earned income and CONFIRMED programs only")
st.markdown(f"**Whole project ({homes} homes): {money(need * homes)} to fundraise**, of which "
            f"**{money(min(tcost.value or 0, need) * homes)}** is covered by time alone. "
            f"Time cost uses **{city}**'s median **{months_line.value} months** from approval to building permit "
            f"({crow['n_projects']} past projects, state APR data)" + (f" + {extra_months} months assumed." if extra_months else "."))

# ---------------------------------------------------------------- waterfall
names, vals, measures, texts = [], [], [], []
for l in costs:
    names.append(l.name); vals.append(l.value or 0); measures.append("relative")
    texts.append(f"{money(l.value)}<br>{'DATA×ASSUMPTION' if l.label == 'DERIVED' else l.label}")
names.append("Family price"); vals.append(-(price.value or 0)); measures.append("relative"); texts.append(f"−{money(price.value)}<br>statute")
for label, amt, line in stack["steps"]:
    names.append(label); vals.append(-amt); measures.append("relative"); texts.append(f"−{money(amt)}<br>{line.label}")
names.append("Left to fundraise"); vals.append(0); measures.append("total"); texts.append(money(need))
fig = go.Figure(go.Waterfall(x=names, y=vals, measure=measures, text=texts, textposition="outside",
                             increasing={"marker": {"color": "#6b3f2a"}}, decreasing={"marker": {"color": "#d0693b"}},
                             totals={"marker": {"color": "#2f6f4f"}}, connector={"line": {"color": "#bbb"}}))
fig.update_layout(title="One home's bill: cost up, then who pays it down", height=430, margin=dict(t=50, b=10),
                  yaxis_tickprefix="$", yaxis_tickformat=",.0f", showlegend=False)
st.plotly_chart(fig, use_container_width=True)

tabs = st.tabs(["💰 Who can pay (M01)", "⏱ Time cost by city", "📈 Rate moves (M02)", "🎁 Donor view (M03)",
                "✍️ Funder memo (Claude)", "🏗 What OC projects used", "📚 Sources"])

# ---------------------------------------------------------------- M01 programs
with tabs[0]:
    st.subheader("Programs you could stack")
    st.caption("Only **confirmed** money closes the gap. Funds that depend on a drawing or a competitive round stay "
               "out of the total until you have an award letter.")
    badge = {"confirmed": "🟢 confirmed", "funds_unconfirmed": "🟡 funds unconfirmed", "unknown": "⚪ unknown"}
    counted = {p["name"]: amt for p, amt in stack["counted"]}
    for p in progs:
        with st.container(border=True):
            a, b, c = st.columns([3, 2, 2])
            a.markdown(f"**{p['name']}**  \n{p['what']} · *{'helps the buyer' if p['side'] == 'buyer' else 'funds the project'}*  \n"
                       f"Terms read: {p['terms_read']}  \n[source]({p['source_url']}) · {p['caveat']}")
            b.markdown(f"{badge[p['status']]}  \nAmount: **{money(p['amount'].value)}** ({p['amount'].label})")
            c.markdown(f"Counted toward gap: **{money(counted.get(p['name'], 0))}**")
            if p.get("rule") is None:
                cur = st.session_state.awards.get(p["name"], {"amount": 0, "letter": False})
                x, y = st.columns(2)
                amt = x.number_input("Expected award per home (ASSUMPTION)", 0, 500_000, cur["amount"], 5_000, key="a" + p["name"])
                letter = y.checkbox("Award letter in hand", cur["letter"], key="l" + p["name"])
                if (amt, letter) != (cur["amount"], cur["letter"]):
                    st.session_state.awards[p["name"]] = {"amount": amt, "letter": letter}
                    st.rerun()
    st.caption("Not modeled: " + "; ".join(f"{e['name']} ({e['reason']})" for e in pr["excluded"]))

# ---------------------------------------------------------------- time
with tabs[1]:
    st.subheader("How long approval → building permit really takes, by city")
    known = sorted([r for r in tl["cities"] if r["label"] == "SOURCED"], key=lambda r: r["median_months_entitlement_to_permit"])
    other = st.selectbox("Compare with", [r["city"] for r in known if r["city"] != city],
                         index=[r["city"] for r in known if r["city"] != city].index("Anaheim") if city != "Anaheim" else 0)
    om = cities[other]["median_months_entitlement_to_permit"]
    diff = (om - crow["median_months_entitlement_to_permit"]) * monthly_carry
    st.markdown(f"Same project in **{other}** ({om} months, {cities[other]['n_projects']} projects) vs **{city}** "
                f"({crow['median_months_entitlement_to_permit']} months): **{money(abs(diff))} per home "
                f"{'more' if diff > 0 else 'less'}** in carrying cost, **{money(abs(diff) * homes)}** for {homes} homes.")
    bar = go.Figure(go.Bar(x=[r["median_months_entitlement_to_permit"] for r in known], y=[r["city"] for r in known],
                           orientation="h", text=[f"{r['median_months_entitlement_to_permit']} mo · n={r['n_projects']}" for r in known],
                           marker_color=["#d0693b" if r["city"] in (city, other) else "#c9b8ad" for r in known]))
    bar.update_layout(height=560, margin=dict(t=10), xaxis_title="median months, entitlement approved → building permit issued")
    st.plotly_chart(bar, use_container_width=True)
    unknown = [r["city"] for r in tl["cities"] if r["label"] != "SOURCED"]
    st.caption(f"Unknown (fewer than {tl['min_projects']} matched projects): {', '.join(unknown)}. "
               "Method: HCD APR Table A2 rows joined across report years by tracking ID / parcel; non-ADU; projects with a "
               "separate entitlement step. Same-day approvals (often by-right) are counted separately and excluded from the median. "
               "This measures one stretch of the 4-year timeline, not the whole thing.")

# ---------------------------------------------------------------- M02 rate
with tabs[2]:
    st.subheader("The rate moved. How much bigger is the gap?")
    r_old, d_old = rate_on("2026-10-08")
    r_new, d_new = rate_on("2026-11-05")
    p_old = affordable_price(annual_rate=r_old, **aff_kw)["price"].value
    p_new = affordable_price(annual_rate=r_new, **aff_kw)["price"].value
    a, b, c = st.columns(3)
    a.metric(f"Family price at {r_old:.2%} ({d_old})", money(p_old))
    b.metric(f"Family price at {r_new:.2%} ({d_new})", money(p_new), delta=f"{p_new - p_old:+,.0f}")
    c.metric(f"Gap change for {homes} homes", money(abs(p_new - p_old) * homes),
             delta=f"gap {'shrinks' if p_new > p_old else 'grows'}", delta_color="normal" if p_new > p_old else "inverse")
    st.caption(f"Source: {PMMS_SRC}. The family's monthly cost is capped by statute, so a lower rate lets the same "
               "payment carry a bigger loan; the gap moves dollar for dollar.")
    rr = [x / 1000 for x in range(550, 851, 25)]
    curve = [affordable_price(annual_rate=x, **aff_kw)["price"].value for x in rr]
    rf = go.Figure(go.Scatter(x=[f"{x:.2%}" for x in rr], y=curve, mode="lines+markers", line_color="#d0693b"))
    rf.update_layout(height=320, yaxis_tickprefix="$", yaxis_tickformat=",.0f", xaxis_title="30-yr rate",
                     yaxis_title="family price", margin=dict(t=10))
    st.plotly_chart(rf, use_container_width=True)

# ---------------------------------------------------------------- M03 donor
with tabs[3]:
    st.subheader("If I give, what does it actually pay for?")
    gift = st.number_input("Gift ($)", 0, 10_000_000, 25_000, 5_000)
    if need <= 0:
        st.success("This home is fully funded on paper; a gift would go to the next home.")
    else:
        months_bought = gift / monthly_carry if monthly_carry else 0
        st.markdown(f"- **{min(gift / need, 1):.0%}** of one home's remaining gap ({money(need)}).\n"
                    f"- Closes the gap on **{gift / need:.2f} homes** at this project's numbers.\n"
                    f"- Or: pays **{months_bought:.1f} months** of carrying cost while the project waits on permits "
                    f"({money(monthly_carry)}/month, ASSUMPTION).")
        st.caption("Gap and carrying cost come from the inputs on the left. Assumed inputs are labeled there.")

# ---------------------------------------------------------------- memo
with tabs[4]:
    st.subheader("One-page funder memo, drafted by Claude")
    st.caption("Claude writes the words; every number is passed in from the engine and must be copied exactly. "
               "A person reviews it. Nothing is sent.")
    facts = {
        "project": {"city": city, "homes": homes, "bedrooms": bedrooms, "buyer_band": BAND_LABELS[band]},
        "per_home": {
            "cost_lines": [{"name": l.name, "value": round(l.value or 0), "label": l.label, "note": l.note} for l in costs],
            "cost_total": round(stack["total_cost"]),
            "family_price": {"value": round(price.value or 0), "label": "SOURCED formula (HSC 50052.5) with ASSUMPTION buyer costs",
                             "rate": f"{rate:.2%}", "ami_source": AMI_SRC},
            "earned_income": {"value": earned, "label": "ASSUMPTION"},
            "programs_counted": [{"name": p["name"], "amount": round(a)} for p, a in stack["counted"]],
            "programs_not_counted": [{"name": p["name"], "why": why} for p, why in stack["held_out"]],
            "fundraising_needed": round(need),
        },
        "project_fundraising_needed": round(need * homes),
        "time": {"city_median_months_approval_to_permit": months_line.value, "n_projects": crow["n_projects"],
                 "extra_months_assumed": extra_months, "monthly_carrying_cost": round(monthly_carry),
                 "carrying_cost_label": "ASSUMPTION", "source": crow["source"]},
    }
    if not memo.available():
        sample = json.loads((DATA / "sample_memo.json").read_text(encoding="utf-8"))
        if json.loads(json.dumps(facts)) == sample["facts"]:
            st.info("Example draft written with Claude for these default inputs (no API key set, so live drafting is off).")
            with st.container(border=True):
                st.markdown(sample["memo"])
        else:
            st.info("Live drafting needs ANTHROPIC_API_KEY in a .env file. The example draft matches the default "
                    "inputs only; you changed them. The facts Claude would receive:")
        with st.expander("Facts passed to Claude (every number comes from the engine)"):
            st.json(facts)
    elif st.button("Draft memo with Claude", type="primary"):
        with st.spinner("Claude is drafting…"):
            st.session_state.memo = memo.draft_memo(facts)
    if st.session_state.get("memo"):
        st.markdown(st.session_state.memo)
        st.download_button("Download draft (.md)", st.session_state.memo, "funder-memo-draft.md")

# ---------------------------------------------------------------- financing used
with tabs[5]:
    st.subheader("Financing real Orange County projects reported to the state")
    st.caption(fu["about"] + " " + fu["source"])
    st.dataframe(pd.DataFrame(fu["programs"]).rename(columns={"name": "program (as reported)", "projects": "projects"}),
                 hide_index=True, use_container_width=True)

# ---------------------------------------------------------------- sources
with tabs[6]:
    st.subheader("Every number, and where it comes from")
    rows = [
        ("Max monthly housing cost", money(aff["monthly_cap"].value), "SOURCED (formula)", f"{aff['monthly_cap'].note}; {STATUTE_URL}"),
        ("Household size for unit", aff["household_size"].value, "SOURCED", aff["household_size"].note),
        ("Area median income", money(aff["ami"].value), "SOURCED", AMI_SRC + " · " + il["source_url"]),
        ("Mortgage rate", f"{rate:.2%}", "SOURCED" if rate_choice.startswith("Latest") else "ASSUMPTION", PMMS_SRC),
        ("Family price", money(price.value), "DERIVED", price.note),
        ("Months approval → permit", months_line.value, months_line.label, f"{months_line.note}; {crow['source']}"),
        ("Monthly carrying cost", money(monthly_carry), "ASSUMPTION", "land × (loan rate + property tax) ÷ 12 + insurance/management"),
        ("Time cost", money(tcost.value), "DERIVED", tcost.note),
        ("Land, construction, fees", f"{money(land)} / {money(build)} / {money(fees)}", "ASSUMPTION", "Synthetic worked example defaults"),
        ("Down payment, tax, insurance, HOA, utilities", f"{down:.1%} / {ptax:.2%} / ${ins} / ${hoa} / ${util}", "ASSUMPTION", "User inputs"),
    ]
    st.dataframe(pd.DataFrame([tuple(map(str, r)) for r in rows], columns=["item", "value", "label", "source / basis"]), hide_index=True, use_container_width=True)
    st.caption("Checked 2026-11-07. Statute text read via a public mirror because leginfo blocks automated access; "
               "confirm against the official page. Program terms per the organizers' DATA-SOURCES list.")
