from __future__ import annotations
from datetime import date, datetime
from typing import Iterable, Mapping
from sqlalchemy.orm import Session
from sqlalchemy import insert
from app.db.models.metrics import MetricDaily, MetricIntraday

def upsert_daily(
    db: Session,
    *,
    user_id,
    provider: str,
    metric: str,
    date_local: date,
    value: float | None,
    unit: str,
    tz: str | None = None,
    source_updated_at: datetime | None = None,
) -> MetricDaily:
    stmt = insert(MetricDaily).values(
        user_id=user_id,
        provider=provider,
        metric=metric,
        date_local=date_local,
        value=value,
        unit=unit,
        tz=tz,
        source_updated_at=source_updated_at,
    ).on_conflict_do_update(
        index_elements=['user_id','provider','metric','date_local'],
        set_={
            "value": value,
            "unit": unit,
            "tz": tz,
            "source_updated_at": source_updated_at,
            "updated_at": datetime.utcnow(),
        },
    )
    db.execute(stmt)
    db.commit()
    # return the row (optional)
    return db.query(MetricDaily).filter(
        MetricDaily.user_id==user_id,
        MetricDaily.provider==provider,
        MetricDaily.metric==metric,
        MetricDaily.date_local==date_local,
    ).first()

def bulk_upsert_intraday(
    db: Session,
    points: Iterable[Mapping],
):
    """
    points: iterable of dicts with keys:
      user_id, provider, metric, ts_utc, date_local, value, unit, tz
    """
    if not points:
        return 0
    stmt = insert(MetricIntraday).values(list(points))
    stmt = stmt.on_conflict_do_nothing(
        index_elements=['user_id','provider','metric','ts_utc']
    )
    res = db.execute(stmt)
    db.commit()
    return res.rowcount or 0
