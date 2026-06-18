# Prediction Flow

How one fixture goes from "user places a bet" to "5 AI models have settled predictions". Read this before editing anything in [services/ai/](../backend/app/services/ai/) or [services/football_api.py](../backend/app/services/football_api.py).

## Two modes: original (odds-aware) and blind

Every fixture is predicted by all five providers in **two modes**, for **ten prediction rows total**:

- **Original (bookmaker-aware).** The LLM sees the match context *and* the bookmaker odds as a market reference. Identities: `claude`, `gpt5`, `gemini`, `grok`, `deepseek`. Behaves exactly as before.
- **Blind.** The LLM sees the same non-odds context (form, standings, lineups, injuries, ratings, WC rules) but **never the odds** — not in the system prompt, user message, snapshot, or logs. It only returns probabilities. Identities: `claude_blind`, `gpt5_blind`, … `deepseek_blind`, displayed as "Claude (blind)", etc.

"Blind" means the *LLM* can't see odds. After the blind model returns its probabilities, the **same deterministic code** (`make_result` in [ai/base.py](../backend/app/services/ai/base.py)) applies the real odds to compute value/EV, pick the highest-EV outcome, size the stake, store the selected odds, and settle later. So a blind row still has `odds`/`odds_home/draw/away` columns — they're just absent from its `prompt_snapshot`.

**Storage: separate table.** Original predictions live in `predictions` ([models/prediction.py](../backend/app/models/prediction.py)); blind predictions live in a parallel `blind_predictions` table ([models/prediction_blind.py](../backend/app/models/prediction_blind.py)) with identical columns. This keeps them easy to find, export, or delete independently, and mirrors how `user_bets` and `predictions` are merged into one leaderboard. `prediction_class(model_name)` in [orchestrator.py](../backend/app/services/ai/orchestrator.py) is the single place that maps a `*_blind` identity to its table; `get_bankroll`, the leaderboard, performance, and settlement all go through it. The fixture API exposes the two sets as `predictions` and `blind_predictions`.

The identity/label/list constants live in one place: [services/ai/models.py](../backend/app/services/ai/models.py) (`ORIGINAL_MODELS`, `BLIND_MODELS`, `ALL_MODELS`, `EXPECTED_PREDICTIONS_PER_FIXTURE`, `MODEL_LABELS`, `missing_models()`). A blind model's bankroll is fully independent of its original counterpart — different table, and everything keys on `model_name`.

## What triggers predictions

Predictions are triggered the first time a user places a bet on a fixture. The handler in [api/bets.py](../backend/app/api/bets.py) triggers the background fan-out whenever **any** of the ten model/mode combinations is missing (`ALL_MODELS ⊄ existing`).

Triggering is **idempotent**: the orchestrator computes `missing_models(existing)` and runs only the gaps. So:
- A brand-new fixture generates all ten.
- A historical fixture that only has the original five safely backfills just the blind five on the next bet.
- Repeated or concurrent triggers never duplicate — a unique `(fixture_id, model_name)` index is the backstop, and each row is saved independently.
- A fixture is **not** treated as complete just because one (or five) predictions exist.

This means:
- If no user ever bets on a fixture, the AI models never predict it. By design — we don't want to waste API quota on matches nobody cares about.
- If 100 users bet on the same match, only the gaps are ever generated; everyone else just gets the cached predictions.

The frontend polls `/fixtures/{id}` every 2 seconds via [PredictionsPoller](../frontend/components/PredictionsPoller.tsx) until all ten predictions are present (`EXPECTED_PREDICTIONS_PER_FIXTURE`) or a 10-minute cap is hit. Completed results render progressively; the match page's "Fully decided by model" toggle switches the displayed set between the five original and five blind cards (display-only — it triggers nothing).

## The orchestrator

[services/ai/orchestrator.py](../backend/app/services/ai/orchestrator.py) does the fan-out. The flow:

