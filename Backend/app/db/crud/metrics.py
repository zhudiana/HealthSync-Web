from __future__ import annotations
from datetime import datetime
# from typing import Iterable, Mapping
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert
# from app.db.models.metrics import MetricDaily, MetricIntraday
from app.db.models.steps import StepsDaily, StepsIntraday
from app.db.models.distance import DistanceDaily, DistanceIntraday
from app.db.models.daily_snapshot import DailySnapshot
from app.db.models.weights import WeightReading
from app.db.models.heart_rate import HeartRateDaily
from app.db.models.spo2 import SpO2Reading
from app.db.models.temperature import TemperatureReading
from app.db.models.ecg import ECGRecord
from zoneinfo import ZoneInfo




def _bulk_upsert_steps_intraday(db: Session, rows: list[dict]):
    if not rows:
        return
    ins = insert(StepsIntraday).values(rows)
    update_cols = {
        "start_at_utc": ins.excluded.start_at_utc,
        "end_at_utc": ins.excluded.end_at_utc,
        "samples_json": ins.excluded.samples_json,
        "updated_at": datetime.utcnow(),
    }
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "date_local", "resolution"],
        set_=update_cols,
    )
    db.execute(stmt)
    db.commit()


def _bulk_upsert_distance_intraday(db: Session, rows: list[dict]):
    if not rows:
        return
    ins = insert(DistanceIntraday).values(rows)
    update_cols = {
        "start_at_utc": ins.excluded.start_at_utc,
        "end_at_utc": ins.excluded.end_at_utc,
        "samples_json": ins.excluded.samples_json,
        "updated_at": datetime.utcnow(),
    }
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "date_local", "resolution"],
        set_=update_cols,
    )
    db.execute(stmt)
    db.commit()



def _upsert_steps_daily(
    db,
    *,
    user_id,
    provider: str,
    date_local,           
    steps: int | None,
    calories: float | None = None,
):
    ins = insert(StepsDaily).values(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        steps=steps,
        calories=calories,
    )
    update_cols = {
        "steps": ins.excluded.steps,
        "calories": ins.excluded.calories,
        "updated_at": datetime.utcnow(),
    }
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "date_local"],
        set_=update_cols,
    )
    db.execute(stmt)


def _upsert_distance_daily(
    db: Session,
    *,
    user_id,
    provider: str,
    date_local,   # datetime.date
    distance_km: float | None,
):
    ins = insert(DistanceDaily).values(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        distance_km=distance_km,
    )
    update_cols = {
        "distance_km": ins.excluded.distance_km,
        "updated_at": datetime.utcnow(),
    }
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "date_local"],
        set_=update_cols,
    )
    db.execute(stmt)


def _upsert_daily_snapshot(
    db: Session,
    *,
    user_id,
    provider: str,
    date_local,
    steps: int | None,
    distance_km: float | None,
    calories: float | None,
    sleep_hours: float | None,   # hours in payload
    tz: str | None,
):
    ins = insert(DailySnapshot).values(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        steps=steps,
        distance_km=distance_km,
        calories=calories,
        sleep_total_min=int(sleep_hours * 60) if isinstance(sleep_hours, (int, float)) else None,
        tz=tz,
        source_updated_at=None,
    )
    update_cols = {
        "steps": ins.excluded.steps,
        "distance_km": ins.excluded.distance_km,
        "calories": ins.excluded.calories,
        "sleep_total_min": ins.excluded.sleep_total_min,
        "tz": ins.excluded.tz,
        "updated_at": datetime.utcnow(),
    }
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "date_local"],
        set_=update_cols,
    )
    db.execute(stmt)


