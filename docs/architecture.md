# Architecture

High-level shape of the system: what talks to what, where data lives, and which boundaries you need to respect when changing code.

## System diagram

```
┌──────────────────────┐         HTTPS          ┌───────────────────────────────┐
│  Browser             │ ─────────────────────▶ │  Frontend (Next.js on        │
│  (user)              │                        │  Netlify, App Router)        │
└──────────────────────┘                        │                              │
                                                │  - SSR for fixture detail    │
                                                │  - Client components fetch   │
                                                │    via lib/api.ts            │
                                                │  - Auth token in             │
                                                │    localStorage              │
                                                └──────────────┬────────────────┘
                                                               │  JSON over HTTPS
                                                               │  Bearer <token>
                                                               ▼
                                                ┌───────────────────────────────┐
                                                │  Backend (FastAPI on Railway)│
                                                │                              │
                                                │  Routers:                    │
                                                │    /fixtures /predictions    │
                                                │    /bets /auth /performance  │
                                                │                              │
                                                │  In-process:                 │
                                                │    APScheduler (sync, settle)│
                                                │    asyncio.create_task for   │
                                                │    AI fan-out                │
                                                └──┬─────────────┬──────────────┘
                                                   │             │
                              ┌────────────────────┘             └──────────────────────┐
                              ▼                                                          ▼
              ┌──────────────────────────┐                              ┌─────────────────────────────┐
              │  PostgreSQL (Neon)       │                              │  External APIs              │
              │                          │                              │                             │
              │  teams, team_elo,        │                              │  API-Football  (v3)         │
              │  fixtures, predictions,  │                              │    fixtures, results,       │
              │  user_bets, users        │                              │    standings, h2h,          │
              │                          │                              │    lineups, injuries,       │
              └──────────────────────────┘                              │    venues                   │
                                                                        │                             │
                                                                        │  PulseScore (Bet365 odds)   │
                                                                        │                             │
                                                                        │  Anthropic / OpenAI /       │
                                                                        │  Google / xAI / DeepSeek    │
                                                                        └─────────────────────────────┘
```

## Frontend

[frontend/](../frontend/) is a Next.js 16 App Router project deployed to Netlify.

**Pages**

| Route | File | Notes |
|---|---|---|
| `/` | [app/page.tsx](../frontend/app/page.tsx) | Unified leaderboard (AI + users). |
| `/matches` | [app/matches/page.tsx](../frontend/app/matches/page.tsx) | League-grouped fixture list with a "Sync Fixtures" button. |
| `/matches/[id]` | [app/matches/[id]/page.tsx](../frontend/app/matches/[id]/page.tsx) | Server component fetches a single fixture, then renders `MatchDetailClient` (toggle between the 5 original and 5 blind prediction cards), `UserBetForm`, lineups. |
| `/history` | [app/history/page.tsx](../frontend/app/history/page.tsx) | Past predictions for the original 5 models (blind rows are filtered out here; they surface on the match page and leaderboard). |
| `/compare` | [app/compare/page.tsx](../frontend/app/compare/page.tsx) | Each of your bets side-by-side with the AI predictions for the same match. |

**Key conventions**

- **All backend calls go through [lib/api.ts](../frontend/lib/api.ts).** Don't `fetch` from a page directly — add a typed helper.
- **Auth state via [lib/auth.tsx](../frontend/lib/auth.tsx).** Token is stored in `localStorage` under `kim-ai-token`. `AuthProvider` wraps the app in [layout.tsx](../frontend/app/layout.tsx). Use `useAuth()` to read `user`, `token`, and call `login` / `register` / `logout`.
- **`router.refresh()` after mutations.** Most pages mix server + client components; `router.refresh()` re-runs the server components without a full navigation.

## Backend

[backend/app/](../backend/app/) is a single FastAPI application. There is no Celery or Redis — background work runs in-process via APScheduler and `asyncio.create_task`.

