"""Gap Stack: how short is each affordable for-sale home in Orange County, how much of that is
time waiting on permits, and who can help pay the rest.

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
st.set_page_config(page_title="Gap Stack · OC affordable homes", page_icon="🏠", layout="wide",
                   initial_sidebar_state="collapsed")

BROWN, ORANGE, GREEN, MUTED = "#6b3f2a", "#d0693b", "#2f6f4f", "#c9b8ad"
st.markdown("""<style>
.big {font-size: 2.6rem; font-weight: 700; line-height: 1.1; margin: 0}
.sub {font-size: 1.05rem; opacity: .8; margin-top: .3rem}
.card {border-radius: 12px; padding: 14px 16px; height: 100%; border: 1px solid rgba(128,128,128,.25)}
.card h4 {margin: 0 0 4px 0; font-size: .95rem; font-weight: 600; opacity: .75}
.card .v {font-size: 1.7rem; font-weight: 700}
.card p {margin: 4px 0 0 0; font-size: .88rem; opacity: .8}
.tag {display: inline-block; font-size: .72rem; padding: 1px 7px; border-radius: 9px; margin-left: 4px;
      border: 1px solid rgba(128,128,128,.4)}
</style>""", unsafe_allow_html=True)

FRIENDLY = {"SOURCED": "public data", "ASSUMPTION": "our estimate", "DERIVED": "calculated", "UNKNOWN": "unknown"}
WHO = {"very_low": "Families earning up to 50% of area income",
       "lower": "Families earning up to 80% of area income",
       "moderate": "Families earning up to 120% of area income",
       "extremely_low": "Families earning up to 30% of area income"}


def tag(label):
    return f'<span class="tag">{FRIENDLY.get(label, label)}</span>'


@st.cache_data
def load():
    il = json.loads((DATA / "income_limits.json").read_text())
    tl = json.loads((DATA / "city_timelines.json").read_text())
    pr = json.loads((DATA / "programs.json").read_text())
    fu = json.loads((DATA / "oc_financing_used.json").read_text())
    pm = pd.read_csv(DATA / "pmms.csv", usecols=["date", "pmms30"]).dropna()
    pm["date"] = pd.to_datetime(pm["date"], format="%m/%d/%Y")
    return il, tl, pr, fu, pm.sort_values("date")


il, tl, pr, fu, pm = load()
cities = {c["city"]: c for c in tl["cities"]}
AMI = il["by_household_size"]["median"]
AMI_SRC = f"{il['table']}, Orange County, revised {il['revision_date']} ({il['source_page']})"
PMMS_SRC = "Freddie Mac PMMS 30-yr fixed, weekly (PMMS_history.csv, downloaded 2026-11-07)"
latest_rate, latest_date = float(pm.iloc[-1]["pmms30"]) / 100, pm.iloc[-1]["date"].date().isoformat()


def money(v):
    return "unknown" if v is None else f"${v:,.0f}"


def rate_on(date_str):
    row = pm[pm["date"] <= pd.Timestamp(date_str)].iloc[-1]
    return float(row["pmms30"]) / 100, row["date"].date().isoformat()


# ================================================================ side panel: assumptions (collapsed)
with st.sidebar:
    st.header("Costs & assumptions")
    st.caption("Our estimates. Defaults come from the organizers' made-up example deal. Replace them with your deal's numbers.")
    with st.expander("Cost to build, per home", expanded=True):
        land = st.number_input("Land and building purchase", 0, 3_000_000, 360_000, 5_000)
        build = st.number_input("Construction and repairs", 0, 3_000_000, 40_000, 5_000)
        fees = st.number_input("Fees, design, legal, sales", 0, 1_000_000, 50_000, 5_000)
    with st.expander("Cost of waiting"):
        acq_rate = st.number_input("Loan interest on the land (%/yr)", 0.0, 20.0, 8.0, 0.25) / 100
        hold_tax = st.number_input("Property tax while holding (%/yr)", 0.0, 3.0, 1.1, 0.05) / 100
        hold_other = st.number_input("Insurance + management ($/month)", 0, 10_000, 250, 50)
        extra_months = st.number_input("Other waiting, not in state data (months)", 0, 48, 0,
                                       help="Rezoning, design, funding rounds. State data only measures approval → permit.")
    with st.expander("Buyer's mortgage and costs"):
        use_custom = st.checkbox(f"Use a different rate than today's {latest_rate:.2%}")
        rate = st.number_input("Mortgage rate (%)", 2.0, 12.0, 7.18, 0.01) / 100 if use_custom else latest_rate
        down = st.number_input("Down payment (%)", 0.0, 20.0, 3.0, 0.5) / 100
        ptax = st.number_input("Property tax (%/yr)", 0.0, 3.0, 1.1, 0.05) / 100
        ins = st.number_input("Home insurance ($/month)", 0, 2_000, 150, 10)
        hoa = st.number_input("HOA dues ($/month)", 0, 2_000, 0, 25)
        util = st.number_input("Utilities ($/month)", 0, 1_000, 250, 10)
    with st.expander("Other income"):
        earned = st.number_input("Earned per home while waiting, e.g. rent", 0, 500_000, 0, 5_000)

# ================================================================ header + the four questions
st.caption("⚠️ Prototype. Not financial, legal or lending advice.")
st.title("How short is each home?")
st.markdown("For nonprofits building affordable for-sale homes in Orange County. Answer four questions; "
            "every number shows where it comes from.")

known_cities = sorted([c for c, r in cities.items() if r["label"] == "SOURCED"])
q1, q2, q3, q4 = st.columns([1.2, 0.8, 0.8, 1.6])
city = q1.selectbox("Which city?", known_cities, index=known_cities.index("Santa Ana"))
homes = q2.number_input("How many homes?", 1, 50, 8)
bedrooms = q3.selectbox("Bedrooms each?", [1, 2, 3, 4], index=2)
band = q4.selectbox("Who is buying?", ["lower", "very_low", "moderate", "extremely_low"], format_func=WHO.get)
st.caption("Costs and other assumptions: open the **›** panel on the left.")

# ================================================================ engine (all math in engine/)
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
costs = [Line("Land and building purchase", land, "ASSUMPTION"), tcost,
         Line("Construction and repairs", build, "ASSUMPTION"), Line("Fees, design, legal, sales", fees, "ASSUMPTION")]

if "awards" not in st.session_state:
    st.session_state.awards = {}
progs = []
for p in pr["programs"]:
    if p.get("city") and p["city"] != city:
        continue
    amt = program_amount(p, price.value or 0)
    if amt is not None:
        line, status = Line(p["name"], amt, "DERIVED", p["source_url"], p["terms_read"]), p["status"]
    else:
        a = st.session_state.awards.get(p["name"], {"amount": 0, "letter": False})
        line = Line(p["name"], a["amount"] or None, "ASSUMPTION" if a["amount"] else "UNKNOWN", p["source_url"],
                    "Expected award entered by user" if a["amount"] else "Per-home amount not on page")
        status = "confirmed" if a["letter"] and a["amount"] else p["status"]
    progs.append({**p, "status": status, "amount": line})

stack = build_stack(costs, price, progs, Line("Earned income", earned, "ASSUMPTION"))
need = stack["fundraising_needed"]
programs_total = sum(a for _, a in stack["counted"])

st.write("")
t_ans, t_help, t_city, t_rate, t_donor, t_memo, t_src = st.tabs(["🏠 Answer", "💰 Who can help pay", "⏱ Compare cities", "📈 If rates change", "🎁 For a donor", "✍️ Funder memo", "📚 Sources"])

# ================================================================ the answer
with t_ans:
    if need > 0:
        st.markdown(f'<p class="big">Each home is {money(need)} short.</p>'
                    f'<p class="sub">That is <b>{money(need * homes)}</b> to raise for {homes} homes in {city}, '
                    f'after what the family can pay and confirmed help.</p>', unsafe_allow_html=True)
    else:
        st.markdown(f'<p class="big">Each home pencils. 🎉</p><p class="sub">Surplus of {money(stack["surplus"])} per home.</p>',
                    unsafe_allow_html=True)

    st.write("")
    k1, k2, k3, k4 = st.columns(4)
    k1.markdown(f'<div class="card"><h4>It costs to build</h4><div class="v">{money(stack["total_cost"])}</div>'
                f'<p>land, construction, fees and waiting {tag("ASSUMPTION")}</p></div>', unsafe_allow_html=True)
    k2.markdown(f'<div class="card"><h4>The family can pay</h4><div class="v">{money(price.value)}</div>'
                f'<p>capped by state law at 30% of income, today\'s {rate:.2%} rate {tag("SOURCED")}</p></div>', unsafe_allow_html=True)
    k3.markdown(f'<div class="card"><h4>Waiting on permits adds</h4><div class="v">{money(tcost.value)}</div>'
                f'<p>{city} takes {months_line.value} months, from {crow["n_projects"]} past projects {tag("SOURCED")}</p></div>',
                unsafe_allow_html=True)
    k4.markdown(f'<div class="card"><h4>Confirmed help</h4><div class="v">{money(programs_total + earned)}</div>'
                f'<p>{len(stack["counted"])} program(s) counted; {len(stack["held_out"])} not yet confirmed</p></div>',
                unsafe_allow_html=True)

    # ================================================================ chart
    names, vals, measures, texts = [], [], [], []
    short = {"Land and building purchase": "Land", "Time costs while waiting": "Waiting on permits",
             "Construction and repairs": "Construction", "Fees, design, legal, sales": "Fees"}
    for l in costs:
        names.append(short[l.name]); vals.append(l.value or 0); measures.append("relative"); texts.append(money(l.value))
    names.append("Family pays"); vals.append(-(price.value or 0)); measures.append("relative"); texts.append(f"−{money(price.value)}")
    for label, amt, _ in stack["steps"]:
        names.append(label.replace(" Assistance", "")); vals.append(-amt); measures.append("relative"); texts.append(f"−{money(amt)}")
    names.append("Still short"); vals.append(0); measures.append("total"); texts.append(money(need))
    fig = go.Figure(go.Waterfall(x=names, y=vals, measure=measures, text=texts, textposition="outside",
                                 increasing={"marker": {"color": BROWN}}, decreasing={"marker": {"color": ORANGE}},
                                 totals={"marker": {"color": GREEN}}, connector={"line": {"color": "#bbb"}}))
    fig.update_layout(title="One home: what it costs, who pays, what's left", height=400, margin=dict(t=50, b=10),
                      yaxis_tickprefix="$", yaxis_tickformat=",.0f", showlegend=False)
    st.plotly_chart(fig, width="stretch")


# ================================================================ who can help pay
with t_help:
    st.caption("Only money that is confirmed counts. Programs decided by a lottery or a competitive round stay out until you have an award letter.")
    badge = {"confirmed": "🟢 Counts now", "funds_unconfirmed": "🟡 Funds not confirmed", "unknown": "⚪ Amount unknown"}
    counted = {p["name"]: amt for p, amt in stack["counted"]}
    for p in progs:
        a, b, c = st.columns([3.2, 1.6, 1.2])
        a.markdown(f"**{p['name']}** · {'helps the buyer' if p['side'] == 'buyer' else 'funds the project'}  \n"
                   f"<small>{p['terms_read']} · [source]({p['source_url']})</small>", unsafe_allow_html=True)
        b.markdown(badge[p["status"]])
        c.markdown(f"**{money(counted.get(p['name'], 0))}**/home")
        if p.get("rule") is None:
            with a.expander("I have a number for this"):
                cur = st.session_state.awards.get(p["name"], {"amount": 0, "letter": False})
                amt = st.number_input("Expected award per home (our estimate)", 0, 500_000, cur["amount"], 5_000, key="a" + p["name"])
                letter = st.checkbox("Award letter in hand", cur["letter"], key="l" + p["name"])
                if (amt, letter) != (cur["amount"], cur["letter"]):
                    st.session_state.awards[p["name"]] = {"amount": amt, "letter": letter}
                    st.rerun()
    with st.expander("What financing have real Orange County projects used?"):
        st.caption(fu["about"] + " Source: " + fu["source"])
        st.dataframe(pd.DataFrame(fu["programs"]).rename(columns={"name": "program (as reported)"}),
                     hide_index=True, width="stretch")
    st.caption("Not modeled: " + "; ".join(f"{e['name']} ({e['reason']})" for e in pr["excluded"]))


# ================================================================ more questions

with t_city:
    known = sorted([r for r in tl["cities"] if r["label"] == "SOURCED"], key=lambda r: r["median_months_entitlement_to_permit"])
    others = [r["city"] for r in known if r["city"] != city]
    other = st.selectbox("Compare with", others, index=others.index("Anaheim") if "Anaheim" in others else 0)
    om = cities[other]["median_months_entitlement_to_permit"]
    diff = (om - crow["median_months_entitlement_to_permit"]) * monthly_carry
    st.markdown(f"The same homes in **{other}** wait **{om} months** for a permit vs **{months_line.value}** in {city}: "
                f"**{money(abs(diff))} {'more' if diff > 0 else 'less'} per home**, {money(abs(diff) * homes)} for the project.")
    bar = go.Figure(go.Bar(x=[r["median_months_entitlement_to_permit"] for r in known], y=[r["city"] for r in known],
                           orientation="h", text=[f"{r['median_months_entitlement_to_permit']} mo · {r['n_projects']} projects" for r in known],
                           marker_color=[ORANGE if r["city"] in (city, other) else MUTED for r in known]))
    bar.update_layout(height=540, margin=dict(t=10), xaxis_title="median months from approval to building permit")
    st.plotly_chart(bar, width="stretch")
    unknown = [r["city"] for r in tl["cities"] if r["label"] != "SOURCED"]
    st.caption(f"From HCD Annual Progress Report data. Unknown (fewer than {tl['min_projects']} matching projects): "
               f"{', '.join(unknown)}. Measures one stretch (approval → permit) of the ~4-year timeline.")

with t_rate:
    r_old, d_old = rate_on("2026-10-08")
    r_new, d_new = rate_on("2026-11-05")
    p_old = affordable_price(annual_rate=r_old, **aff_kw)["price"].value
    p_new = affordable_price(annual_rate=r_new, **aff_kw)["price"].value
    st.markdown(f"Last month the rate was **{r_old:.2%}**; now it's **{r_new:.2%}**. The family's payment is capped, "
                f"so they can now afford **{money(abs(p_new - p_old))} {'more' if p_new > p_old else 'less'}** per home: "
                f"the gap {'shrinks' if p_new > p_old else 'grows'} by **{money(abs(p_new - p_old) * homes)}** for {homes} homes.")
    rr = [x / 1000 for x in range(550, 851, 25)]
    rf = go.Figure(go.Scatter(x=[f"{x:.2%}" for x in rr], y=[affordable_price(annual_rate=x, **aff_kw)["price"].value for x in rr],
                              mode="lines+markers", line_color=ORANGE))
    rf.update_layout(height=300, yaxis_tickprefix="$", yaxis_tickformat=",.0f", xaxis_title="mortgage rate",
                     yaxis_title="what the family can pay", margin=dict(t=10))
    st.plotly_chart(rf, width="stretch")
    st.caption(f"Source: {PMMS_SRC}.")

with t_donor:
    gift = st.number_input("If I give ($)", 0, 10_000_000, 25_000, 5_000)
    if need <= 0:
        st.success("This home is already funded on paper; a gift would go to the next home.")
    else:
        st.markdown(f"- **{min(gift / need, 1):.0%}** of one home's remaining gap\n"
                    f"- or **{gift / monthly_carry:.1f} months** of the costs of waiting on permits")

with t_memo:
    st.caption("Claude writes the words; every number comes from the calculator and is copied exactly. A person reviews it. Nothing is sent.")
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
    if memo.available():
        if st.button("Draft memo with Claude", type="primary"):
            with st.spinner("Claude is drafting…"):
                st.session_state.memo = memo.draft_memo(facts)
        if st.session_state.get("memo"):
            with st.container(border=True):
                st.markdown(st.session_state.memo)
            st.download_button("Download draft (.md)", st.session_state.memo, "funder-memo-draft.md")
    else:
        sample = json.loads((DATA / "sample_memo.json").read_text(encoding="utf-8"))
        if json.loads(json.dumps(facts)) == sample["facts"]:
            st.info("Example draft written with Claude for these default inputs. Live drafting turns on when an API key is added.")
            with st.container(border=True):
                st.markdown(sample["memo"])
        else:
            st.info("You changed the inputs; the example draft only matches the defaults. Live drafting needs an API key.")
    with st.expander("Exactly what Claude is given"):
        st.json(facts)

# ================================================================ sources
with t_src:
    rows = [
        ("Family's max monthly housing cost", money(aff["monthly_cap"].value), "public data (law)", f"{aff['monthly_cap'].note}; {STATUTE_URL}"),
        ("Household size for the home", aff["household_size"].value, "public data (law)", aff["household_size"].note),
        ("Area median income", money(aff["ami"].value), "public data", AMI_SRC + " · " + il["source_url"]),
        ("Mortgage rate", f"{rate:.2%}", "our estimate" if use_custom else "public data", PMMS_SRC),
        ("What the family can pay", money(price.value), "calculated", price.note),
        ("Months approval → permit", months_line.value, "public data", f"{months_line.note}; {crow['source']}"),
        ("Monthly cost of waiting", money(monthly_carry), "our estimate", "land × (loan rate + property tax) ÷ 12 + insurance/management"),
        ("Cost of waiting per home", money(tcost.value), "calculated", tcost.note),
        ("Land / construction / fees", f"{money(land)} / {money(build)} / {money(fees)}", "our estimate", "Organizers' made-up example deal"),
        ("Down payment, tax, insurance, HOA, utilities", f"{down:.1%} / {ptax:.2%} / ${ins} / ${hoa} / ${util}", "our estimate", "Editable in the side panel"),
    ]
    st.dataframe(pd.DataFrame([tuple(map(str, r)) for r in rows], columns=["what", "value", "type", "source"]),
                 hide_index=True, width="stretch")
    st.caption("Checked 2026-11-07. Law: Cal. Health & Safety Code 50052.5(b),(h), text read via a public mirror because "
               "the official site blocks automated access. Program terms from the organizers' Lane 3 data list.")