def _upsert_weight_reading(
    db: Session,
    *,
    user_id,
    provider: str,
    measured_at_utc: datetime,
    weight_kg: float,
    fat_pct: float | None = None,
    provider_measure_id: str | None = None,
    device: str | None = None,
    tz_offset_min: int | None = None,
):
    ins = insert(WeightReading).values(
        user_id=user_id,
        provider=provider,
        measured_at_utc=measured_at_utc,
        weight_kg=weight_kg,
        fat_pct=fat_pct,
        provider_measure_id=provider_measure_id,
        device=device,
        tz_offset_min=tz_offset_min,
    )
    # Idempotent when provider_measure_id is present (your unique key)
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "provider_measure_id"],
        set_={
            "measured_at_utc": ins.excluded.measured_at_utc,
            "weight_kg": ins.excluded.weight_kg,
            "fat_pct": ins.excluded.fat_pct,
            "device": ins.excluded.device,
            "tz_offset_min": ins.excluded.tz_offset_min,
            "updated_at": datetime.utcnow(),
        },
    )
    db.execute(stmt)


def _upsert_hr_daily(
    db: Session,
    *,
    user_id,
    provider: str,
    date_local,
    avg_bpm: float | None,
    min_bpm: float | None,
    max_bpm: float | None,
    sample_count: int | None = None,
):
    ins = insert(HeartRateDaily).values(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        avg_bpm=avg_bpm,
        min_bpm=min_bpm,
        max_bpm=max_bpm,
        sample_count=sample_count,
    )
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "date_local"],
        set_={
            "avg_bpm": ins.excluded.avg_bpm,
            "min_bpm": ins.excluded.min_bpm,
            "max_bpm": ins.excluded.max_bpm,
            "sample_count": ins.excluded.sample_count,
            "updated_at": datetime.utcnow(),
        },
    )
    db.execute(stmt)


def _update_snapshot_ecg(
    db: Session,
    *,
    user_id,
    provider: str,
    measured_at_utc: datetime,
    tz_str: str | None,
    hr_bpm: float | None,
):
    # write the “latest of day” ECG info
    tz = ZoneInfo(tz_str or "UTC")
    date_local = measured_at_utc.astimezone(tz).date()
    ins = insert(DailySnapshot).values(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        ecg_latest_bpm=hr_bpm,
        ecg_latest_time_utc=measured_at_utc,
        tz=tz_str or "UTC",
    )
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "date_local"],
        set_={
            "ecg_latest_bpm": ins.excluded.ecg_latest_bpm,
            "ecg_latest_time_utc": ins.excluded.ecg_latest_time_utc,
            "tz": ins.excluded.tz,
            "updated_at": datetime.utcnow(),
        },
    )
    db.execute(stmt)


def _upsert_ecg_record(
    db: Session,
    *,
    user_id,
    provider: str,
    record_id: str | None,
    start_at_utc: datetime,
    end_at_utc: datetime,
    hr_bpm: float | None,
    classification: str | None,
    duration_s: int | None,
    file_ref: str | None = None,
):
    ins = insert(ECGRecord).values(
        user_id=user_id,
        provider=provider,
        record_id=record_id,
        start_at_utc=start_at_utc,
        end_at_utc=end_at_utc,
        hr_bpm=hr_bpm,
        classification=classification,
        duration_s=duration_s,
        file_ref=file_ref,
    )
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "record_id"],
        set_={
            "start_at_utc": ins.excluded.start_at_utc,
            "end_at_utc": ins.excluded.end_at_utc,
            "hr_bpm": ins.excluded.hr_bpm,
            "classification": ins.excluded.classification,
            "duration_s": ins.excluded.duration_s,
            "file_ref": ins.excluded.file_ref,
            "updated_at": datetime.utcnow(),
        },
    )
    db.execute(stmt)


def _upsert_spo2_reading(
    db: Session,
    *,
    user_id,
    provider: str,
    measured_at_utc: datetime,
    avg_pct: float | None,
    min_pct: float | None = None,
    type_: str | None = "spot",
    reading_id: str | None = None,
):
    ins = insert(SpO2Reading).values(
        user_id=user_id,
        provider=provider,
        measured_at_utc=measured_at_utc,
        avg_pct=avg_pct,
        min_pct=min_pct,
        type=type_,
        reading_id=reading_id,
    )
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "reading_id"],
        set_={
            "measured_at_utc": ins.excluded.measured_at_utc,
            "avg_pct": ins.excluded.avg_pct,
            "min_pct": ins.excluded.min_pct,
            "type": ins.excluded.type,
            "updated_at": datetime.utcnow(),
        },
    )
    db.execute(stmt)


