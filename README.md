# ThesisOS — Thesis Memory Build

This build adds the first real **memory layer**: every saved thesis now keeps a chronological event history. Thesis creation/edits, AI thesis checks, and filing-level dissections are recorded with thesis impact, score changes, timestamps, and source links.

The event history is currently stored in browser localStorage with the rest of the thesis library. The next production step is moving users + theses + events into a cloud database so the memory follows the user across devices.

---

# ThesisOS
## Core Data upgrade

This build adds a second real data layer without requiring another API key:

- **SEC XBRL Company Facts** for standardized fundamentals
- Revenue, net income, operating cash flow, cash, assets, liabilities, R&D, and diluted EPS when available
- Period/change context from reported XBRL facts
- **Recent Form 4 insider ownership filings** directly from EDGAR
- Company profile metadata such as exchange, SIC industry, and fiscal year end
- Richer research briefs that include fundamentals + filing links

The new backend endpoint is `GET /api/company?ticker=GOOGL`. It combines submissions, XBRL company facts, material filings, and recent Form 4 metadata.

Important: SEC XBRL tags vary by issuer. ThesisOS intentionally shows `— / not standardized` rather than inventing a number when a comparable standard tag is not available.
 MVP

**Tagline:** Know why you own it. Know when that changes.

ThesisOS is a small, usable MVP for long-term investors. You create an investment thesis, define what would break it, and the app checks recent SEC filings against those beliefs.

## What works now

- Create and save thesis cards in the browser
- Add thesis drivers and thesis breakers
- Set a conviction score
- Pull recent 10-K, 10-Q and 8-K filings from the SEC
- Open original SEC filings
- Optional AI analysis of the newest filings against *your* thesis
- Update thesis health and conviction after each check
- Everything in the portfolio is saved in browser localStorage

## Why this is a real MVP

The SEC provides public JSON endpoints for issuer submissions and XBRL data without an API key. This app uses:
- `https://www.sec.gov/files/company_tickers.json`
- `https://data.sec.gov/submissions/CIK##########.json`
- original EDGAR filing documents

The AI layer is optional. Without an AI key, the filing monitor still works.

## Run it

Requires Python 3.9+.

```bash
cd thesisos_mvp
python3 server.py
```

Open:

```text
http://localhost:8000
```

## Turn on AI thesis analysis

Set your own OpenAI API key in your shell before running the server:

macOS / Linux:

```bash
export OPENAI_API_KEY="YOUR_KEY"
export SEC_USER_AGENT="Your Name your-email@example.com"
python3 server.py
```

Optional model override:

```bash
export OPENAI_MODEL="gpt-5-mini"
```

The API key is read only by the local Python server. It is never stored in localStorage or sent to the browser.

## Product definition

### User promise

> Price tells you what happened. ThesisOS tells you whether it matters.

### Core user

Long-term self-directed investors who:
- maintain watchlists
- read filings or earnings summaries
- have explicit reasons for owning positions
- want signal instead of constant finance-news noise

### The three-step loop

1. **Write why you own it**
2. **Define what would prove you wrong**
3. **Check new evidence**

### What NOT to build yet

Do not add:
- brokerage connections
- trade execution
- social feeds
- options analytics
- charting
- crypto
- 40 data providers
- automatic buy/sell recommendations
- public analyst ratings

Those can all distract from proving the core behavior.

## 30-day founder plan for five busy people

### Week 1 — use it yourselves
Each founder adds 10 holdings/watchlist names and checks them after new filings.

Goal: identify whether the output actually catches evidence you care about.

### Week 2 — improve evidence quality
Add:
- earnings-call transcript provider
- investor-relations press releases
- simple email alert when a new filing appears

Goal: one genuinely useful notification per investor per week.

### Week 3 — private beta
Give access to 20–30 serious investors. Do not charge yet.

Ask only:
1. Did this surface something you would have missed?
2. Did it change your conviction?
3. Would you be annoyed if the product disappeared?

### Week 4 — charge
If users care:
- Free: 3 active theses
- Investor: $12/mo, 25 theses
- Club: $29/mo, shared watchtower for up to 5 people

## Founding-team roles

Keep roles tiny:
- **Product / investing:** decides what counts as material
- **Backend / AI:** data ingestion and analysis prompts
- **Frontend:** interface and onboarding
- **Data / QA:** validates filings and model outputs
- **Growth:** finds beta users and records feedback

Each founder should own one measurable weekly outcome, not a title.

## Long-term moat

The asset is not generic market data. It is the structured history of:
- what investors believed
- what evidence changed
- when conviction moved
- which management statements drifted over time
- which thesis breakers actually preceded poor outcomes

That becomes a proprietary "thesis graph" over time.

## Compliance boundary

Position the MVP as research/productivity software:
- no personalized buy/sell instructions
- no trade execution
- no custody
- no guaranteed returns
- no performance claims

Before charging at scale or adding personalized recommendations, have securities counsel review the product and marketing.

## UX / Utility upgrade — v2

This build adds a professional research workflow:

- ticker-first research (no thesis form required to inspect a company)
- dedicated SEC evidence workspace
- one-click original filing access
- thesis creation/editing from the research page
- watchtower cards with health/status state
- command palette (`⌘K` / `Ctrl+K`)
- recent ticker shortcuts
- copyable research brief for Claude or a co-working group
- JSON export/import for local backups
- responsive desktop/mobile layout
- loading, empty, success, and error states
- local browser persistence with migration from the earlier ThesisOS MVP

The MVP still deliberately avoids fake market data. Anything labeled live is tied to the real SEC retrieval pipeline; pricing, earnings transcripts, insiders, news, and valuation should be added only when backed by real providers.


## Filing Intelligence v0.4
Each material filing can now be dissected individually, or the latest 8 can be deep-scanned. With OPENAI_API_KEY enabled the analysis includes plain-English situation, why it matters, management signal, capital structure/dilution, market context, thesis impact, materiality, risks, catalysts, key numbers, and what to watch next. The app also attempts delayed daily market context and 1/3/5-session filing reactions. SEC functionality remains available if the market layer is unavailable.

Run:
```bash
cd ThesisOS_INTELLIGENCE
export SEC_USER_AGENT="Your Name your-email@example.com"
export OPENAI_API_KEY="YOUR_KEY"  # optional
PORT=8004 python3 server.py
```


# Permanent deployment (Render)

This build is ready to deploy as one Python web service. `server.py` binds to `0.0.0.0` and reads Render's `PORT` environment variable automatically.

## Files added for deployment

- `render.yaml` — Render service blueprint
- `.python-version` — pins Python 3.13
- `.env.example` — documents server-side environment variables without storing secrets
- `/healthz` — health-check endpoint
- `.gitignore` — prevents `.env` and other local secrets from being committed

## Deploy

1. Create a new GitHub repository.
2. Upload the **contents of this folder** to the repository root.
3. In Render choose **New → Web Service** and connect the repo.
4. Use `python3 server.py` as the Start Command if Render does not pick up `render.yaml` automatically.
5. Add these environment variables in Render (never commit them to GitHub):
   - `OPENAI_API_KEY` — your secret OpenAI API key
   - `SEC_USER_AGENT` — e.g. `Your Name your-email@example.com`
   - `OPENAI_MODEL` — optional; defaults to `gpt-5-mini`
6. Set the health check path to `/healthz`.
7. Deploy. Render will issue a stable `https://<service>.onrender.com` URL with managed TLS.

## Market data

The market endpoint now attempts delayed daily data from Yahoo's public chart endpoint and falls back to Stooq. Market data is explicitly best-effort and should not be represented as exchange-certified real-time data.
