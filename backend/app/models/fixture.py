from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.prediction import Prediction
    from app.models.prediction_blind import BlindPrediction
    from app.models.team import Team


class Fixture(Base):
    __tablename__ = "fixtures"

    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    home_team: Mapped[str] = mapped_column(String(100))
    away_team: Mapped[str] = mapped_column(String(100))
    home_team_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teams.id"), nullable=True)
    away_team_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teams.id"), nullable=True)

    home_team_obj: Mapped[Optional["Team"]] = relationship("Team", foreign_keys="Fixture.home_team_id")
    away_team_obj: Mapped[Optional["Team"]] = relationship("Team", foreign_keys="Fixture.away_team_id")
    league: Mapped[str] = mapped_column(String(100))
    kickoff_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="scheduled")
    result: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    home_goals: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    away_goals: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    predictions: Mapped[List["Prediction"]] = relationship(back_populates="fixture")
    blind_predictions: Mapped[List["BlindPrediction"]] = relationship(back_populates="fixture")

    @property
    def home_team_crest(self) -> str | None:
        return self.home_team_obj.crest if self.home_team_obj else None

    @property
    def away_team_crest(self) -> str | None:
        return self.away_team_obj.crest if self.away_team_obj else None
