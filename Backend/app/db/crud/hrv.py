from datetime import date
from typing import Optional
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.hrv import HRVDaily

def create_hrv_daily(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date,
    rmssd_ms: Optional[float] = None,
    coverage: Optional[float] = None,
    low_quartile: Optional[float] = None,
    high_quartile: Optional[float] = None
) -> HRVDaily:
    """Create a new daily HRV record."""
    db_obj = HRVDaily(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        rmssd_ms=rmssd_ms,
        coverage=coverage,
        low_quartile=low_quartile,
        high_quartile=high_quartile
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def get_hrv_daily_by_date(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date
) -> Optional[HRVDaily]:
    """Get daily HRV for a specific date."""
    stmt = select(HRVDaily).where(
        HRVDaily.user_id == user_id,
        HRVDaily.provider == provider,
        HRVDaily.date_local == date_local
    )
    return db.execute(stmt).scalar_one_or_none()

def get_hrv_daily_by_date_range(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    start_date: date,
    end_date: date
) -> list[HRVDaily]:
    """Get daily HRV for a date range."""
    stmt = select(HRVDaily).where(
        HRVDaily.user_id == user_id,
        HRVDaily.provider == provider,
        HRVDaily.date_local >= start_date,
        HRVDaily.date_local <= end_date
    ).order_by(HRVDaily.date_local)
    
    return list(db.execute(stmt).scalars().all())

def update_or_create_hrv_daily(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date,
    rmssd_ms: Optional[float] = None,
    coverage: Optional[float] = None,
    low_quartile: Optional[float] = None,
    high_quartile: Optional[float] = None
) -> HRVDaily:
    """Update existing daily HRV record or create new one."""
    db_obj = get_hrv_daily_by_date(
        db, 
        user_id=user_id,
        provider=provider,
        date_local=date_local
    )
    
    if db_obj:
        # Update existing record
        if rmssd_ms is not None:
            db_obj.rmssd_ms = rmssd_ms
        if coverage is not None:
            db_obj.coverage = coverage
        if low_quartile is not None:
            db_obj.low_quartile = low_quartile
        if high_quartile is not None:
            db_obj.high_quartile = high_quartile
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj
    
    # Create new record
    return create_hrv_daily(
        db,
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        rmssd_ms=rmssd_ms,
        coverage=coverage,
        low_quartile=low_quartile,
        high_quartile=high_quartile
    )
