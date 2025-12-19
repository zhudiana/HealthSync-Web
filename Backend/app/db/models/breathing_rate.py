from __future__ import annotations
import uuid
from datetime import date, datetime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import String, Date, DateTime, Float, Integer, UniqueConstraint, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

Provider = String(16)

class BreathingRateDaily(Base):
    __tablename__ = "breathing_rate_daily"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", "date_local",
                         name="uq_br_daily_user_provider_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    provider: Mapped[str] = mapped_column(Provider, index=True, nullable=False)
    date_local: Mapped[date] = mapped_column(Date, index=True, nullable=False)

    full_day_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    deep_sleep_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    light_sleep_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    rem_sleep_avg: Mapped[float | None] = mapped_column(Float, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
