from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import String, DateTime, Integer, Text, UniqueConstraint, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

Provider = String(16)

class SleepSession(Base):
    __tablename__ = "sleep_sessions"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", "session_id",
                         name="uq_sleep_session_user_provider_sid"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True),
                                               ForeignKey("users.id", ondelete="CASCADE"),
                                               index=True, nullable=False)
    provider: Mapped[str] = mapped_column(Provider, index=True, nullable=False)

    session_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)  # provider id if available
    start_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    end_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)

    total_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stages_json: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON of stage segments
    tz_offset_min: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow,
                                                 onupdate=datetime.utcnow, nullable=False)
