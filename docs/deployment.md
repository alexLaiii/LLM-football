# Deployment

How this app gets to production and how to safely push changes.

## Environments

| Environment | Frontend | Backend | Database |
|---|---|---|---|
| Local dev | `npm run dev` on `localhost:3000` | `uvicorn` on `localhost:8000` | Postgres 16 via docker-compose, or a Neon dev branch |
| Production v1 (Netlify-hosted) | updated to v2 on May 29 2026 | Railway | Neon |
| Production v2 (Netlify-hosted) | https://llmbets.netlify.app | Railway | Neon |

There is no staging environment yet. Production is the only deployed env. If you're shipping anything bigger than a copy change, test it locally end-to-end first.

## What's deployed where

```
┌──────────────────────────────────┐
│  Netlify                          │
│  - Frontend Next.js app           │
│  - Build: npm run build           │
│  - Auto-deploy from main branch   │
│  - Env: NEXT_PUBLIC_API_URL       │
└──────────────────────────────────┘
              │
              │ HTTPS
              ▼
┌──────────────────────────────────┐
│  Railway                          │
│  - Backend FastAPI in Docker      │
│  - Dockerfile builds from         │
│    backend/                       │
│  - Auto-deploy from main          │
│  - Restart on failure             │
│  - Env: DATABASE_URL, API keys    │
└──────────────────────────────────┘
              │
              │ SSL Postgres
              ▼
┌──────────────────────────────────┐
│  Neon                             │
│  - PostgreSQL serverless          │
│  - Pooled connection string       │
└──────────────────────────────────┘
```

## Frontend (Netlify)

Config: [netlify.toml](../netlify.toml).

```toml
[build]
  base = "frontend"
  command = "npm run build"
  publish = ".next"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

**Required env var:** `NEXT_PUBLIC_API_URL` — the backend URL (e.g. `https://kim-ai-backend.up.railway.app`). Read in [lib/api.ts](../frontend/lib/api.ts) — falls back to `http://localhost:8000`.

**Deploy:** Push to `main`. Netlify rebuilds automatically. The Next.js plugin handles SSR.

**Rolling back:** Netlify dashboard → Deploys → click the last good deploy → "Publish deploy".

## Backend (Railway)

Config: [backend/railway.toml](../backend/railway.toml) + [backend/Dockerfile](../backend/Dockerfile).

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
restartPolicyType = "ON_FAILURE"
```

The Dockerfile is a single-stage Python 3.12-slim image:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
```

**Required env vars (set in Railway dashboard, not committed):**

| Var | Purpose | Without it |
|---|---|---|
| `DATABASE_URL` | Neon connection string | Backend crashes on boot |
| `APIFOOTBALL_API_KEY` | Fixtures, results, match context | Mock fixtures only |
| `PULSESCORE_API_KEY` | Bet365 odds | Default 2.50/3.20/2.80 odds |
| `ANTHROPIC_API_KEY` | Claude predictor + lineup summary | Claude returns mock; no lineup summary |
| `OPENAI_API_KEY` | GPT-5 predictor | GPT-5 returns mock |
| `GEMINI_API_KEY` | Gemini predictor | Gemini returns mock |
| `GROK_API_KEY` | Grok predictor | Grok returns mock |
| `DEEPSEEK_API_KEY` | DeepSeek predictor | DeepSeek returns mock |
| `CORS_ORIGINS` | Comma-separated allowed origins | CORS blocks the frontend |
| `PORT` | Railway sets this automatically | Defaults to 8000 |

**Deploy:** Push to `main`. Railway rebuilds the Docker image and restarts the container.

**Rolling back:** Railway dashboard → Deployments → "Redeploy" on the last good build.

## Database (Neon)

Postgres serverless. Pooled connection string lives only in Railway's env vars and your local `backend/.env`. **Never commit it.**

**Schema management is currently informal:**

