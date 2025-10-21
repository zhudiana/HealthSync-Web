from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import String, DateTime, Float, UniqueConstraint, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

Provider = String(16)
SpO2Type = String(16)  # "nightly" | "spot"

class SpO2Reading(Base):
    __tablename__ = "spo2_readings"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", "reading_id",
                         name="uq_spo2_user_provider_rid"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True),
                                               ForeignKey("users.id", ondelete="CASCADE"),
                                               index=True, nullable=False)
    provider: Mapped[str] = mapped_column(Provider, index=True, nullable=False)

    measured_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    avg_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    type: Mapped[str | None] = mapped_column(SpO2Type, index=True, nullable=True) 
    reading_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow,
                                                 onupdate=datetime.utcnow, nullable=False)
