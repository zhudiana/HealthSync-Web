from datetime import datetime
import uuid
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import Float, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class FitbitCurrentHeartRate(Base):
    """
    Stores the most recent heart rate reading for a Fitbit user.
    Used for real-time threshold checking and alerting.
    """
    __tablename__ = "fitbit_current_heart_rate"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_fitbit_current_hr_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    
    current_bpm: Mapped[float | None] = mapped_column(Float, nullable=True)  # Current/latest HR value
    measured_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)  # When this reading was taken
    
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)  # When we updated this record
