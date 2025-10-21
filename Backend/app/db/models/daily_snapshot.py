from __future__ import annotations
import uuid
from datetime import date, datetime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import String, Date, DateTime, Float, Integer, UniqueConstraint, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

Provider = String(16)

class DailySnapshot(Base):
    """
    One row per user + date + provider.
    Fast, denormalized cache for dashboard tiles.
    """
    __tablename__ = "daily_snapshot"
    __table_args__ = (
        UniqueConstraint("user_id", "date_local", "provider",
                         name="uq_daily_snapshot_user_date_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True),
                                               ForeignKey("users.id", ondelete="CASCADE"),
                                               index=True, nullable=False)
    provider: Mapped[str] = mapped_column(Provider, index=True, nullable=False)
    date_local: Mapped[date] = mapped_column(Date, index=True, nullable=False)

    # Activity
    steps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    calories: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Heart rate (daily)
    avg_hr: Mapped[float | None] = mapped_column(Float, nullable=True)
    hr_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    hr_max: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Sleep
    sleep_total_min: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Biometrics
    weight_kg_latest: Mapped[float | None] = mapped_column(Float, nullable=True)
    spo2_avg_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    temp_body_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    temp_skin_c: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ECG (latest sample of the day)
    ecg_latest_bpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    ecg_latest_time_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Meta
    tz: Mapped[str | None] = mapped_column(String(64), nullable=True)  # IANA TZ used for date_local
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow,
                                                 onupdate=datetime.utcnow, nullable=False)