### Request flow

```
HTTP request
  → APIRouter (e.g. app/api/bets.py)
  → SQLAlchemy session (Depends(get_db))
  → ORM model (app/models/*.py)
  → Postgres
  → Pydantic response model (app/schemas.py)
  → JSON response
```

### Routers

Each router file owns one prefix and a tag:

| Prefix | File | Purpose |
|---|---|---|
| `/fixtures` | [api/fixtures.py](../backend/app/api/fixtures.py) | List, sync, get-one, odds for a fixture, lineup availability/details. |
| `/predictions` | [api/predictions.py](../backend/app/api/predictions.py) | List AI predictions; manually trigger a run for a fixture. |
| `/bets` | [api/bets.py](../backend/app/api/bets.py) | User bet placement, my bets, my bankroll, leaderboard, compare-me-to-AI. |
| `/auth` | [api/auth.py](../backend/app/api/auth.py) | Register, login, `GET /auth/me`. |
| `/performance` | [api/performance.py](../backend/app/api/performance.py) | Per-AI-model performance stats (legacy view; the unified leaderboard is in `/bets`). |

### Models

Defined in [app/models/](../backend/app/models/). One class per file, all registered via [models/\_\_init\_\_.py](../backend/app/models/__init__.py) so `Base.metadata.create_all()` sees them.

```
User ────< UserBet >───── Fixture ─────< Prediction
                            │
                            └── home_team_id ──> Team
                            └── away_team_id ──> Team
```

- **Fixture** keys off `external_id` (the API-Football fixture ID, as a string).
- **Prediction** = one original (bookmaker-aware) AI model's bet on one fixture. `model_name` ∈ {claude, gpt5, gemini, grok, deepseek}.
- **BlindPrediction** = the blind-mode counterpart in its own `blind_predictions` table (identical columns; `model_name` ∈ {claude_blind, …, deepseek_blind}). Kept separate so blind data can be found/deleted independently. Both tables have a unique `(fixture_id, model_name)` backstop. `prediction_class()` in the orchestrator routes an identity to its table.
- **UserBet** = one user's bet on one fixture. Enforced unique on `(user_id, fixture_id)` via `uq_user_fixture` so users can't bet twice on the same match.
- **User.token** is an opaque 32-byte URL-safe token, NOT a JWT. Stored in plain text in the column; sent as `Authorization: Bearer <token>`.
- **TeamElo** is a standalone lookup table (keyed by API-Football `team_id`) holding each national team's Elo rating and FIFA world ranking (`elo` / `fifa_rank`, both nullable). Populated manually; read only for World Cup fixtures, where the orchestrator injects the values into match context. See [prediction-flow.md](prediction-flow.md#world-cup-matches-elo-fifa-ranking-and-extra-rules).

### Services layer

[app/services/](../backend/app/services/) is where external integrations and orchestration live. Routers should call services, not the other way round.

| File | Responsibility |
|---|---|
| [services/football_api.py](../backend/app/services/football_api.py) | API-Football: fixtures, results, match context (form, H2H, standings, injuries), lineup availability, neutral venue detection. |
| [services/odds_api.py](../backend/app/services/odds_api.py) | PulseScore (Bet365 1X2 odds). Cached per league for 5 minutes. |
| [services/lineup_analyzer.py](../backend/app/services/lineup_analyzer.py) | Pulls today's startXI + last-5 startXI history per team, identifies missing regulars, calls Claude Haiku for a natural-language summary. Output becomes `match_context["lineup_summary"]`. |
| [services/auth.py](../backend/app/services/auth.py) | bcrypt hash/verify, `secrets.token_urlsafe(32)`, `get_current_user` FastAPI dependency. |
| [services/ai/](../backend/app/services/ai/) | One file per model (`claude.py`, `gpt5.py`, etc.) plus [orchestrator.py](../backend/app/services/ai/orchestrator.py) which fans out in parallel. See [prediction-flow.md](prediction-flow.md). |

