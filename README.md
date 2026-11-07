# Gap Stack + Cost of Delay

> For the finance lead at a small Orange County nonprofit building affordable for-sale homes: the funding gap on each home, how much of it is time waiting on the city, and who can pay for the rest. Every number shows its source or is labeled ASSUMPTION.

**Team:** Claude House
**Lane:** 3 Fund it (bends in Lane 2: the cost of time)
**Built at:** Claude Impact Lab: UCI × SoCal Affordable Housing, November 7, 2026

## The real user

The finance lead at a small OC nonprofit that builds 4–12 for-sale homes for families around 80% of area median income (a role, not a real person). Today they size a project's gap by hand: income limits from PDFs, a guessed timeline, phone calls to see which programs have money.

**Before:** spreadsheets and calls (ASSUMPTION: about two weeks per project; confirm with a practitioner). Income table may be stale. City timeline is a guess. Board sees one gap total.
**After:** ~10 minutes. Family price from the statute and the June 23, 2026 HCD table, time cost from the city's real permit history, programs with status badges, and a funder memo draft.

## What we built

A Streamlit app. Enter a project (city, homes, bedrooms, buyer income band, cost lines). It returns:

1. **Family price** from Health & Safety Code 50052.5(b): 30% × 70% of area median income (lower income), household size = bedrooms + 1 (50052.5(h)), today's Freddie Mac rate.
2. **Time cost** per home: the city's median months from entitlement to building permit, computed from 53,578 HCD Annual Progress Report rows for Orange County, × monthly carrying cost.
3. **Funding stack:** programs marked confirmed / funds unconfirmed / unknown. Only confirmed money closes the gap.
4. **Waterfall** from cost to what's left to fundraise, per home and per project.
5. Scenario tabs: **M01** what can I stack, **M02** the rate moved (7.40% → 7.18%), **M03** what a $25k gift pays for, **city vs city** time cost, **funder memo** by Claude, **financing real OC projects reported**.

**Demo video:** [uploaded on the hub]

## How Claude is used

- Built with Claude Code: read the statute and HCD PDF, wrote the APR cross-year join, engine, tests and app.
- In the tool: Claude (`claude-opus-5-5`) drafts a one-page funder memo from a JSON of engine outputs. **Claude does no arithmetic**; all numbers come from code and must be copied exactly with their labels. A person reviews the draft; nothing is sent.

## Try it

```bash
git clone https://github.com/ani-sha/claude-impactlab-hackathon.git
cd claude-impactlab-hackathon
python -m venv .venv
# Windows: .venv\Scripts\activate   macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
pytest -q                      # synthetic deal must return the $95k gap
streamlit run app.py
```

Optional: copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY` to enable the funder memo. Everything else runs offline from committed files in `data/`.
Rebuild the timeline data: `python scripts/fetch_apr.py && python delay/build_timelines.py`.

## Sources and assumptions

| Item | Source or assumption | Date checked |
|---|---|---|
| Affordable owner cost | Cal. Health & Safety Code 50052.5(b)(1)–(4), (f), (h) ([leginfo](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=HSC&sectionNum=50052.5); text read via a public mirror because leginfo blocks automated access) | 2026-11-07 |
| OC area median income by household size | [HCD 2026 State Income Limits, revised June 23, 2026](https://www.hcd.ca.gov/sites/default/files/docs/grants-and-funding/income-limits-2026.pdf), PDF p. 11 (4-person median $138,600) → `data/income_limits.json` | 2026-11-07 |
| 30-yr mortgage rate | [Freddie Mac PMMS history](https://www.freddiemac.com/pmms/docs/PMMS_history.csv): 7.18% (2026-11-05), 7.40% (2026-10-08) → `data/pmms.csv` | 2026-11-07 |
| Months entitlement → permit, by city | [HCD APR Table A2](https://data.ca.gov/dataset/housing-element-annual-progress-report-apr-data-by-jurisdiction-and-year) (resource fe505d9b…, modified 2026-10-30) → `data/city_timelines.json` | 2026-11-07 |
| Funding programs | Program pages listed in the organizers' Lane 3 DATA-SOURCES.md → `data/programs.json` | 2026-11-07 |
| Land, construction, fees per home | **ASSUMPTION**: organizers' SYNTHETIC worked example defaults ($360k / $40k / $50k) | n/a |
| Carrying cost | **ASSUMPTION**: land × (8% acquisition loan + 1.1% tax) ÷ 12 + $250/month | n/a |
| Buyer costs | **ASSUMPTION**: 3% down, 1.1% property tax, $150 insurance, $0 HOA, $250 utilities per month | n/a |
| Program award amounts not on a page | **ASSUMPTION** entered by the user; counted only with "award letter in hand" | n/a |

## What is real and what is mocked

| Part | Status |
|---|---|
| Family price from statute + HCD table + PMMS rate | working, real data |
| City timelines from APR data (19 of 34 cities with ≥5 projects) | working, real data |
| Gap, funding stack, waterfall, M01–M03 | working |
| Program amounts for CalHome, WISH, AHP, OCHFT, Santa Ana | user-entered (terms not on page) |
| Cost lines per home | synthetic defaults, user-editable |
| Funder memo | working with an API key |

## Where it gets things wrong

- Time cost covers only **entitlement → building permit**, one stretch of the ~4-year timeline. Rezoning, design and funding-round waits are a manual "extra months" input.
- APR dates are self-reported by cities; the cross-year join can miss projects whose tracking ID changed. Same-day approval/permit records (often by-right, or a city's reporting habit) are excluded from the median and counted separately. Fewer than 5 matched projects → "unknown" (15 cities, including Irvine and Huntington Beach).
- One income band per project; a real deal mixes bands.
- 50052.5 sets a ceiling; funders (HOME, CalHome) may use their own income tables and rules. HOME limits are not loaded yet.
- Buyer-side programs (MyHome, Dream For All) depend on the buyer qualifying.

## Next steps

- Load HOME income limits and pick the table by funding source; warn when a table is stale.
- Add application → entitlement time from APR Table A.
- Claude reads a program NOFA PDF and drafts a `programs.json` row with citations for a person to approve.
- Mixed income bands per project; export a one-page pro forma.

## Data and privacy

This project uses only public data. It contains no personal information about real tenants, buyers or residents. Parcel-level APR rows are downloaded locally and **not committed**; the app shows only per-city counts and medians. It does not file applications or contact any city or person.

## License

MIT, see [LICENSE](LICENSE).
