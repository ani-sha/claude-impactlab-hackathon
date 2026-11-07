# Gap Stack

> For the finance lead at a small Orange County nonprofit that builds for-sale affordable homes: shows the funding gap on each home, how much of it comes from waiting on the city, and who can pay for the rest.

**Lane:** 3 Fund it (we bent the brief to pull in Lane 2's timeline data)
**Built at:** Claude Impact Lab: UCI × SoCal Affordable Housing, November 7, 2026

## The real user

A finance lead at a small OC nonprofit building for-sale homes for families around 80% of area median income (a role, not a real person). To size one project's gap today, they dig through income-limit PDFs that get revised mid-year, guess how long the city will take, and phone programs to see who still has money.

**Before:** about two weeks of spreadsheets and calls per project (ASSUMPTION, to confirm with a practitioner). Time costs are a guess. The board sees one gap number with no breakdown.
**After:** about 10 minutes. The family price comes from state law and the current income table, time to permit comes from the state's own records for that city, programs show confirmed / funds unconfirmed / unknown, and every number links to its source.

## What we built

One page that balances the organizers' equation for a real project:

> family price + programs + rent while waiting + fundraising − cost to create = $0

1. **What each family can legally pay.** Health and Safety Code 50052.5(b) caps owner housing cost (for example 30% × 70% of area median income for lower-income households). We apply it to the **HCD 2026 State Income Limits for Orange County (revised June 23, 2026)** and today's **Freddie Mac 30-year rate (7.18%, Nov 5, 2026)**, after buyer costs the statute counts (tax, insurance, HOA, utilities).
2. **Time to permit, as dollars.** We joined **53,578 Orange County rows of HCD's Annual Progress Report Table A2** across years into **21,477 projects** and measured the median months from entitlement approval to building permit for every OC jurisdiction. Months × monthly carrying cost = a real line on the bill.
3. **Who can fill the gap.** Six programs with amounts read on their own pages today: Santa Ana My First Home (up to $120,000), FHLBank SF WISH (up to $32,837), CalHFA MyHome (3.5%), CalHFA Dream For All (20%, max $150,000, by drawing), CalHome and the OC Housing Finance Trust (amounts unknown, listed but never counted).
4. **What is left to fundraise**, as an animated waterfall stacking up to the cost line.

Plus the lane's three scenarios:
- **M01** which sources can I stack (toggle programs, count unconfirmed funds or not)
- **M02** rate slider over two years of real weekly rates (7.40% on Oct 8 vs 7.18% on Nov 5 moves the gap about $6,000 per home in the default project)
- **M03** donor view: what a gift covers (share of a home's gap, months of waiting costs)

And: a ranked board of every OC city by months to permit, a City A vs City B comparison, a sources drawer listing every number with SOURCED / ASSUMPTION / SYNTHETIC tags, and two Claude features (below).

**Demo video:** uploaded on the hub

## How Claude is used

- **Built with Claude Code:** data pipeline, engine, tests and UI were written with Claude in one session.
- **Funder memo (in the tool):** the engine's output, with every tag and source, goes to Claude, which writes a one-page board memo. Claude never does arithmetic: the system prompt forbids new numbers and requires "(assumption)" after any assumed figure. A person reads it before use; nothing is sent anywhere.
- **Program reader (in the tool):** paste a program page's text and Claude drafts a `programs.json` row with exact evidence quotes. A person approves it before it enters the stack; it shows a "Claude draft" badge.
- Without an API key both features fall back gracefully: the memo becomes a template filled from the same numbers.

## Try it

Needs **Node 18 or newer**. No npm install: there are no dependencies.

```bash
git clone https://github.com/ani-sha/claude-impactlab-hackathon.git
cd claude-impactlab-hackathon
node server.mjs
```

Open <http://localhost:5173>. To turn on Claude, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY` (optional `CLAUDE_MODEL`, default `claude-sonnet-5-5`).

Run the tests (includes the design doc's check that the organizers' synthetic deal returns the $95k gap):

```bash
node --test tests/synthetic.test.mjs
```

Rebuild the data (optional, needs Python 3.9+, no packages):

```bash
python delay/build_static_data.py
python delay/build_timelines.py --refresh
```

All data the demo uses is committed in `data/`, so it runs offline.

## Sources and assumptions

| Item | Source or assumption | Date checked |
|---|---|---|
| OC income limits by household size | [HCD 2026 State Income Limits, revised 2026-06-23](https://www.hcd.ca.gov/sites/default/files/docs/grants-and-funding/income-limits-2026.pdf), page 11. AMI $138,600 | 2026-11-07 |
| HOME limits | [HCD 2026 State HOME Income Limits, effective 2026-06-01](https://www.hcd.ca.gov/sites/default/files/docs/grants-and-funding/2026-california-HOME-income-limits_0.pdf), page 2 | 2026-11-07 |
| Affordable owner cost formula | [Health and Safety Code 50052.5(b)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=HSC&sectionNum=50052.5), read via [FindLaw](https://codes.findlaw.com/ca/health-and-safety-code/hsc-sect-50052-5/) because leginfo blocks scripts | 2026-11-07 |
| Household size = bedrooms + 1 | ASSUMPTION, based on HCD regulation 25 CCR 6932; not re-read today | |
| Mortgage rate | [Freddie Mac PMMS history](https://www.freddiemac.com/pmms/docs/PMMS_history.csv), 7.18% on 2026-11-05 | 2026-11-07 |
| Months to permit by city | [HCD APR Table A2 via data.ca.gov](https://data.ca.gov/dataset/housing-element-annual-progress-report-apr-data-by-jurisdiction-and-year), resource `fe505d9b-…`, joined across years | 2026-11-07 |
| Santa Ana My First Home | [santa-ana.org/my-first-home](https://santa-ana.org/my-first-home): up to $120,000, 0%, 80% AMI applications open | 2026-11-07 |
| FHLBank SF WISH | [fhlbsf.com WISH](https://fhlbsf.com/products/community-programs-grants/wish): up to $32,837 (2026), at or below 80% AMI | 2026-11-07 |
| CalHFA MyHome | [calhfa.ca.gov MyHome](https://www.calhfa.ca.gov/homebuyer/programs/myhome.htm): up to 3.5% (FHA) / 3% (conventional) | 2026-11-07 |
| CalHFA Dream For All | [calhfa.ca.gov/dream](https://calhfa.ca.gov/dream/): up to 20%, max $150,000, voucher drawing (funds unconfirmed) | 2026-11-07 |
| CalHome, OC Housing Finance Trust | Amounts unknown. Listed, never counted | 2026-11-07 |
| Cost lines (land $360k, construction $40k, fees $50k) | ASSUMPTION, copied from the organizers' synthetic worked example | |
| Buyer costs: tax 1.1%, insurance $150/mo, HOA $250/mo, utilities $250/mo, 3% down | ASSUMPTION, editable in the tool | |
| Carrying cost: 8.5% land loan, 1.1% tax, $120 insurance, $150 management per home per month | ASSUMPTION, editable in the tool | |
| Synthetic deal ($535k cost, $285k family, $100k subsidy, $55k rent, $95k gap) | SYNTHETIC, organizers' test case only | |

## What is real and what is mocked

| Part | Status |
|---|---|
| Family price from statute, income table and rate | working, real data |
| Months to permit for 34 OC jurisdictions | working, real state data (some cities have too few projects: shown as unknown) |
| Program amounts and status | working for 6 programs, read by hand today |
| Cost lines and carrying cost | mocked (ASSUMPTION defaults you can change) |
| Funder memo | working with an API key; template without |
| Program reader | working with an API key; drafts need human approval and last for the session |

## Where it gets things wrong

- Table A2 starts at entitlement approval, so the time from application to approval (often the longest wait) is not counted. Real time costs are likely higher.
- Some cities record approval and permit on the same day, which shows as 0 months (Fullerton, Fountain Valley, Villa Park). That is a reporting pattern, not proof the city is instant.
- Medians mix tenures and project sizes; cities with 5 to 9 projects are flagged low confidence, under 5 are unknown.
- Buyer assistance programs really add to the buyer's purchasing power; we model them as filling the gap per home, which is the same total but simplifies stacking rules. We do not check CalHFA's own income limits or program stacking restrictions.
- Program funding status changes; "funds unconfirmed" means call before counting it.
- Not legal, financial or lending advice.

## Next steps

- Add Table A (applications) to measure application-to-approval time.
- Let a nonprofit upload its own pro forma instead of the default cost lines.
- Ask a practitioner to replace the "two weeks" before/after estimate.
- A city-staff view: "your median wait costs each affordable home $X".

## Data and privacy

This project uses only public data. It commits only city-level aggregates from the APR data, never project rows. It contains no personal information about real tenants, buyers or residents. It does not file applications or contact any city or person.

## License

MIT, see [LICENSE](LICENSE).
