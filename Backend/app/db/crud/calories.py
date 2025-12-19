from datetime import date
from typing import Optional
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.calories import CaloriesDaily

def create_calories(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date,
    calories_out: Optional[float] = None,
    activity_calories: Optional[float] = None,
    bmr_calories: Optional[float] = None
) -> CaloriesDaily:
    """Create a new calories record."""
    db_obj = CaloriesDaily(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        calories_out=calories_out,
        activity_calories=activity_calories,
        bmr_calories=bmr_calories
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def get_calories_by_date(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date
) -> Optional[CaloriesDaily]:
    """Get calories data for a specific date."""
    stmt = select(CaloriesDaily).where(
        CaloriesDaily.user_id == user_id,
        CaloriesDaily.provider == provider,
        CaloriesDaily.date_local == date_local
    )
    return db.execute(stmt).scalar_one_or_none()

def get_calories_by_date_range(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    start_date: date,
    end_date: date
) -> list[CaloriesDaily]:
    """Get calories data for a date range."""
    stmt = select(CaloriesDaily).where(
        CaloriesDaily.user_id == user_id,
        CaloriesDaily.provider == provider,
        CaloriesDaily.date_local >= start_date,
        CaloriesDaily.date_local <= end_date
    ).order_by(CaloriesDaily.date_local)
    
    return list(db.execute(stmt).scalars().all())

def update_or_create_calories(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    date_local: date,
    calories_out: Optional[float] = None,
    activity_calories: Optional[float] = None,
    bmr_calories: Optional[float] = None
) -> CaloriesDaily:
    """Update existing calories record or create new one."""
    db_obj = get_calories_by_date(
        db, 
        user_id=user_id,
        provider=provider,
        date_local=date_local
    )
    
    if db_obj:
        # Update existing record
        if calories_out is not None:
            db_obj.calories_out = calories_out
        if activity_calories is not None:
            db_obj.activity_calories = activity_calories
        if bmr_calories is not None:
            db_obj.bmr_calories = bmr_calories
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj
    
    # Create new record
    return create_calories(
        db,
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        calories_out=calories_out,
        activity_calories=activity_calories,
        bmr_calories=bmr_calories
    )