```
predict_all_in_background(fixture_id, fixture_dict, external_id)
  │
  ├── asyncio.gather(
  │       fetch_match_context(external_id),  # API-Football: form, h2h, standings, ...
  │       fetch_odds(external_id, ...),       # PulseScore: 1X2 odds
  │       analyze_lineups(external_id),       # Haiku-summarised lineup strength
  │   )
  │
  ├── Compute prompt_snapshot string (saved on each Prediction row for audit)
  │
  ├── Read each model's current bankroll from DB
  │
  └── asyncio.gather over [Claude, GPT-5, Gemini, Grok, DeepSeek]:
          predictor.predict(fixture_dict, match_context, odds, bankroll)
            ↓
          Save Prediction row immediately when this one finishes
            (each model has its own DB session so the slowest model
             doesn't block the others from being visible to the frontend)
```

Each `predictor.predict()` returns a `PredictionResult` dataclass (see [ai/base.py](../backend/app/services/ai/base.py)):

```python
@dataclass
class PredictionResult:
    model_name: str
    home_prob: float        # sum to 1.0
    draw_prob: float
    away_prob: float
    bet_on: str             # "home" | "draw" | "away"
    confidence: float       # 0.35–0.95
    expected_value: float   # prob × odds − 1
    stake: float            # quarter-Kelly, see below
    odds: float             # the odds for the chosen outcome at bet time
    reasoning: str          # 1–2 sentence justification from the model
    home_value_score: float | None   # model_prob / market_prob (after removing bookmaker margin)
    draw_value_score: float | None
    away_value_score: float | None
```

## What each AI sees

