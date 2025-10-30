from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import String, DateTime, Float, Integer, UniqueConstraint, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

Provider = String(16)

class WeightReading(Base):
    __tablename__ = "weights"
    __table_args__ = (
        # Prefer provider_measure_id if available; otherwise (user,provider,measured_at_utc) must be unique.
        UniqueConstraint("user_id", "provider", "provider_measure_id", name="uq_weight_provider_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    provider: Mapped[str] = mapped_column(Provider, index=True, nullable=False)

    measured_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    weight_kg: Mapped[float] = mapped_column(Float, nullable=False)
    fat_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    provider_measure_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    device: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tz_offset_min: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
