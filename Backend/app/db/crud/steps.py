from datetime import date
from typing import Optional
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.steps import StepsDaily

def create_steps(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date,
    steps: Optional[int] = None,
    active_min: Optional[int] = None,
    calories: Optional[float] = None
) -> StepsDaily:
    """Create a new steps record."""
    db_obj = StepsDaily(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        steps=steps,
        active_min=active_min,
        calories=calories
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def get_steps_by_date_range(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    start_date: date,
    end_date: date
) -> list[StepsDaily]:
    """Get steps data for a date range."""
    stmt = select(StepsDaily).where(
        StepsDaily.user_id == user_id,
        StepsDaily.provider == provider,
        StepsDaily.date_local >= start_date,
        StepsDaily.date_local <= end_date
    ).order_by(StepsDaily.date_local)
    
    return list(db.execute(stmt).scalars().all())

def get_steps_by_date(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date
) -> Optional[StepsDaily]:
    """Get steps data for a specific date."""
    stmt = select(StepsDaily).where(
        StepsDaily.user_id == user_id,
        StepsDaily.provider == provider,
        StepsDaily.date_local == date_local
    )
    return db.execute(stmt).scalar_one_or_none()

def update_or_create_steps(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date,
    steps: Optional[int] = None,
    active_min: Optional[int] = None,
    calories: Optional[float] = None
) -> StepsDaily:
    """Update existing steps record or create new one."""
    db_obj = get_steps_by_date(
        db, 
        user_id=user_id,
        provider=provider,
        date_local=date_local
    )
    
    if db_obj:
        # Update existing record
        if steps is not None:
            db_obj.steps = steps
        if active_min is not None:
            db_obj.active_min = active_min
        if calories is not None:
            db_obj.calories = calories
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj
    
    # Create new record
    return create_steps(
        db,
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        steps=steps,
        active_min=active_min,
        calories=calories
    )