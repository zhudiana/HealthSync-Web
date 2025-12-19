from datetime import datetime
from typing import Optional
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session
import json

from app.db.models.sleep import SleepSession

def create_sleep_session(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    session_id: Optional[str] = None,
    start_at_utc: datetime,
    end_at_utc: datetime,
    total_min: Optional[int] = None,
    stages_json: Optional[str] = None,
    tz_offset_min: Optional[int] = None
) -> SleepSession:
    """Create a new sleep session."""
    db_obj = SleepSession(
        user_id=user_id,
        provider=provider,
        session_id=session_id,
        start_at_utc=start_at_utc,
        end_at_utc=end_at_utc,
        total_min=total_min,
        stages_json=stages_json,
        tz_offset_min=tz_offset_min
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def get_sleep_by_session_id(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    session_id: str
) -> Optional[SleepSession]:
    """Get sleep session by session_id."""
    stmt = select(SleepSession).where(
        SleepSession.user_id == user_id,
        SleepSession.provider == provider,
        SleepSession.session_id == session_id
    )
    return db.execute(stmt).scalar_one_or_none()

def get_sleep_by_date(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    start_at_utc: datetime,
    end_at_utc: datetime
) -> list[SleepSession]:
    """Get sleep sessions within a date range."""
    stmt = select(SleepSession).where(
        SleepSession.user_id == user_id,
        SleepSession.provider == provider,
        SleepSession.start_at_utc >= start_at_utc,
        SleepSession.start_at_utc < end_at_utc
    ).order_by(SleepSession.start_at_utc)
    
    return list(db.execute(stmt).scalars().all())

def update_or_create_sleep_session(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    session_id: str,
    start_at_utc: datetime,
    end_at_utc: datetime,
    total_min: Optional[int] = None,
    stages_json: Optional[str] = None,
    tz_offset_min: Optional[int] = None
) -> SleepSession:
    """Update existing sleep session or create new one."""
    db_obj = get_sleep_by_session_id(
        db, 
        user_id=user_id,
        provider=provider,
        session_id=session_id
    )
    
    if db_obj:
        # Update existing record
        if start_at_utc is not None:
            db_obj.start_at_utc = start_at_utc
        if end_at_utc is not None:
            db_obj.end_at_utc = end_at_utc
        if total_min is not None:
            db_obj.total_min = total_min
        if stages_json is not None:
            db_obj.stages_json = stages_json
        if tz_offset_min is not None:
            db_obj.tz_offset_min = tz_offset_min
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj
    
    # Create new record
    return create_sleep_session(
        db,
        user_id=user_id,
        provider=provider,
        session_id=session_id,
        start_at_utc=start_at_utc,
        end_at_utc=end_at_utc,
        total_min=total_min,
        stages_json=stages_json,
        tz_offset_min=tz_offset_min
    )
