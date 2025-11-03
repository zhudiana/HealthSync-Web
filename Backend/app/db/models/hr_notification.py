from datetime import datetime
import uuid
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import Float, DateTime, ForeignKey
from app.db.base import Base


class HeartRateNotification(Base):
    """Track the last heart rate notification sent to a user."""
    __tablename__ = "heart_rate_notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    last_max_notified: Mapped[float | None] = mapped_column(Float, nullable=True)  # Last max HR value that triggered notification
    last_min_notified: Mapped[float | None] = mapped_column(Float, nullable=True)  # Last min HR value that triggered notification
    last_notification_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)