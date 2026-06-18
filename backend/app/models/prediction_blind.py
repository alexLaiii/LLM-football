from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.fixture import Fixture


class BlindPrediction(Base):
    """Blind AI predictions live in their own table, parallel to `predictions`,
    so they can be found, exported, or deleted independently of the original
    bookmaker-aware predictions. Columns mirror `Prediction` exactly — the only
    difference is the prompt_snapshot never contains odds (the LLM never saw
    them); the odds columns are still populated because deterministic code uses
    them after the model response for bet selection, settlement, and display."""

    __tablename__ = "blind_predictions"
    __table_args__ = (
        UniqueConstraint("fixture_id", "model_name", name="uq_blind_predictions_fixture_model"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    fixture_id: Mapped[int] = mapped_column(ForeignKey("fixtures.id"), index=True)
    model_name: Mapped[str] = mapped_column(String(50), index=True)

    home_prob: Mapped[float] = mapped_column(Float)
    draw_prob: Mapped[float] = mapped_column(Float)
    away_prob: Mapped[float] = mapped_column(Float)
    bet_on: Mapped[str] = mapped_column(String(10))
    confidence: Mapped[float] = mapped_column(Float)
    expected_value: Mapped[float] = mapped_column(Float)
    stake: Mapped[float] = mapped_column(Float)
    odds: Mapped[float] = mapped_column(Float)
    odds_home: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    odds_draw: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    odds_away: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    reasoning: Mapped[str] = mapped_column(Text)
    prompt_snapshot: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    home_value_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    draw_value_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    away_value_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="pending")
    profit_loss: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    settled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    fixture: Mapped["Fixture"] = relationship(back_populates="blind_predictions")
