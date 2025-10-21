from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import String, DateTime, Float, Integer, Text, UniqueConstraint, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

Provider = String(16)

class ECGRecord(Base):
    __tablename__ = "ecg_records"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", "record_id",
                         name="uq_ecg_user_provider_rid"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True),
                                               ForeignKey("users.id", ondelete="CASCADE"),
                                               index=True, nullable=False)
    provider: Mapped[str] = mapped_column(Provider, index=True, nullable=False)

    record_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)  # provider id
    start_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    end_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)

    hr_bpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    classification: Mapped[str | None] = mapped_column(String(32), nullable=True)  # e.g., "normal", "afib?"
    duration_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_ref: Mapped[str | None] = mapped_column(Text, nullable=True)  # link to file/binary if stored elsewhere

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow,
                                                 onupdate=datetime.utcnow, nullable=False)