This is the single most important part of this doc. Every predictor receives the **same prompt** (defined as `SYSTEM_PROMPT` at the top of each predictor file — they're intentionally identical so models are compared fairly), with a `user_message` payload structured like:

```json
{
  "match": "Paris Saint Germain vs Arsenal",
  "league": "UEFA Champions League",
  "odds": { "home": 2.5, "draw": 3.2, "away": 2.8 },
  "context": {
    "home_team": "Paris Saint Germain",
    "away_team": "Arsenal",
    "match_round": "Final",
    "neutral_venue": true,
    "home_last5": { "games": 5, "wins": 2, ... },
    "away_last5": { ... },
    "home_goals_avg_last5": 1.4,
    "away_goals_avg_last5": 1.6,
    "home_rest_days": 12,
    "away_rest_days": 6,
    "h2h": { "games": 5, "home_wins": 2, "draws": 1, "away_wins": 2, "avg_goals": 3.2 },
    "h2h_summary": "Last 5 H2H: home team won 2, away won 2, drew 1.",
    "home_standing": { "position": 11, "points": 14, ... },
    "away_standing": { "position": 1, "points": 24, ... },
    "home_top_scorer": { "name": "K. Kvaratskhelia", "goals": 10 },
    "away_top_scorer": { "name": "Gabriel Martinelli", "goals": 6 },
    "home_lineup": "4-3-3: ...",        // only when posted (~30 min before kickoff)
    "away_lineup": "4-2-3-1: ...",
    "home_injuries": "Player A (Knee), Player B (Suspended), ...",
    "away_injuries": "...",
    "lineup_summary": "PSG missing 3 regulars including their top scorer..."
  }
}
```

Fields are dropped (not set to null) when the underlying API call returns nothing. The exception is the historical block (`home_last5`, `away_last5`, `h2h`) which is always present but may be `null` after a retry. That's intentional: the system prompt enumerates the historical keys, so AI sees "unavailable" rather than the field vanishing.

**To inspect what would be sent right now for any fixture:**

```python
# From the backend directory, with .env loaded
import asyncio
from app.services.football_api import fetch_match_context
from app.services.odds_api import fetch_odds
from app.services.lineup_analyzer import analyze_lineups

async def show(external_id):
    ctx, odds, lineup = await asyncio.gather(
        fetch_match_context(external_id),
        fetch_odds(external_id, home_team="...", away_team="...", league="..."),
        analyze_lineups(external_id),
    )
    if lineup:
        ctx["lineup_summary"] = lineup
    print({"context": ctx, "odds": odds})
```

The `prompt_snapshot` column on every `Prediction` row stores a flattened text version of exactly what the model received, so historical predictions can be audited even after upstream APIs change.

## Match context (fetch_match_context)

Lives in [services/football_api.py](../backend/app/services/football_api.py). One call to API-Football's `/fixtures` to identify the teams + league + season, then a parallel `asyncio.gather` of 8 follow-up calls:

| Call | Used for |
|---|---|
| `/fixtures?team={home_id}&last=20` | `home_last5`, `home_last5_home`, `home_rest_days` |
| `/fixtures?team={away_id}&last=20` | `away_last5`, `away_last5_away`, `away_rest_days` |
| `/fixtures/headtohead?h2h={home_id}-{away_id}&last=10` | `h2h`, `h2h_summary` |
| `/standings` | `home_standing`, `away_standing` |
| `/players/topscorers` | `home_top_scorer`, `away_top_scorer` |
| `/injuries?fixture=...` | `home_injuries`, `away_injuries` |
| `/fixtures/lineups?fixture=...` | `home_lineup`, `away_lineup` (only available ~30 min pre-kickoff) |
| `/teams?id={home_id}` | Home team's registered venue, used for neutral-venue detection |

**Retry-on-empty** for the three historical fields (`home_fixtures`, `away_fixtures`, `h2h_fixtures`) — under load these sometimes come back empty when data does exist. After 500 ms we retry; if still empty after the retry, the field is set to `null`.

### Neutral venue detection

Important enough to call out separately. The logic is:

```python
if fixture_venue_id is not None and home_venue_id is not None:
    neutral_venue = fixture_venue_id != home_venue_id
elif fixture_venue_name and home_venue_name:
    neutral_venue = fixture_venue_name.lower() != home_venue_name.lower()
else:
    neutral_venue = False
```

Round name (`"Final"`, `"Group Stage - 1"`, etc.) is intentionally **not** part of the decision. A Bundesliga playoff final at Paderborn's own ground is not neutral; the Champions League final at Puskas Arena is. When `neutral_venue = True`, the venue-specific stats (`home_last5_home`, `away_last5_away` and their `_goals_avg_` siblings) are excluded from the payload so the AI doesn't apply non-existent home advantage.

### World Cup matches: Elo, FIFA ranking, and extra rules

For fixtures where `league == "World Cup"`, two extra things happen on top of the normal context:

1. **Team ratings injected.** `_inject_team_ratings` in [orchestrator.py](../backend/app/services/ai/orchestrator.py) looks each team up in the `team_elo` table by API-Football `team_id` and adds `home_elo` / `away_elo` and `home_fifa_rank` / `away_fifa_rank` to the context (each only when a value is present). The table is populated manually; missing teams/values are skipped silently, and the predictors fall back to their own sense of squad strength.
2. **WC-specific rules appended.** `build_user_message` in [ai/base.py](../backend/app/services/ai/base.py) appends a block of World Cup reasoning rules to the user message — treat friendlies carefully, group-stage incentives, Matchday 3 rotation risk, no club-style home advantage, prioritize long-term strength (Elo higher = stronger, FIFA rank lower = stronger), and an approximate weighting guide.

Both are gated on the **same** `league == "World Cup"` check, so non-World-Cup predictions receive neither the ratings nor the rules. Note the rules block is part of the `user_message`, not the stored `prompt_snapshot` (which records only the input data — including the injected `*_elo` / `*_fifa_rank` values).

## Lineup analyzer

[services/lineup_analyzer.py](../backend/app/services/lineup_analyzer.py) is a separate enrichment step. It only runs when both `APIFOOTBALL_API_KEY` and `ANTHROPIC_API_KEY` are present and the fixture has a posted starting XI.

The flow:

1. Pull today's startXI, substitutes, injuries.
2. Pull each team's last 5 startXI lineups → count appearances per player, bucketed by position (G/D/M/F) using the formation as a quota (e.g. 4-3-3 means top 4 defenders / 3 midfielders / 3 forwards by appearance count are "expected").
3. Mark any expected regular who didn't start today, tag the reason (injured / suspended / benched / unavailable) and impact (high if they're the team's top scorer or top assister, otherwise normal).
4. Flag `rotation: "heavy"` if 3+ regulars are missing.
5. Hand the structured JSON to **Claude Haiku** (`claude-haiku-4-5`) with a system prompt asking for a 2–3 line plain-text summary.
6. The summary string lands on the AI prompt as `lineup_summary`.

## Stake sizing (Kelly fraction)

All five predictors share `BasePredictor.calculate_stake()` in [ai/base.py](../backend/app/services/ai/base.py):

```
ev ≤ 0          → flat 0.1% of bankroll (no-edge bet)
ev > 0          → quarter-Kelly: stake = bankroll × (ev / (odds − 1)) × 0.25
                  floor:  0.1% of bankroll
                  ceiling: 2.5% of bankroll
```

Quarter-Kelly (not full Kelly) because:
- Full Kelly is variance-maximising and assumes the probability estimate is exactly right.
- Capping at 2.5% prevents a single bad call from blowing up the bankroll.

The same formula is used regardless of the model. Differences in performance come from probability quality and bet selection, not stake sizing.

## Settlement

When the match finishes, [scheduler/jobs.py:30](../backend/app/scheduler/jobs.py#L30) (`job_settle_matches`, every 10 min) does:

```python
if fixture.status == "scheduled" and fixture.kickoff_at < now:
    result = await fetch_result(fixture.external_id)
    if result is None:
        continue   # match not finished yet per API-Football
    fixture.status = "finished"
    fixture.result = result["outcome"]   # "home" | "draw" | "away"

    for pred in pending predictions for this fixture:
        if pred.bet_on == result["outcome"]:
            pred.status = "won"
            pred.profit_loss = stake × (odds − 1)
        else:
            pred.status = "lost"
            pred.profit_loss = -stake

    # Same loop for UserBet rows.
```

**Idempotency guarantees:**
- Triple gate: `Fixture.status == "scheduled"` (finished fixtures aren't reprocessed) AND `Prediction.status == "pending"` AND `UserBet.status == "pending"`.
- Once a Prediction or UserBet is `won` / `lost`, the next scheduler tick skips it.
- No separate `settled` flag needed.

## Adding a new AI model

1. Create `backend/app/services/ai/your_model.py` mirroring [claude.py](../backend/app/services/ai/claude.py):
   - Copy `SYSTEM_PROMPT` verbatim — keep all models on the same prompt so comparisons are fair.
   - Implement `async def predict(...)` returning a `PredictionResult`.
   - Implement `_mock()` for offline dev.
2. Add it to the `PREDICTORS` list in [orchestrator.py:22](../backend/app/services/ai/orchestrator.py#L22).
3. Add the model name to `ORIGINAL_MODELS` (and the base label map) in [services/ai/models.py](../backend/app/services/ai/models.py) — `BLIND_MODELS`, `ALL_MODELS`, `EXPECTED_PREDICTIONS_PER_FIXTURE`, and the leaderboard/performance lists all derive from it. Register both an original and a `blind=True` instance in `PREDICTORS` ([orchestrator.py](../backend/app/services/ai/orchestrator.py)). Give the provider a `SYSTEM_PROMPT_BLIND` built from `ROLE_BLIND`/`TASK_STEPS_BLIND`/`OUTPUT_RULES_BLIND` and have `predict()` branch on `self.blind`.
4. Add the API key field to [config.py](../backend/app/config.py) and `.env.example`.
5. Frontend: add the base model name → display name in [lib/models.ts](../frontend/lib/models.ts) (`modelLabel` handles the "(blind)" suffix), plus the icon in [ModelIcon.tsx](../frontend/components/ModelIcon.tsx) and the per-page model lists in `compare/page.tsx` and `HistoryClient.tsx`.
6. The match-page poller derives its target from `EXPECTED_PREDICTIONS_PER_FIXTURE`/`TOTAL_AI_PREDICTIONS_PER_MODE` in [lib/models.ts](../frontend/lib/models.ts), so no per-model constant bump is needed.

## Testing end-to-end locally

The fastest way to walk the full path without waiting for a real match:

1. With `APIFOOTBALL_API_KEY` blank, run `POST /fixtures/sync` — you'll get 5 mock fixtures in your DB.
2. Register a user, place a bet on one of them via the UI or `POST /bets/{fixture_id}`.
3. With every AI key blank, all 5 predictors return their `_mock` output instantly — the 5 Prediction rows appear within a second or two.
4. To force settlement, manually update the fixture: set `kickoff_at` to the past and `result` to one of `home`/`draw`/`away`. Wait for the next 10-minute tick (or restart the backend after temporarily lowering the scheduler interval).

For an end-to-end test with real data, see [find_match.py](../backend/find_match.py) — a small CLI that pulls a real match by name and runs Claude over it, dumping the full prediction to stdout. Edit the team names and run `python find_match.py` from the backend directory.
