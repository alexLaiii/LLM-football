# Onboarding

Welcome. This guide gets the project running on your machine and points you at the rest of the docs.

## What this project is

A web app where 5 AI models (Claude, ChatGPT/GPT-5, Gemini, Grok, DeepSeek) compete with each other and with human users by predicting real football matches. Each model and user starts with a $20,000 fake bankroll. When a real match finishes, the system pulls the result and settles every bet automatically.

**Live demo:** v2 is at https://llmbets.netlify.app

## Tech stack at a glance

| Layer | What | Where |
|---|---|---|
| Frontend | Next.js 16 App Router + TypeScript + Tailwind | [frontend/](../frontend/) |
| Backend | FastAPI (Python 3.12) + SQLAlchemy 2 (sync) | [backend/](../backend/) |
| Database | PostgreSQL (Neon in production, local Postgres via docker-compose for dev) | — |
| Background jobs | APScheduler in-process (fixture sync, settlement) | [backend/app/scheduler/jobs.py](../backend/app/scheduler/jobs.py) |
| Deployment | Netlify (frontend), Railway (backend), Neon (DB) | [docs/deployment.md](deployment.md) |

## Read the rest of the docs in this order

1. **[architecture.md](architecture.md)** — high-level shape: how the frontend, backend, database, and external APIs fit together.
2. **[prediction-flow.md](prediction-flow.md)** — what happens when a user places a bet and the 5 AI models predict.
3. **[betting-system.md](betting-system.md)** — bankroll, stake sizing, settlement, leaderboard. Read this before touching anything in `bets.py`, `user_bet.py`, or `scheduler/jobs.py`.
4. **[deployment.md](deployment.md)** — environments, env vars, how to ship a change.

## Get it running locally

### 1. Prerequisites

- Python **3.12** (the backend pins to it via `Dockerfile`; bcrypt also needs to be installed against this exact interpreter)
- Node **20+**
- Docker (only if you want a local Postgres — otherwise point `DATABASE_URL` at a Neon dev branch)

### 2. Clone and set up env files

```bash
git clone <repo>
cd Projects
cp backend/.env.example backend/.env
```

Fill in `backend/.env`. Minimal viable setup:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/football_bets
APIFOOTBALL_API_KEY=          # leave blank to use mock fixtures
PULSESCORE_API_KEY=           # leave blank to use mock odds
ANTHROPIC_API_KEY=            # leave blank → ClaudePredictor returns mock JSON
OPENAI_API_KEY=               # same for GPT-5
GEMINI_API_KEY=
GROK_API_KEY=
DEEPSEEK_API_KEY=
CORS_ORIGINS=http://localhost:3000
```

Every external dependency has a mock fallback, so a blank key is fine while you find your feet. See [prediction-flow.md](prediction-flow.md) for what each key unlocks.

### 3. Start Postgres (skip if using Neon)

```bash
docker compose up -d
```

This brings up Postgres 16 on `localhost:5432` with db `football_bets` (creds: `postgres`/`postgres`).

### 4. Start the backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Backend now serves on http://localhost:8000. On first boot, SQLAlchemy creates all tables (`Base.metadata.create_all`) plus a couple of additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements in [main.py](../backend/app/main.py).

Sanity check: open http://localhost:8000/health → `{"status":"ok"}` and http://localhost:8000/docs for the auto-generated Swagger UI.

### 5. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000.

### 6. Seed some data

The fixtures table starts empty. Click **Sync Fixtures** on the Matches page (or `POST http://localhost:8000/fixtures/sync`). If `APIFOOTBALL_API_KEY` is blank, you get the 5 mock fixtures in [football_api.py](../backend/app/services/football_api.py) (`_MOCK_FIXTURES`).

To test the full predict→settle flow without waiting for a real match, see [prediction-flow.md](prediction-flow.md#testing-end-to-end-locally).

## What's where

Worth remembering even before you read architecture.md:

```
backend/app/
  api/           # FastAPI routers: fixtures, predictions, bets, auth, performance
  models/        # SQLAlchemy ORM models — one file per table
  services/
    ai/          # One predictor per model + orchestrator that fans out
    football_api.py    # API-Football integration (fixtures, results, context, lineups)
    odds_api.py        # PulseScore (Bet365 odds) integration
    lineup_analyzer.py # Pulls startXI + tags missing regulars, summarises via Haiku
    auth.py            # bcrypt + opaque token helpers
  scheduler/jobs.py    # APScheduler tasks: weekly fixture sync, 10-min settlement
  main.py        # FastAPI app, scheduler bootstrap, CORS, schema bootstrap
  database.py    # Engine + Base + get_db dependency
  schemas.py     # Pydantic request/response models
  config.py      # pydantic-settings, reads .env

frontend/
  app/           # Next.js App Router pages
    page.tsx           # Leaderboard (home)
    matches/           # Fixture list + detail
    history/           # AI bet history
    compare/           # "Compare Me to AI" — user vs AI on same matches
  components/    # React components (PredictionCard, UserBetForm, etc.)
  lib/
    api.ts       # Single file: every backend HTTP call lives here
    auth.tsx     # AuthProvider + useAuth() hook (localStorage-based token)
```

## Working safely

- **Bets and predictions are settled by a scheduler**, not the request that creates them. If you change the schema or settlement math, also re-read [betting-system.md](betting-system.md) and check [`scheduler/jobs.py`](../backend/app/scheduler/jobs.py).
- **Every AI service has a `_mock` path** — disable the real key to develop offline without burning tokens.
- **No data migrations run at startup** — only schema creation. (An earlier one-time "Sir Kim" data migration has been removed from the codebase; see [betting-system.md](betting-system.md#the-sir-kim-migration-historical).)
- **No Alembic.** Schema is currently maintained by `Base.metadata.create_all()` plus a couple of `ALTER TABLE IF NOT EXISTS` lines in [`main.py`](../backend/app/main.py). For breaking changes in production, talk to whoever owns the Neon instance.

## When you get stuck

- Backend won't start with `ModuleNotFoundError: No module named 'bcrypt'` → install with the exact Python interpreter uvicorn uses (e.g. `C:/Users/.../Python312/python.exe -m pip install bcrypt==4.2.0`).
- All AI predictions look fake or generic → the API key for that model is blank/invalid; the predictor falls back to `_mock`. (The "USED DATA" column tells you whether the data is fake or real, and each model's prediction card shows MOCK or REAL when you click "show reasoning".)
- Fixtures don't appear after clicking **Sync Fixtures** → either `APIFOOTBALL_API_KEY` is blank (you'll only get mocks), or no matches fall in the next 14 days for the leagues in `_LEAGUES`.
- Bets never settle → match isn't `finished` in API-Football yet, or `job_settle_matches` only runs every 10 minutes. Hit `POST /fixtures/sync` and wait, or settle by hand in the DataBase if you're testing.
