from datetime import datetime
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models.fitbit_current_hr import FitbitCurrentHeartRate


def update_or_create_current_heart_rate(
    db: Session,
    *,
    user_id: UUID,
    current_bpm: float | None,
    measured_at_utc: datetime
) -> FitbitCurrentHeartRate:
    """
    Update or create the current heart rate reading for a user.
    There's only one record per user, so this upserts the latest reading.
    """
    stmt = select(FitbitCurrentHeartRate).where(
        FitbitCurrentHeartRate.user_id == user_id
    )
    db_obj = db.execute(stmt).scalar_one_or_none()
    
    if db_obj:
        # Update existing record
        db_obj.current_bpm = current_bpm
        db_obj.measured_at_utc = measured_at_utc
    else:
        # Create new record
        db_obj = FitbitCurrentHeartRate(
            user_id=user_id,
            current_bpm=current_bpm,
            measured_at_utc=measured_at_utc
        )
        db.add(db_obj)
    
    db.commit()
    db.refresh(db_obj)
    return db_obj


def get_current_heart_rate(
    db: Session,
    *,
    user_id: UUID
) -> FitbitCurrentHeartRate | None:
    """
    Get the current heart rate reading for a user.
    """
    stmt = select(FitbitCurrentHeartRate).where(
        FitbitCurrentHeartRate.user_id == user_id
    )
    return db.execute(stmt).scalar_one_or_none()
