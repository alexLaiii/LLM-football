# Betting System

Bankroll, stakes, settlement, leaderboard. Anything that touches money math goes through here — read this before changing [api/bets.py](../backend/app/api/bets.py), [scheduler/jobs.py](../backend/app/scheduler/jobs.py), or the `Prediction` / `UserBet` models.

## Core rules

| Rule | Where enforced |
|---|---|
| Everyone (AI model or user) starts with **$20,000** | `INITIAL_BANKROLL` in [api/bets.py](../backend/app/api/bets.py), [ai/orchestrator.py](../backend/app/services/ai/orchestrator.py), [api/performance.py](../backend/app/api/performance.py) |
| One bet per user per fixture | `UniqueConstraint("user_id", "fixture_id")` on [UserBet](../backend/app/models/user_bet.py) + explicit check in `place_bet` |
| One set of AI predictions per fixture | Existence check in [api/bets.py:128-133](../backend/app/api/bets.py#L128) before triggering orchestrator |
| Stake cannot exceed available bankroll | `_user_bankroll()` check in `place_bet` |
| Bets settle exactly once | Triple gate in [scheduler/jobs.py](../backend/app/scheduler/jobs.py): `Fixture.status == "scheduled"`, `Prediction.status == "pending"`, `UserBet.status == "pending"` |

## The four states a bet can be in

```
pending  ──── match finishes, picked outcome correct ───▶ won    (profit_loss = stake × (odds − 1))
pending  ──── match finishes, picked outcome wrong ─────▶ lost   (profit_loss = -stake)
pending  ──── match was cancelled / postponed ─────────▶ void   (profit_loss = 0)   [not used yet — placeholder]
```

The same four states apply to both `Prediction.status` and `UserBet.status`. Only `pending`, `won`, `lost` are reached by current settlement code. `void` is reserved for cancelled fixtures and is left for a follow-up.

## Bankroll math

Bankroll is **computed on the fly**, never stored as a single number. This is deliberate — it means every settlement, refund, or P&L change automatically flows through to the displayed bankroll without needing to recompute and persist.

For a user (mirrored almost exactly for AI models in `get_bankroll()`):

```python
def _user_bankroll(user_id, db) -> float:
    settled_pl = sum of profit_loss for UserBets where status in ("won", "lost")
    pending_stakes = sum of stake for UserBets where status == "pending"
    return INITIAL_BANKROLL + settled_pl − pending_stakes
```

Three things are worth understanding here:

1. **Settled P&L** is signed — wins are positive, losses are negative. Summing is correct.
2. **Pending stakes are subtracted** to reflect what's currently "tied up". This is why a user with a $50 pending bet sees their bankroll drop by $50 immediately, even though the bet hasn't resolved.
3. **No double-counting on settlement.** When a bet flips from `pending` → `won`, the `pending_stakes` term loses `stake`, and the `settled_pl` term gains `stake × (odds − 1)`. The change is `+stake × odds`, which is exactly the payout.

## Stake sizing

For AI models, stake is decided by [`BasePredictor.calculate_stake()`](../backend/app/services/ai/base.py) (quarter-Kelly, floored at 0.1% and capped at 2.5% of bankroll — see [prediction-flow.md](prediction-flow.md#stake-sizing-kelly-fraction)).

For users, stake is **whatever they type into the bet form**, validated against the live bankroll in `place_bet`:

- Must be > 0.
- Must be ≤ current bankroll.
- Rounded to 2 decimals.

We don't enforce a Kelly cap on humans — they are free to YOLO.

## Odds

Odds come from PulseScore (Bet365 1X2 market) via [services/odds_api.py](../backend/app/services/odds_api.py).

- The odds **at the moment the bet is placed** are frozen onto the `UserBet.odds` and `Prediction.odds` columns. Later odds movements have no effect on the user's P&L.
- If PulseScore is unavailable (no key, or call fails), [`_DEFAULT_ODDS`](../backend/app/services/odds_api.py) (2.50 / 3.20 / 2.80) is used.
- League events are cached in-process for 300 seconds to avoid hammering rate limits — restart the backend if you need a hard refresh.

## Settlement

[scheduler/jobs.py:30](../backend/app/scheduler/jobs.py#L30) — `job_settle_matches`, runs every 10 minutes.

```python
for fixture in (Fixture.status == "scheduled" AND Fixture.kickoff_at < now):
    result = await fetch_result(fixture.external_id)
    if result is None:
        continue  # API-Football says match not finished

    fixture.status = "finished"
    fixture.result = result["outcome"]   # "home" | "draw" | "away"
    fixture.home_goals = result["home_goals"]
    fixture.away_goals = result["away_goals"]

    for pred in pending Predictions for this fixture:
        won = (pred.bet_on == result["outcome"])
        pred.status        = "won" if won else "lost"
        pred.profit_loss   = round(pred.stake × (pred.odds − 1), 2) if won else −pred.stake
        pred.settled_at    = now

    # Same block, but with UserBet rows.
    db.commit()
```

**Why every 10 minutes:** API-Football updates final results within a few minutes of full-time, but live status flickers (HT, FT, AET) need to settle. 10 minutes is conservative enough to avoid settling on a stale state.

**Edge case — postponed / cancelled / voided:** Currently we just don't settle them — the fixture stays `scheduled` forever and the bets stay `pending` forever. This is wrong in the long run; the eventual fix is to detect status codes like `PST`, `CANC`, `ABD` in `fetch_result` and mark the bets `void` with `profit_loss = 0` (refund the stake).

## Leaderboard

`GET /bets/leaderboard` → [api/bets.py:147](../backend/app/api/bets.py#L147).

Returns a flat list of entries, each with a `kind` of `"ai"` or `"user"`. AI entries cover **both** the original five (from the `predictions` table) and the five blind models (`blind: true`, from the `blind_predictions` table); `prediction_class()` picks the table per identity. Compare-to-AI reads only `predictions`, so blind never enters it:

```typescript
{
  kind: "ai" | "user",
  name: string,           // "claude" | "claude_blind" | ... | <username>
  display_name: string,   // "Claude" | "Claude (blind)" | ... | <username>
  blind: boolean,         // true for blind AI identities; false for originals/humans
  bankroll: number,       // computed = INITIAL_BANKROLL + total_pl − pending_staked
  total_bets: number,
  won: number,
  lost: number,
  pending: number,
  win_rate: number,       // won / settled (settled = won + lost)
  roi: number,            // total_pl / total_staked
  total_profit_loss: number,
}
```

The frontend sorts by `bankroll` descending. Users with zero bets still show up at $20,000 since the computation is `INITIAL_BANKROLL + 0`.

The board is **one component** with five client-side filter tabs ([LeaderboardTable.tsx](../frontend/components/LeaderboardTable.tsx)): `ALL` (humans + original AI, excludes blind — the default, preserving prior behavior), `AI` (original five only), `HUMANS`, `ALL (WITH AI BLIND)` (everyone), and `AI (BLIND)` (the five blind models). Visible ranks are recomputed over the selected filter's population, so a filtered view is ranked 1..N rather than showing global ranks. The home dashboard's hero stats and ticker use the default (non-blind) population.

## "Compare Me to AI"

`GET /bets/me/compare` → [api/bets.py:200](../backend/app/api/bets.py#L200) — auth required.

For the logged-in user, returns:
- Every match they've bet on.
- Each match's `user_bet` row + the array of AI `predictions` for that same match.
- A summary block: aggregate user P&L vs. **mean AI P&L** across the same fixtures, win rates, count of matches.

The "mean AI P&L" is computed as `sum_of_ai_pl / len(_AI_MODELS)` (= 5, the original five), not `/ len(ai_preds_seen)`. This is intentional — it means a match where the AI fan-out failed for 2 of 5 models still divides by 5, dragging the average down slightly. Blind predictions never enter this average because they live in a separate `blind_predictions` table and the compare query only reads `predictions`. If you want to change this, see [api/bets.py](../backend/app/api/bets.py).

The frontend page lives at [app/compare/page.tsx](../frontend/app/compare/page.tsx) and is paginated client-side with `PAGE_SIZE=15`.

## Auth model

Lightweight on purpose. No JWT, no sessions, no refresh tokens.

- `User.token` is `secrets.token_urlsafe(32)` — a 43-character URL-safe random string, stored in the `users.token` column.
- Issued on `/auth/register` and `/auth/login`.
- Sent on every authenticated request as `Authorization: Bearer <token>`.
- Verified by [`get_current_user`](../backend/app/services/auth.py): single DB lookup on `users.token`.
- Stored in the browser at `localStorage["kim-ai-token"]`. Never expires — logout simply deletes the localStorage entry; the token in the DB remains valid until manually rotated.

This is fine for a low-stakes fake-money app but is **not what you'd ship for real-money betting**. For that you'd want token rotation, expiry, refresh, and HttpOnly cookies.

## The Sir Kim migration (historical)

The app originally had a single hardcoded "Sir Kim" bettor stored as `Prediction` rows with `model_name = "sirkim"`. When user accounts were added, a one-time startup migration copied his predictions into a real `User` + `UserBet` rows and deleted the `sirkim` predictions.

That migration (`migrations.py` / `migrate_sirkim_to_user()`) has since been **removed from the codebase** — the `sirkim` rows are long gone, so it no longer runs. Sir Kim now exists purely as an ordinary user with no special handling in the code. This note is kept only to explain why a "Sir Kim" user exists.

## Common changes and where they live

| What you want to change | Files |
|---|---|
| Starting bankroll | `INITIAL_BANKROLL` constants in `api/bets.py`, `ai/orchestrator.py`, `api/performance.py`; `initial_bankroll` class var in `ai/base.py`. Easy to grep, but worth centralising one day. |
| Kelly cap / floor | [`calculate_stake` in ai/base.py](../backend/app/services/ai/base.py) — `0.001` floor and `0.025` cap. |
| Settlement frequency | [main.py lifespan](../backend/app/main.py) — `scheduler.add_job(job_settle_matches, "interval", minutes=10)`. |
| Default odds when bookmaker call fails | `_DEFAULT_ODDS` in [services/odds_api.py](../backend/app/services/odds_api.py). |
| Adding a status (e.g. `"void"`) | Update settlement loop in `scheduler/jobs.py`, status filter in `_user_bankroll` / `get_bankroll`, frontend `STATUS_STYLE` maps in [UserBetForm](../frontend/components/UserBetForm.tsx) and [compare page](../frontend/app/compare/page.tsx). |

## What NOT to do

- **Don't store bankroll as a column.** It's computed for a reason — see "Bankroll math" above. Adding a stored field will diverge from settlements.
- **Don't settle bets inline in `place_bet`.** Settlement is the scheduler's job. A user bet placed seconds before a match ends is still `pending`; the scheduler picks it up on its next tick. Inlining settlement would create race conditions with the AI predictions.
- **Don't change the `(user_id, fixture_id)` unique constraint.** A user betting twice on the same match is a product-level question, not a bug. If you ever want to allow it, you need a separate `lineup` of multiple bets and a different bankroll-tracking story.
- **Don't issue a new token on every request.** The current model is "one long-lived token per user". If you need rotation, do it properly with expiry + refresh, not by re-issuing on `/auth/me`.
