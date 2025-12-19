import json
from datetime import date, datetime
from typing import Optional
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.heart_rate import HeartRateIntraday

def create_heart_rate_intraday(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date,
    start_at_utc: datetime,
    end_at_utc: datetime,
    resolution: str,
    samples: list[dict]
) -> HeartRateIntraday:
    """Create a new intraday heart rate record."""
    samples_json = json.dumps(samples)
    db_obj = HeartRateIntraday(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        start_at_utc=start_at_utc,
        end_at_utc=end_at_utc,
        resolution=resolution,
        samples_json=samples_json
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def get_heart_rate_intraday_by_window(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date,
    resolution: str
) -> Optional[HeartRateIntraday]:
    """Get intraday heart rate for a specific date and resolution."""
    stmt = select(HeartRateIntraday).where(
        HeartRateIntraday.user_id == user_id,
        HeartRateIntraday.provider == provider,
        HeartRateIntraday.date_local == date_local,
        HeartRateIntraday.resolution == resolution
    )
    return db.execute(stmt).scalar_one_or_none()

def update_or_create_heart_rate_intraday(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date,
    start_at_utc: datetime,
    end_at_utc: datetime,
    resolution: str,
    samples: list[dict]
) -> HeartRateIntraday:
    """Update existing intraday heart rate record or create new one."""
    db_obj = get_heart_rate_intraday_by_window(
        db,
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        resolution=resolution
    )
    
    if db_obj:
        # Update existing record with new data
        db_obj.start_at_utc = start_at_utc
        db_obj.end_at_utc = end_at_utc
        db_obj.samples_json = json.dumps(samples)
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj
    
    # Create new record
    return create_heart_rate_intraday(
        db,
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        start_at_utc=start_at_utc,
        end_at_utc=end_at_utc,
        resolution=resolution,
        samples=samples
    )

def get_latest_sample(db_obj: HeartRateIntraday) -> Optional[dict]:
    """Extract the latest heart rate sample from a stored record."""
    try:
        samples = json.loads(db_obj.samples_json)
        if samples and isinstance(samples, list) and len(samples) > 0:
            return samples[-1]  # Return the last sample
        return None
    except (json.JSONDecodeError, TypeError, IndexError):
        return None
