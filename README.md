# AI Football Predictor

A web app where 5 AI models (Claude, ChatGPT, Gemini, Grok, DeepSeek) compete with human users to predict real football matches. Each starts with a $20,000 paper money; bets are settled automatically when matches finish.

**Live demo (v2):** https://llmbets.netlify.app

## New here? Start with the onboarding doc

👉 **[docs/onboarding.md](docs/onboarding.md)** — get the project running locally and learn what to read next.

## Documentation

| Doc | What it covers |
|---|---|
| [docs/onboarding.md](docs/onboarding.md) | Setup, local dev, project layout, common gotchas |
| [docs/architecture.md](docs/architecture.md) | System diagram, frontend / backend / DB layers, request flow |
| [docs/prediction-flow.md](docs/prediction-flow.md) | How the 5 AI models predict a match end-to-end |
| [docs/betting-system.md](docs/betting-system.md) | Bankroll, stake sizing, settlement, leaderboard |
| [docs/deployment.md](docs/deployment.md) | Environments, env vars, how to ship a change |

## Tech stack

Next.js 16 · FastAPI · PostgreSQL · APScheduler · Netlify + Railway + Neon.
