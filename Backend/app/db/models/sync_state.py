from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import String, DateTime, Text, UniqueConstraint, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

Provider = String(16)

class SyncState(Base):
    """
    Tracks incremental sync progress per metric family.
    Example metric_family: 'weights', 'steps_daily', 'hr_intraday', 'spo2', etc.
    """
    __tablename__ = "sync_state"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", "metric_family",
                         name="uq_sync_state_user_provider_family"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    provider: Mapped[str] = mapped_column(Provider, index=True, nullable=False)

    metric_family: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    cursor: Mapped[str | None] = mapped_column(Text, nullable=True)           # last date/time/id fetched
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    status: Mapped[str | None] = mapped_column(String(16), nullable=True)     # ok|error|paused
    error_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
