"""Database-side aggregation of bet/prediction stats.

Computing wins/losses/P&L/staked with SQL GROUP BY (instead of loading every row
into Python and summing) keeps memory and time flat as the number of rows grows.
Shared by the leaderboard and performance endpoints.
"""
from collections import defaultdict

from sqlalchemy import func
from sqlalchemy.orm import Session


def zero_stats() -> dict:
    return {
        "total": 0,
        "won": 0,
        "lost": 0,
        "pending": 0,
        "settled_pl": 0.0,
        "settled_staked": 0.0,
        "pending_staked": 0.0,
    }


def grouped_stats(db: Session, Model, group_col) -> dict:
    """One grouped query over `Model`, returning {group_key: stats-dict}.

    `Model` is Prediction / BlindPrediction / UserBet; `group_col` is the column
    to group by (model_name or user_id). Mirrors the previous in-Python tallies:
    settled = won + lost; pending tracked separately; void rows count only toward
    `total`."""
    stats: dict = defaultdict(zero_stats)
    rows = (
        db.query(
            group_col,
            Model.status,
            func.count(Model.id),
            func.coalesce(func.sum(Model.stake), 0.0),
            func.coalesce(func.sum(Model.profit_loss), 0.0),
        )
        .group_by(group_col, Model.status)
        .all()
    )
    for key, status, count, staked, pl in rows:
        s = stats[key]
        s["total"] += count
        if status in ("won", "lost"):
            if status == "won":
                s["won"] += count
            else:
                s["lost"] += count
            s["settled_pl"] += float(pl or 0.0)
            s["settled_staked"] += float(staked or 0.0)
        elif status == "pending":
            s["pending"] += count
            s["pending_staked"] += float(staked or 0.0)
    return stats
