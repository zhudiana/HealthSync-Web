from datetime import datetime
from typing import List
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.db.models.weights import WeightReading
from uuid import UUID


def update_or_create_weight(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    measured_at_utc: datetime,
    weight_kg: float,
    fat_pct: float | None = None,
    provider_measure_id: str | None = None,
    device: str | None = None,
    tz_offset_min: int | None = None
) -> WeightReading:
    """
    Create or update a weight reading in the database.
    If a reading with the same provider_measure_id exists, it will be updated.
    If provider_measure_id is None, it will look for a reading with the same (user_id, provider, measured_at_utc).
    """
    # First try to find by provider_measure_id if available
    if provider_measure_id:
        existing = (
            db.query(WeightReading)
            .filter(
                WeightReading.user_id == user_id,
                WeightReading.provider == provider,
                WeightReading.provider_measure_id == provider_measure_id
            )
            .first()
        )
    else:
        # If no provider_measure_id, try to find by measured_at_utc
        existing = (
            db.query(WeightReading)
            .filter(
                WeightReading.user_id == user_id,
                WeightReading.provider == provider,
                WeightReading.measured_at_utc == measured_at_utc
            )
            .first()
        )

    if existing:
        # Update existing reading
        existing.weight_kg = weight_kg
        existing.fat_pct = fat_pct
        existing.device = device
        existing.tz_offset_min = tz_offset_min
        existing.updated_at = datetime.utcnow()
        db.add(existing)
        db.commit()
        return existing

    # Create new reading
    reading = WeightReading(
        user_id=user_id,
        provider=provider,
        measured_at_utc=measured_at_utc,
        weight_kg=weight_kg,
        fat_pct=fat_pct,
        provider_measure_id=provider_measure_id,
        device=device,
        tz_offset_min=tz_offset_min
    )
    db.add(reading)
    db.commit()
    return reading


def get_weights_by_date_range(
    db: Session,
    *,
    user_id: UUID,
    provider: str,
    start_date: datetime,
    end_date: datetime
) -> List[WeightReading]:
    """
    Get all weight readings for a user between two dates.
    """
    return (
        db.query(WeightReading)
        .filter(
            WeightReading.user_id == user_id,
            WeightReading.provider == provider,
            WeightReading.measured_at_utc >= start_date,
            WeightReading.measured_at_utc <= end_date
        )
        .order_by(WeightReading.measured_at_utc.desc())
        .all()
    )