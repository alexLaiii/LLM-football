from datetime import datetime
import re
from typing import Literal, Optional

from pydantic import BaseModel, field_validator, model_validator


_USERNAME_RE = re.compile(r"^[A-Za-z0-9_-]{3,24}$")
_PRINTABLE_ASCII_RE = re.compile(r"^[ -~]+$")
_SNAPSHOT_ODDS_RE = re.compile(r"^odds_(home|draw|away):\s*([0-9]+(?:\.[0-9]+)?)$", re.MULTILINE)


def _prediction_values(data, fields) -> dict:
    if isinstance(data, dict):
        values = dict(data)
    else:
        values = {field: getattr(data, field, None) for field in fields}

    odds = {
        side: values.get(f"odds_{side}")
        for side in ("home", "draw", "away")
        if values.get(f"odds_{side}") is not None
    }
    if set(odds) != {"home", "draw", "away"}:
        odds = {match.group(1): float(match.group(2)) for match in _SNAPSHOT_ODDS_RE.finditer(values.get("prompt_snapshot") or "")}
    if set(odds) == {"home", "draw", "away"}:
        for side in ("home", "draw", "away"):
            prob = values.get(f"{side}_prob")
            if prob is not None:
                values[f"{side}_value_score"] = round(float(prob) * odds[side], 2)
    return values


class FixtureOut(BaseModel):
    id: int
    external_id: str
    home_team: str
    away_team: str
    home_team_id: Optional[int]
    away_team_id: Optional[int]
    home_team_crest: Optional[str] = None
    away_team_crest: Optional[str] = None
    league: str
    kickoff_at: datetime
    status: str
    result: Optional[str]
    home_goals: Optional[int]
    away_goals: Optional[int]

    model_config = {"from_attributes": True}


class PredictionOut(BaseModel):
    model_config = {"from_attributes": True, "protected_namespaces": ()}

    id: int
    fixture_id: int
    model_name: str
    home_prob: float
    draw_prob: float
    away_prob: float
    bet_on: str
    confidence: float
    expected_value: float
    stake: float
    odds: float
    odds_home: Optional[float] = None
    odds_draw: Optional[float] = None
    odds_away: Optional[float] = None
    reasoning: str
    prompt_snapshot: Optional[str] = None
    status: str
    profit_loss: Optional[float]
    settled_at: Optional[datetime]
    created_at: datetime
    home_value_score: Optional[float] = None
    draw_value_score: Optional[float] = None
    away_value_score: Optional[float] = None

    @model_validator(mode="before")
    @classmethod
    def refresh_value_scores(cls, data):
        return _prediction_values(data, cls.model_fields)


class FixtureWithPredictions(FixtureOut):
    predictions: list[PredictionOut] = []


class ModelPerformance(BaseModel):
    model_config = {"protected_namespaces": ()}

    model_name: str
    bankroll: float
    total_bets: int
    won: int
    lost: int
    pending: int
    win_rate: float
    roi: float
    total_profit_loss: float


class AuthInput(BaseModel):
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        username = value.strip()
        if not _USERNAME_RE.fullmatch(username):
            raise ValueError("Username must be 3-24 characters using only letters, numbers, underscores, or hyphens")
        return username

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 1 or len(value) > 72:
            raise ValueError("Password must be 1-72 characters")
        if value != value.strip() or not _PRINTABLE_ASCII_RE.fullmatch(value):
            raise ValueError("Password can only use normal keyboard characters, with no leading or trailing spaces")
        return value


class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    username: str


class AuthOut(BaseModel):
    token: str
    user: UserOut


class UserBetOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    user_id: int
    fixture_id: int
    bet_on: str
    stake: float
    odds: float
    status: str
    profit_loss: Optional[float]
    settled_at: Optional[datetime]
    created_at: datetime


class UserBetInput(BaseModel):
    bet_on: Literal["home", "draw", "away"]
    stake: float


class LeaderboardEntry(BaseModel):
    model_config = {"protected_namespaces": ()}

    kind: Literal["ai", "user"]
    name: str           # e.g. "claude" or "Sir Kim"
    display_name: str   # e.g. "Claude" or "Sir Kim"
    bankroll: float
    total_bets: int
    won: int
    lost: int
    pending: int
    win_rate: float
    roi: float
    total_profit_loss: float
    recent_form: list[str] = []   # last up to 5 settled results, chronological: "W" | "L"


class CompareEntry(BaseModel):
    fixture_id: int
    home_team: str
    away_team: str
    league: str
    kickoff_at: datetime
    result: Optional[str]
    user_bet: UserBetOut
    ai_predictions: list[PredictionOut]


class CompareSummary(BaseModel):
    user_pl: float
    ai_pl: float                          # average across AI models, on these fixtures
    user_win_rate: float
    ai_win_rate: float
    matches_bet: int


class CompareOut(BaseModel):
    summary: CompareSummary
    entries: list[CompareEntry]