def _upsert_temperature_reading(
    db: Session,
    *,
    user_id,
    provider: str,
    measured_at_utc: datetime,
    body_c: float | None,
    skin_c: float | None = None,
    delta_c: float | None = None,
):
    ins = insert(TemperatureReading).values(
        user_id=user_id,
        provider=provider,
        measured_at_utc=measured_at_utc,
        body_c=body_c,
        skin_c=skin_c,
        delta_c=delta_c,
    )
    # unique on (user_id, provider, measured_at_utc)
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "measured_at_utc"],
        set_={
            "body_c": ins.excluded.body_c,
            "skin_c": ins.excluded.skin_c,
            "delta_c": ins.excluded.delta_c,
            "updated_at": datetime.utcnow(),
        },
    )
    db.execute(stmt)


def _update_snapshot_hr(
    db: Session,
    *,
    user_id,
    provider: str,
    date_local,
    avg_bpm: float | None,
    min_bpm: float | None,
    max_bpm: float | None,
):
    ins = insert(DailySnapshot).values(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        avg_hr=avg_bpm,
        hr_min=min_bpm,
        hr_max=max_bpm,
    )
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "date_local"],
        set_={
            "avg_hr": ins.excluded.avg_hr,
            "hr_min": ins.excluded.hr_min,
            "hr_max": ins.excluded.hr_max,
            "updated_at": datetime.utcnow(),
        },
    )
    db.execute(stmt)



def _update_snapshot_spo2(
    db: Session,
    *,
    user_id,
    provider: str,
    measured_at_utc: datetime,
    tz_str: str | None,
    avg_pct: float | None,
):
    # Set daily snapshot's spo2_avg_pct to the latest value we see for that local day
    tz = ZoneInfo(tz_str or "UTC")
    date_local = measured_at_utc.astimezone(tz).date()
    ins = insert(DailySnapshot).values(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        spo2_avg_pct=avg_pct,
        tz=tz_str or "UTC",
    )
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "date_local"],
        set_={
            "spo2_avg_pct": ins.excluded.spo2_avg_pct,
            "tz": ins.excluded.tz,
            "updated_at": datetime.utcnow(),
        },
    )
    db.execute(stmt)


def _update_snapshot_weight(
    db: Session,
    *,
    user_id,
    provider: str,
    measured_at_utc: datetime,
    tz_str: str | None,
    weight_kg: float,
):
    tz = ZoneInfo(tz_str or "UTC")
    date_local = measured_at_utc.astimezone(tz).date()

    ins = insert(DailySnapshot).values(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        weight_kg_latest=weight_kg,
        tz=tz_str or "UTC",
    )
    # keep the latest-of-day by timestamp
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "date_local"],
        set_={
            # always set to the newest value we see for that day
            "weight_kg_latest": ins.excluded.weight_kg_latest,
            "tz": ins.excluded.tz,
            "updated_at": datetime.utcnow(),
        },
    )
    db.execute(stmt)


def _update_snapshot_temperature(
    db: Session,
    *,
    user_id,
    provider: str,
    measured_at_utc: datetime,
    tz_str: str | None,
    body_c: float | None,
    skin_c: float | None = None,
):
    tz = ZoneInfo(tz_str or "UTC")
    date_local = measured_at_utc.astimezone(tz).date()

    ins = insert(DailySnapshot).values(
        user_id=user_id,
        provider=provider,
        date_local=date_local,
        temp_body_c=body_c,
        temp_skin_c=skin_c,
        tz=tz_str or "UTC",
    )
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "provider", "date_local"],
        set_={
            "temp_body_c": ins.excluded.temp_body_c,
            "temp_skin_c": ins.excluded.temp_skin_c,
            "tz": ins.excluded.tz,
            "updated_at": datetime.utcnow(),
        },
    )
    db.execute(stmt)



