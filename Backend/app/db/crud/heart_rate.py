from datetime import date
from typing import Optional
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.heart_rate import HeartRateDaily

def create_heart_rate_daily(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date,
    avg_bpm: Optional[float] = None,
    min_bpm: Optional[float] = None,
    max_bpm: Optional[float] = None,
    sample_count: Optional[int] = None
) -> HeartRateDaily:
    """Create a new daily heart rate record."""
    db_obj = HeartRateDaily(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        avg_bpm=avg_bpm,
        min_bpm=min_bpm,
        max_bpm=max_bpm,
        sample_count=sample_count
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def get_heart_rate_daily_by_date(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date
) -> Optional[HeartRateDaily]:
    """Get daily heart rate for a specific date."""
    stmt = select(HeartRateDaily).where(
        HeartRateDaily.user_id == user_id,
        HeartRateDaily.provider == provider,
        HeartRateDaily.date_local == date_local
    )
    return db.execute(stmt).scalar_one_or_none()

def get_heart_rate_daily_by_date_range(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    start_date: date,
    end_date: date
) -> list[HeartRateDaily]:
    """Get daily heart rate for a date range."""
    stmt = select(HeartRateDaily).where(
        HeartRateDaily.user_id == user_id,
        HeartRateDaily.provider == provider,
        HeartRateDaily.date_local >= start_date,
        HeartRateDaily.date_local <= end_date
    ).order_by(HeartRateDaily.date_local)
    
    return list(db.execute(stmt).scalars().all())

def update_or_create_heart_rate_daily(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date,
    avg_bpm: Optional[float] = None,
    min_bpm: Optional[float] = None,
    max_bpm: Optional[float] = None,
    sample_count: Optional[int] = None
) -> HeartRateDaily:
    """Update existing daily heart rate record or create new one."""
    db_obj = get_heart_rate_daily_by_date(
        db, 
        user_id=user_id,
        provider=provider,
        date_local=date_local
    )
    
    if db_obj:
        # Update existing record
        if avg_bpm is not None:
            db_obj.avg_bpm = avg_bpm
        if min_bpm is not None:
            db_obj.min_bpm = min_bpm
        if max_bpm is not None:
            db_obj.max_bpm = max_bpm
        if sample_count is not None:
            db_obj.sample_count = sample_count
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj
    
    # Create new record
    return create_heart_rate_daily(
        db,
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        avg_bpm=avg_bpm,
        min_bpm=min_bpm,
        max_bpm=max_bpm,
        sample_count=sample_count
    )