### Scheduler

[app/scheduler/jobs.py](../backend/app/scheduler/jobs.py) defines two jobs. They are registered in [main.py](../backend/app/main.py) lifespan:

| Job | Cadence | What it does |
|---|---|---|
| `job_sync_fixtures` | Weekly, Mon 06:00 | Calls `fetch_upcoming_fixtures()` and inserts any new fixtures over the next 14 days. |
| `job_settle_matches` | Every 10 minutes | For every fixture with `status="scheduled"` and `kickoff_at < now`, fetches the result and settles every pending `Prediction` and `UserBet` for that fixture. |

The scheduler runs **inside the FastAPI process**. If you scale to multiple workers, you'll need to gate this with a leader election or move it out.

### Schema management

Currently no Alembic. On every startup [main.py](../backend/app/main.py):

1. Calls `Base.metadata.create_all(bind=engine)` → creates missing tables.
2. Runs a few hand-coded `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for older deployments.

Note: `create_all` only creates missing *tables*, never adds columns to a table that already exists. New columns on an existing table need a manual `ALTER` (or drop the table so it's recreated).

This is fine while we're solo, but the moment two engineers work in parallel we'll regret it. Bringing in Alembic is on the list.

## Data flow: end-to-end bet

The clearest single example of how all the layers cooperate:

```
1. User opens /matches/123
   Frontend SSR: getFixture(123) → GET /fixtures/123
                                        → fixtures.py loads Fixture + predictions
                                        → returns FixtureWithPredictions JSON

2. User clicks "Place Bet"
   Frontend: placeUserBet(token, 123, "home", 50)
              → POST /bets/123  with bearer token, body { bet_on, stake }

3. Backend (api/bets.py place_bet):
   a. Look up Fixture
   b. Check no existing UserBet for (user_id, 123)
   c. Compute bankroll: $20k + settled P&L − pending stakes
   d. Reject if stake > bankroll
   e. Fetch odds (cached PulseScore call)
   f. Insert UserBet row (status="pending")
   g. If any of the 10 model/mode combinations is missing for this fixture:
        asyncio.create_task(predict_all_in_background(...))
        → orchestrator fans out to the missing predictors (5 original + 5 blind) in parallel
        → each predictor saves its Prediction row when ready (idempotent: only gaps)
   h. Return UserBetOut

4. Frontend receives placed bet, optimistically updates UI

5. Frontend polls /fixtures/123 every 2s (PredictionsPoller)
   until predictions + blind_predictions === 10 or a 10-min cap

6. Match kicks off, finishes.
   APScheduler tick (every 10 min):
     job_settle_matches → fetch_result → mark Fixture finished
                       → loop over Predictions & UserBets, set status + profit_loss
```

## External services and fallbacks

| Service | Used for | Fallback when key missing |
|---|---|---|
| API-Football v3 | Upcoming fixtures, results, form/standings/h2h/injuries/lineups | `_MOCK_FIXTURES` (5 hardcoded fixtures), `_MOCK` context. |
| PulseScore | 1X2 odds from Bet365 | `_DEFAULT_ODDS` (2.50 / 3.20 / 2.80). |
| Anthropic / OpenAI / Gemini / xAI / DeepSeek | Predictions + lineup summary | `_mock()` in `(model name).py` returns random probs + canned reasoning. |


The mock paths exist so local dev and CI don't burn paid quota.

## What you can change safely vs. what needs care

- **Safe:** adding new fields to a response (Pydantic ignores extras on the client), adding new pages, adding new fixtures to mock data, tweaking prompts.
- **Care:** anything in [scheduler/jobs.py](../backend/app/scheduler/jobs.py) (bankroll math), adding columns (no Alembic — see schema management above), changing the auth token format (frontend stores it long-lived), changing odds caching TTL (rate limits).
