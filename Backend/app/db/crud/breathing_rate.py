from datetime import date
from typing import Optional
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.breathing_rate import BreathingRateDaily

def create_breathing_rate_daily(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date,
    full_day_avg: Optional[float] = None,
    deep_sleep_avg: Optional[float] = None,
    light_sleep_avg: Optional[float] = None,
    rem_sleep_avg: Optional[float] = None
) -> BreathingRateDaily:
    """Create a new daily breathing rate record."""
    db_obj = BreathingRateDaily(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        full_day_avg=full_day_avg,
        deep_sleep_avg=deep_sleep_avg,
        light_sleep_avg=light_sleep_avg,
        rem_sleep_avg=rem_sleep_avg
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def get_breathing_rate_daily_by_date(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date
) -> Optional[BreathingRateDaily]:
    """Get daily breathing rate for a specific date."""
    stmt = select(BreathingRateDaily).where(
        BreathingRateDaily.user_id == user_id,
        BreathingRateDaily.provider == provider,
        BreathingRateDaily.date_local == date_local
    )
    return db.execute(stmt).scalar_one_or_none()

def get_breathing_rate_daily_by_date_range(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    start_date: date,
    end_date: date
) -> list[BreathingRateDaily]:
    """Get daily breathing rate for a date range."""
    stmt = select(BreathingRateDaily).where(
        BreathingRateDaily.user_id == user_id,
        BreathingRateDaily.provider == provider,
        BreathingRateDaily.date_local >= start_date,
        BreathingRateDaily.date_local <= end_date
    ).order_by(BreathingRateDaily.date_local)
    
    return list(db.execute(stmt).scalars().all())

def update_or_create_breathing_rate_daily(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date,
    full_day_avg: Optional[float] = None,
    deep_sleep_avg: Optional[float] = None,
    light_sleep_avg: Optional[float] = None,
    rem_sleep_avg: Optional[float] = None
) -> BreathingRateDaily:
    """Update existing daily breathing rate record or create new one."""
    db_obj = get_breathing_rate_daily_by_date(
        db, 
        user_id=user_id,
        provider=provider,
        date_local=date_local
    )
    
    if db_obj:
        # Update existing record
        if full_day_avg is not None:
            db_obj.full_day_avg = full_day_avg
        if deep_sleep_avg is not None:
            db_obj.deep_sleep_avg = deep_sleep_avg
        if light_sleep_avg is not None:
            db_obj.light_sleep_avg = light_sleep_avg
        if rem_sleep_avg is not None:
            db_obj.rem_sleep_avg = rem_sleep_avg
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj
    
    # Create new record
    return create_breathing_rate_daily(
        db,
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        full_day_avg=full_day_avg,
        deep_sleep_avg=deep_sleep_avg,
        light_sleep_avg=light_sleep_avg,
        rem_sleep_avg=rem_sleep_avg
    )
