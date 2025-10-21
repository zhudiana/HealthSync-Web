from __future__ import annotations
import uuid
from datetime import date, datetime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import String, Date, DateTime, Integer, Float, Text, UniqueConstraint, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

Provider = String(16)

class StepsDaily(Base):
    __tablename__ = "steps_daily"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", "date_local",
                         name="uq_steps_daily_user_provider_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True),
                                               ForeignKey("users.id", ondelete="CASCADE"),
                                               index=True, nullable=False)
    provider: Mapped[str] = mapped_column(Provider, index=True, nullable=False)
    date_local: Mapped[date] = mapped_column(Date, index=True, nullable=False)

    steps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    calories: Mapped[float | None] = mapped_column(Float, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow,
                                                 onupdate=datetime.utcnow, nullable=False)


class StepsIntraday(Base):
    __tablename__ = "steps_intraday"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", "date_local", "resolution",
                         name="uq_steps_intraday_user_provider_date_res"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True),
                                               ForeignKey("users.id", ondelete="CASCADE"),
                                               index=True, nullable=False)
    provider: Mapped[str] = mapped_column(Provider, index=True, nullable=False)

    date_local: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    start_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    resolution: Mapped[str] = mapped_column(String(8), nullable=False)
    samples_json: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array of {t, v}

    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow,
                                                 onupdate=datetime.utcnow, nullable=False)
