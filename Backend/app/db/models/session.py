from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, DateTime, ForeignKey, Index
from datetime import datetime
import uuid
from app.db.base import Base
from typing import TYPE_CHECKING
# from app.db.models.user import User

if TYPE_CHECKING:
    from app.db.models.user import User

class Session(Base):
    """
    App session for JWT-based auth.
    We store a row per issued JWT so we can revoke/check it by JTI.
    """
    __tablename__ = "sessions"

    jti: Mapped[str] = mapped_column(String, primary_key=True)

    # Which user this session belongs to
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    
    user: Mapped["User"] = relationship("User", back_populates="sessions", lazy="joined")

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Optional diagnostics
    user_agent: Mapped[str | None] = mapped_column(String, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_sessions_user_id", "user_id"),
        Index("ix_sessions_expires_at", "expires_at"),
    )
