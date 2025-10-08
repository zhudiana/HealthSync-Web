# SQLAlchemy models for daily + intraday metrics
from __future__ import annotations
from datetime import datetime, date
import uuid
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Date, DateTime, Float, UniqueConstraint, ForeignKey
from app.db.base import Base

Provider = String(16)  
Metric   = String(48)   

class MetricDaily(Base):
    __tablename__ = "metrics_daily"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", "metric", "date_local",
                         name="uq_metric_daily_user_provider_metric_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    provider: Mapped[str] = mapped_column(Provider, index=True, nullable=False)
    metric: Mapped[str] = mapped_column(Metric, index=True, nullable=False)
    date_local: Mapped[date] = mapped_column(Date, index=True, nullable=False)

    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(8), nullable=False)      
    tz: Mapped[str | None] = mapped_column(String(64), nullable=True) 
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class MetricIntraday(Base):
    __tablename__ = "metrics_intraday"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", "metric", "ts_utc",
                         name="uq_metric_intraday_user_provider_metric_ts"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    provider: Mapped[str] = mapped_column(Provider, index=True, nullable=False)
    metric: Mapped[str] = mapped_column(Metric, index=True, nullable=False)

    ts_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    date_local: Mapped[date] = mapped_column(Date, index=True, nullable=False)  # derived when writing

    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(8), nullable=False)
    tz: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