1. On every backend startup, [main.py](../backend/app/main.py) runs:
   - `Base.metadata.create_all(bind=engine)` — creates missing tables.
   - A small block of `ALTER TABLE IF NOT EXISTS ADD COLUMN ...` for older deployments (team FK columns and `teams.crest`).
2. SQLAlchemy will **not** drop or alter existing columns, and `create_all` does **not** add new columns to a table that already exists. If you add a column to a model whose table already exists, add it by hand (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`) or drop the table so it's recreated.
3. Renaming columns or changing types requires a manual `ALTER TABLE` against the Neon instance.

This is fine while we're one engineer. The moment we're two, bring in Alembic.

**Backups:** Neon has automatic point-in-time recovery on the dashboard. If you're about to do anything risky, take a manual snapshot first (Neon → Branches → create branch from current state — it's effectively free and gives you a rollback point).

## Local dev (recap from onboarding)

```bash
# Postgres (skip if using a Neon dev branch)
docker compose up -d

# Backend
cd backend
.venv\Scripts\activate
uvicorn app.main:app --reload

# Frontend
cd frontend
npm run dev
```

Default URLs: backend `:8000`, frontend `:3000`, db `:5432`.

## Shipping a change

A normal day:

1. Branch from `main`.
2. Make the change. Test locally — run both backend and frontend, walk through the affected flow in the browser.
3. If you touched anything in `app/models/`, eyeball the schema impact (new column? renamed? dropped?). If the change isn't safe under `create_all`, hand-write the `ALTER` and run it against Neon before merging.
4. Open a PR. The reviewer will at minimum check:
   - No leaked secrets in the diff
   - No breaking changes to `lib/api.ts` types that aren't reflected in callers
   - Settlement math still adds up (see [betting-system.md](betting-system.md))
5. Merge to `main`. Netlify and Railway both auto-deploy.
6. Smoke test production: log in, place a small bet, confirm predictions appear, check leaderboard.

## Things to never do without explicit coordination

- **Drop or rename a column** on the live DB. Make it additive first (new column), backfill, switch readers, then later remove the old one. This avoids downtime even if rollback is needed.
- **Force-push to `main`.** Both Netlify and Railway will redeploy whatever's at HEAD, including a force-push that erases history.
- **Rotate `DATABASE_URL`** without also updating Railway. The backend will keep running on the old connection until it restarts; the first restart after rotation will then crash.
- **Skip the bcrypt install on local machines.** The error `ModuleNotFoundError: No module named 'bcrypt'` after a working build usually means pip installed it against the wrong Python. Install against the exact interpreter uvicorn will use.

## Monitoring

There is none yet. If production is broken you find out because the page is white or a friend on Discord complains.

When this matters more, the obvious additions are:
- Railway has built-in logs — useful when triaging crashes.
- Errors in the AI predictors are swallowed silently (the `except Exception: pass` in [orchestrator.py](../backend/app/services/ai/orchestrator.py)). For real observability, log them with the fixture ID so you can correlate against the prediction table.

## Common deploy failures

| Symptom | Likely cause |
|---|---|
| Backend boots, then crashes on first DB query | `DATABASE_URL` is wrong or Neon is paused. Open the Neon dashboard, wake the branch, check the pooled URL has `?sslmode=require`. |
| Frontend builds but every API call 404s | `NEXT_PUBLIC_API_URL` in Netlify isn't set, so it falls back to `http://localhost:8000`. Set it and redeploy (env-var changes don't auto-rebuild). |
| AI predictions don't fire | Backend is up but `APIFOOTBALL_API_KEY` is missing, so `external_id` ends up as `mock_*` and the prediction context is mostly empty. |
| Settlements stop happening | The APScheduler runs in-process. If Railway restarted the container, it should resume — confirm via Railway logs that the scheduler `start()` line ran. |
| CORS errors in the browser | `CORS_ORIGINS` on the backend doesn't include the frontend origin (Netlify preview URLs use random subdomains — add a wildcard or your stable URL). |
