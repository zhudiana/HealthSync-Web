from fastapi import APIRouter, HTTPException, Query, Response, Depends
import requests
from typing import Optional, List, Dict, Tuple
from datetime import datetime, timedelta,time, date as _date
from zoneinfo import ZoneInfo
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.db.models import WithingsAccount, User
from app.utils.crypto import decrypt_text  
import json
from app.db.crud.metrics import (
    _bulk_upsert_distance_intraday, 
    _bulk_upsert_steps_intraday, 
    _update_snapshot_ecg, 
    _update_snapshot_hr, 
    _update_snapshot_spo2, 
    _update_snapshot_temperature, 
    _update_snapshot_weight, 
    _upsert_daily_snapshot, 
    _upsert_distance_daily, 
    _upsert_ecg_record, 
    _upsert_hr_daily, 
    _upsert_spo2_reading, 
    _upsert_steps_daily, 
    _upsert_temperature_reading, 
    _upsert_weight_reading
    )
import logging


logger = logging.getLogger("uvicorn.error") 

router = APIRouter(tags=["Withings Metrics"], prefix="/withings/metrics")

MEASURE_URL = "https://wbsapi.withings.net/measure"
MEASURE_V2_URL = "https://wbsapi.withings.net/v2/measure"
SLEEP_V2_URL = "https://wbsapi.withings.net/v2/sleep"
HEART_V2_URL = "https://wbsapi.withings.net/v2/heart"


def _auth(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


def _post(url: str, headers: dict, data: dict, timeout: int = 30):
    r = requests.post(url, headers=headers, data=data, timeout=timeout)
    if r.status_code != 200:
        try:
            detail = r.json()
        except Exception:
            detail = r.text
        raise HTTPException(status_code=r.status_code, detail=detail)
    j = r.json() or {}
    if j.get("status") != 0:
        return None
    return j



def _user_tz(headers) -> ZoneInfo:
    return ZoneInfo("Europe/Rome")




def _resolve_user_and_tz(db: Session, access_token: str) -> tuple[User, str]:
    """
    Resolve app user + tz from access token by looking up in WithingsAccount table.
    Works even when access_token is stored encrypted.
    """
    # 1) scan accounts and compare decrypted token
    acc = None
    
    rows = db.query(
        WithingsAccount.id,
        WithingsAccount.user_id,
        WithingsAccount.timezone,
        WithingsAccount.access_token,
    ).all()

    for row in rows:
        try:
            if row.access_token:
                plain = decrypt_text(row.access_token)
                if plain == access_token:
                    acc = db.query(WithingsAccount).filter(WithingsAccount.id == row.id).first()
                    break
        except Exception:
            continue

    if not acc:
        raise HTTPException(status_code=404, detail="Withings account not found for this access token")

    user = db.query(User).filter(User.id == acc.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="App user not found")

    return user, (acc.timezone or "UTC")


def _persist_daily_snapshot(db: Session, access_token: str, payload: dict):
    """
    Writes daily rows into StepsDaily, DistanceDaily, and a denormalized DailySnapshot
    for the given date. (Best-effort; caller ignores failures.)
    payload keys expected: date (YYYY-MM-DD), steps, distanceKm, sleepHours, calories
    """
    try:
        user, tz = _resolve_user_and_tz(db, access_token)
    except Exception as e:
        logger.warning(f"Could not resolve user for persistence: {e}")
        return
    
    try:
        day_local = datetime.fromisoformat(payload["date"]).date()

        steps = payload.get("steps")
        distance_km = payload.get("distanceKm")
        sleep_hours = payload.get("sleepHours")
        calories = payload.get("calories")

        # Upsert to specific metric tables
        _upsert_steps_daily(
            db,
            user_id=user.id,
            provider="withings",
            date_local=day_local,
            steps=int(steps) if isinstance(steps, (int, float)) else None,
            calories=float(calories) if isinstance(calories, (int, float)) else None,
        )
        if isinstance(distance_km, (int, float)):
            _upsert_distance_daily(
                db,
                user_id=user.id,
                provider="withings",
                date_local=day_local,
                distance_km=float(distance_km),
            )

        # Upsert snapshot (for fast dashboard read)
        _upsert_daily_snapshot(
            db,
            user_id=user.id,
            provider="withings",
            date_local=day_local,
            steps=int(steps) if isinstance(steps, (int, float)) else None,
            distance_km=float(distance_km) if isinstance(distance_km, (int, float)) else None,
            calories=float(calories) if isinstance(calories, (int, float)) else None,
            sleep_hours=float(sleep_hours) if isinstance(sleep_hours, (int, float)) else None,
            tz=tz,
        )

        db.commit()
    except Exception as e:
        logger.warning(f"Failed to persist daily snapshot: {e}")
        db.rollback()


@router.get("/daily")
def daily_metrics(
    response: Response,
    access_token: str,
    date: str = Query(default=None, description="YYYY-MM-DD"),
    fallback_days: int = Query(3, ge=0, le=14, description="Look back if empty"),
    debug: int = Query(0, description="Set 1 to include raw payloads"),
    db: Session = Depends(get_db),
):
    """
    Withings daily snapshot:
      - steps, distanceKm, (optional calories), sleepHours
      - use roll-up when present, but ALWAYS fill/override with intraday for 'today'
    Also persists results to metrics_daily & intraday (best-effort; UI never breaks).
    """
    if not date:
        date = _date.today().isoformat()

    headers = _auth(access_token)

    def fetch_for(dstr: str):
        steps: Optional[int] = None
        calories: Optional[float] = None
        distance_km: Optional[float] = None
        tzname: Optional[str] = None
        act_json = intr_json = slp_json = None

        # ---------- 1) Daily roll-up ----------
        act_payload = {
            "action": "getactivity",
            "startdateymd": dstr,
            "enddateymd": dstr,
            "data_fields": "steps,distance,calories,totalcalories,timezone",
        }
        act_res = requests.post(MEASURE_V2_URL, headers=headers, data=act_payload, timeout=30)
        if act_res.status_code == 401:
            raise HTTPException(status_code=401, detail="Access token expired or invalid")
        if act_res.status_code == 200:
            act_json = act_res.json() or {}
            if act_json.get("status") == 0:
                activities = (act_json.get("body") or {}).get("activities") or []
                total_steps = 0
                total_dist_m = 0.0
                for a in activities:
                    if not tzname:
                        tzname = a.get("timezone")
                    s = a.get("steps")
                    d_m = a.get("distance")    # meters
                    c = a.get("calories")
                    if isinstance(s, (int, float)):
                        total_steps += int(s)
                    if isinstance(d_m, (int, float)):
                        total_dist_m += float(d_m)
                    if calories is None and isinstance(c, (int, float)):
                        calories = float(c)
                if total_steps > 0:
                    steps = total_steps
                if total_dist_m > 0:
                    distance_km = round(total_dist_m / 1000.0, 2)

        try:
            tz = ZoneInfo(tzname or "Europe/Rome")
        except Exception:
            tz = ZoneInfo("UTC")

        # Build the day window in that TZ
        day_dt = datetime.fromisoformat(dstr).date()
        start_dt = datetime.combine(day_dt, time(0, 0, 0)).replace(tzinfo=tz)
        end_dt = start_dt + timedelta(days=1)

        # ---------- 2) Intraday (ALWAYS for 'today') ----------
        now_tz = datetime.now(tz)
        is_today = (day_dt == now_tz.date())
        end_for_query = min(now_tz, end_dt) if is_today else end_dt

        if is_today or (steps is None or steps == 0) or (distance_km is None):
            intr_payload = {
                "action": "getintradayactivity",
                "startdate": int(start_dt.timestamp()),
                "enddate": int(end_for_query.timestamp()),
                "data_fields": "steps,distance",
            }
            intr_res = requests.post(MEASURE_V2_URL, headers=headers, data=intr_payload, timeout=30)
            if intr_res.status_code == 200:
                intr_json = intr_res.json() or {}
                if intr_json.get("status") == 0:
                    series = (intr_json.get("body") or {}).get("series")
                    intr_steps = 0
                    intr_dist_m = 0.0

                    def add_pair(v):
                        nonlocal intr_steps, intr_dist_m
                        if not isinstance(v, dict):
                            return
                        s = v.get("steps")
                        d = v.get("distance")
                        if isinstance(s, (int, float)):
                            intr_steps += int(s)
                        if isinstance(d, (int, float)):
                            intr_dist_m += float(d)

                    if isinstance(series, list):
                        for it in series or []:
                            add_pair(it or {})
                    elif isinstance(series, dict):
                        keys = list(series.keys())
                        looks_like_metrics = all(
                            isinstance(series.get(k), dict) and
                            all(isinstance(v, (int, float)) for v in (series[k] or {}).values())
                            for k in keys
                        )
                        if looks_like_metrics:
                            for v in (series.get("steps") or {}).values():
                                if isinstance(v, (int, float)):
                                    intr_steps += int(v)
                            for v in (series.get("distance") or {}).values():
                                if isinstance(v, (int, float)):
                                    intr_dist_m += float(v)
                        else:
                            for _k, v in (series or {}).items():
                                add_pair(v)

                    # Merge with roll-up using max (prevents going backwards)
                    if intr_steps > 0:
                        steps = max(int(steps or 0), intr_steps)
                    if intr_dist_m > 0:
                        distance_km = max(float(distance_km or 0.0), round(intr_dist_m / 1000.0, 2))

        # ---------- 3) Sleep summary ----------
        sleep_hours: Optional[float] = None
        slp_payload = {
            "action": "getsummary",
            "startdateymd": dstr,
            "enddateymd": dstr,
            "data_fields": "totalsleepduration,asleepduration",
        }
        slp_res = requests.post(SLEEP_V2_URL, headers=headers, data=slp_payload, timeout=30)
        if slp_res.status_code == 200:
            slp_json = slp_res.json() or {}
            if slp_json.get("status") == 0:
                series = (slp_json.get("body") or {}).get("series") or []
                total_sec = 0
                for item in series:
                    data = item.get("data") or {}
                    if isinstance(data.get("totalsleepduration"), (int, float)):
                        total_sec += int(data["totalsleepduration"])
                    elif isinstance(data.get("asleepduration"), (int, float)):
                        total_sec += int(data["asleepduration"])
                sleep_hours = round(total_sec / 3600.0, 2) if total_sec else None

        # ---------- 4) Persist intraday (today only) ----------
        def _collect_metric_samples(series_obj, key: str) -> list[dict]:
            samples = []
            if isinstance(series_obj, list):
                for it in series_obj or []:
                    if isinstance(it, dict):
                        v = it.get(key)
                        ts = it.get("timestamp") or it.get("time")
                        if isinstance(v, (int, float)) and isinstance(ts, (int, float)):
                            samples.append({"t": int(ts), "v": float(v)})
            elif isinstance(series_obj, dict):
                # shape A: {"steps": {...}, "distance": {...}}
                if isinstance(series_obj.get(key), dict):
                    for ts_str, val in (series_obj[key] or {}).items():
                        try:
                            ts_i = int(ts_str)
                            if isinstance(val, (int, float)):
                                samples.append({"t": ts_i, "v": float(val)})
                        except Exception:
                            continue
                # shape B: {"data": [{timestamp, steps/distance}, ...]}
                elif isinstance(series_obj.get("data"), list):
                    for pt in series_obj["data"]:
                        v = pt.get(key)
                        ts = pt.get("timestamp") or pt.get("time")
                        if isinstance(v, (int, float)) and isinstance(ts, (int, float)):
                            samples.append({"t": int(ts), "v": float(v)})
            # de-dupe + sort
            seen = set()
            out = []
            for s in samples:
                if s["t"] not in seen:
                    seen.add(s["t"])
                    out.append(s)
            out.sort(key=lambda x: x["t"])
            return out

        if is_today and intr_json and (intr_json.get("status") == 0):
            body = intr_json.get("body") or {}
            series = body.get("series")

            steps_samples = _collect_metric_samples(series, "steps")
            dist_samples  = _collect_metric_samples(series, "distance")

            try:
                user, _tz = _resolve_user_and_tz(db, access_token)
                rows_steps = [{
                    "user_id": user.id,
                    "provider": "withings",
                    "date_local": day_dt,
                    "start_at_utc": start_dt.astimezone(ZoneInfo("UTC")),
                    "end_at_utc": end_for_query.astimezone(ZoneInfo("UTC")),
                    "resolution": "var",
                    "samples_json": json.dumps(steps_samples),
                }]
                rows_dist = [{
                    "user_id": user.id,
                    "provider": "withings",
                    "date_local": day_dt,
                    "start_at_utc": start_dt.astimezone(ZoneInfo("UTC")),
                    "end_at_utc": end_for_query.astimezone(ZoneInfo("UTC")),
                    "resolution": "var",
                    "samples_json": json.dumps(dist_samples),
                }]
                if steps_samples:
                    _bulk_upsert_steps_intraday(db, rows_steps)
                if dist_samples:
                    _bulk_upsert_distance_intraday(db, rows_dist)
            except Exception:
                # best-effort cache; don’t break the response
                pass

        # ---------- 5) Build response ----------
        resp = {
            "date": dstr,
            "steps": steps,
            "calories": calories,
            "sleepHours": sleep_hours,
            "distanceKm": distance_km,
        }
        if debug:
            resp["raw"] = {"activity": act_json, "intraday": intr_json, "sleep": slp_json}
        return resp

    def _has_any(r: dict) -> bool:
        return any(r.get(k) is not None for k in ("steps", "distanceKm"))

    # Try requested date
    result = fetch_for(date)

    # If still empty, look back a few days
    if not _has_any(result) and fallback_days > 0:
        base = datetime.fromisoformat(date)
        for i in range(1, fallback_days + 1):
            cand = (base - timedelta(days=i)).date().isoformat()
            r2 = fetch_for(cand)
            if _has_any(r2):
                r2["fallbackFrom"] = date
                response.headers["Cache-Control"] = "no-store"
                # best-effort persist (fallback day)
                try:
                    _persist_daily_snapshot(db, access_token, r2)
                except Exception as e:
                    logger.exception("persist_daily_snapshot failed: %s", e)
                return r2

    # Prevent browser/CDN caching
    response.headers["Cache-Control"] = "no-store"

    # Persist the requested day (best-effort)
    try:
        _persist_daily_snapshot(db, access_token, result)
    except Exception as e:
        logger.exception("persist_daily_snapshot failed: %s", e)

    return result



@router.get("/overview")
def overview(access_token: str):
    """
    Minimal snapshot: latest weight (kg) and resting heart rate (bpm).
    """
    headers = _auth(access_token)

    j = _post(MEASURE_URL, headers, {"action":"getmeas","meastype":"1,11","category":1})
    if not j:
        return {"weightKg": None, "restingHeartRate": None}

    latest_weight = None
    latest_hr = None
    for g in (j.get("body") or {}).get("measuregrps", []):
        for m in g.get("measures", []):
            v = m.get("value")
            u = m.get("unit",0)
            val = v * (10 ** u) if isinstance(v,(int,float)) and isinstance(u,(int,float)) else None
            if m.get("type") == 1 and val is not None:
                latest_weight = val
            if m.get("type") == 11 and val is not None:
                latest_hr = val

    return {"weightKg": latest_weight, "restingHeartRate": latest_hr}



@router.get("/weight/latest")
def weight_latest(access_token: str, lookback_days: int = Query(90, ge=1, le=365),
                  db: Session = Depends(get_db),
                  ):
    """
    Latest weight (kg) within lookback window. Also persists the reading + updates snapshot.
    """
    headers = _auth(access_token)
    j = _post(MEASURE_URL, headers, {"action":"getmeas","meastype":"1","category":1})
    if not j:
        return {"value": None, "latest_date": None}

    groups = (j.get("body") or {}).get("measuregrps", [])
    latest = None
    latest_ts = -1
    latest_group = None

    for g in groups:
        ts = g.get("date", -1)
        for m in g.get("measures", []):
            if m.get("type") == 1:
                v = m.get("value")
                u = m.get("unit", 0)
                val = v * (10 ** u) if isinstance(v,(int,float)) and isinstance(u,(int,float)) else None
                if val is not None and ts > latest_ts:
                    latest_ts = ts
                    latest = (val, ts)
                    latest_group = g

    if not latest:
        return {"value": None, "latest_date": None}

    # Persist (best-effort)
    try:
        user, tz_str = _resolve_user_and_tz(db, access_token)
        from datetime import timezone
        measured_at_utc = datetime.fromtimestamp(latest[1], tz=timezone.utc)

        provider_measure_id = str(latest_group.get("grpid")) if isinstance(latest_group, dict) else None
        device = (latest_group or {}).get("deviceid")
        # Withings payload sometimes has tz offset; if present:
        tz_offset_min = (latest_group or {}).get("timezone")  # often a name, not offset; keep None unless numeric

        _upsert_weight_reading(
            db,
            user_id=user.id,
            provider="withings",
            measured_at_utc=measured_at_utc,
            weight_kg=float(latest[0]),
            fat_pct=None,
            provider_measure_id=provider_measure_id,
            device=str(device) if device is not None else None,
            tz_offset_min=None,
        )
        _update_snapshot_weight(
            db,
            user_id=user.id,
            provider="withings",
            measured_at_utc=measured_at_utc,
            tz_str=tz_str,
            weight_kg=float(latest[0]),
        )
        db.commit()
    except Exception:
        # don't break the endpoint
        pass

    from datetime import timezone
    return {
        "value": latest[0],
        "latest_date": datetime.fromtimestamp(latest[1], tz=timezone.utc).date().isoformat()
    }



@router.get("/weight/history")
def weight_history(
    access_token: str,
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str   = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    headers = _auth(access_token)
    j = _post(MEASURE_URL, headers, {
        "action":"getmeas","meastype":"1","category":1,
        "startdateymd": start, "enddateymd": end
    })
    if not j:
        return {"start": start, "end": end, "items": []}

    items = []
    groups = (j.get("body") or {}).get("measuregrps", [])
    # Resolve user + tz once
    try:
        user, tz_str = _resolve_user_and_tz(db, access_token)
    except Exception:
        user = None
        tz_str = None

    for g in groups:
        w = None
        ts = g.get("date")
        for m in g.get("measures", []):
            if m.get("type") == 1:
                v = m.get("value")
                u = m.get("unit", 0)
                w = v * (10 ** u) if isinstance(v,(int,float)) and isinstance(u,(int,float)) else None
        if w is not None and isinstance(ts, (int, float)):
            items.append({"ts": ts, "weight_kg": w})

            # Persist each reading (best-effort)
            try:
                if user:
                    from datetime import timezone
                    measured_at_utc = datetime.fromtimestamp(ts, tz=timezone.utc)
                    provider_measure_id = str(g.get("grpid")) if isinstance(g, dict) else None
                    device = g.get("deviceid")

                    logger.info(f"Saving weight reading: user={user.id}, weight={w}, ts={ts}, measured_at={measured_at_utc}")
                    
                    _upsert_weight_reading(
                        db,
                        user_id=user.id,
                        provider="withings",
                        measured_at_utc=measured_at_utc,
                        weight_kg=float(w),
                        fat_pct=None,
                        provider_measure_id=provider_measure_id,
                        device=str(device) if device is not None else None,
                        tz_offset_min=None,
                    )
                    _update_snapshot_weight(
                        db,
                        user_id=user.id,
                        provider="withings",
                        measured_at_utc=measured_at_utc,
                        tz_str=tz_str,
                        weight_kg=float(w),
                    )
                    logger.info("Successfully saved weight reading")
            except Exception as e:
                logger.error(f"Failed to save weight reading: {e}")
                pass

    # optional: sort by timestamp
    items.sort(key=lambda x: x["ts"])
    try:
        db.commit()
    except Exception:
        pass

    return {"start": start, "end": end, "items": items}



@router.get("/heart-rate/daily")
def heart_rate_daily(
    access_token: str,
    date: Optional[str] = Query(None, description="YYYY-MM-DD (defaults to today)"),
    db: Session = Depends(get_db),
):
    """
    Daily heart-rate roll-up from Withings (avg/min/max) for the given local day.
    Persists results into HeartRateDaily + DailySnapshot.
    """
    if not date:
        date = _date.today().isoformat()

    headers = _auth(access_token)
    payload = {
        "action": "getactivity",
        "startdateymd": date,
        "enddateymd": date,
        "data_fields": "hr_average,hr_min,hr_max",
    }
    j = _post(MEASURE_V2_URL, headers, payload)
    if not j:
        return {"date": date, "avg_bpm": None, "min_bpm": None, "max_bpm": None, "updatedAt": None}

    acts = (j.get("body") or {}).get("activities") or []
    a0 = acts[0] if acts else {}
    updated_at = a0.get("modified") or a0.get("date")  # epoch seconds if present

    avg_bpm = a0.get("hr_average")
    min_bpm = a0.get("hr_min")
    max_bpm = a0.get("hr_max")

    # Persist (best-effort)
    try:
        user, _tz = _resolve_user_and_tz(db, access_token)
        date_local = datetime.fromisoformat(date).date()

        _upsert_hr_daily(
            db,
            user_id=user.id,
            provider="withings",
            date_local=date_local,
            avg_bpm=float(avg_bpm) if isinstance(avg_bpm, (int, float)) else None,
            min_bpm=float(min_bpm) if isinstance(min_bpm, (int, float)) else None,
            max_bpm=float(max_bpm) if isinstance(max_bpm, (int, float)) else None,
        )

        _update_snapshot_hr(
            db,
            user_id=user.id,
            provider="withings",
            date_local=date_local,
            avg_bpm=float(avg_bpm) if isinstance(avg_bpm, (int, float)) else None,
            min_bpm=float(min_bpm) if isinstance(min_bpm, (int, float)) else None,
            max_bpm=float(max_bpm) if isinstance(max_bpm, (int, float)) else None,
        )

        db.commit()
    except Exception:
        pass

    return {
       "date": date,
        "hr_average": avg_bpm,
        "hr_min": min_bpm,
        "hr_max": max_bpm,
        "avg_bpm": avg_bpm,
        "min_bpm": min_bpm,
        "max_bpm": max_bpm,
        "updatedAt": updated_at,
    }



@router.get("/heart-rate/intraday")
def heart_rate_intraday(
    access_token: str,
    # date-only convenience
    start: Optional[str] = Query(None, description="YYYY-MM-DD (defaults to today, user local)"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD (defaults to start)"),
    minutes: Optional[int] = Query(
        None, ge=1, le=1440,
        description="Lookback window in minutes, ending now (UTC-converted). If set, ignores start/end."
    ),
    start_time: Optional[str] = Query(None, description="HH:MM (local). Used with 'start'."),
    end_time: Optional[str] = Query(None, description="HH:MM (local). Used with 'end' (defaults to now if start==end)."),
    debug: int = Query(0, ge=0, le=1, description="Set 1 to include a small raw hint for debugging")
):
    """
    Intraday heart-rate samples (bpm) via Measure v2 getintradayactivity.
    Modes:
      • minutes lookback ending now (preferred for 'as recent as possible')
      • date-only full days
      • date + HH:MM slice(s)
    Returns: { items: [{ts,bpm}], latest, window, [raw_hint?] }
    """
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    import time as _time_mod

    headers = _auth(access_token)

    # TODO: if you store user tz in DB, use it; this is your current default
    USER_TZ = _user_tz(headers)
    UTC = ZoneInfo("UTC")

    def _to_epoch(dt: datetime) -> int:
        return int(dt.timestamp())

    def _parse_hhmm(hhmm: Optional[str]) -> Tuple[Optional[int], Optional[int]]:
        if not hhmm:
            return None, None
        h, m = hhmm.split(":")
        return int(h), int(m)

    def _ymd_hhmm_local(ymd: str, hhmm: Optional[str], default_end_now=False) -> datetime:
        base = datetime.fromisoformat(ymd).replace(tzinfo=USER_TZ)
        if hhmm:
            h, m = _parse_hhmm(hhmm)
            return base.replace(hour=h or 0, minute=m or 0, second=0, microsecond=0)
        if default_end_now:
            return datetime.now(USER_TZ)
        # start-of-day by default
        return base.replace(hour=0, minute=0, second=0, microsecond=0)

    def _collect(start_unix: int, end_unix: int):
        payload = {
            "action": "getintradayactivity",
            "startdate": start_unix,
            "enddate": end_unix,
            "data_fields": "heart_rate",
        }
        j = _post(MEASURE_V2_URL, headers, payload)
        if not j:
            return [], None

        body = (j.get("body") or {})
        series = body.get("series")
        pts: List[Dict] = []

        # Shape A: list of chunks -> each chunk has data: [{timestamp, hr}, ...]
        if isinstance(series, list):
            for chunk in series or []:
                data_list = chunk.get("data") if isinstance(chunk, dict) else None
                if isinstance(data_list, list):
                    for pt in data_list:
                        bpm = pt.get("hr", pt.get("heart_rate"))
                        ts = pt.get("timestamp") or pt.get("time")
                        if isinstance(bpm, (int, float)) and isinstance(ts, (int, float)):
                            pts.append({"ts": int(ts), "bpm": float(bpm)})

        # Shape B: dict with 'data' list
        if isinstance(series, dict) and isinstance(series.get("data"), list):
            for pt in series["data"]:
                bpm = pt.get("hr", pt.get("heart_rate"))
                ts = pt.get("timestamp") or pt.get("time")
                if isinstance(bpm, (int, float)) and isinstance(ts, (int, float)):
                    pts.append({"ts": int(ts), "bpm": float(bpm)})

        # Shape C: dict of metric maps e.g. {'hr': {'1695523200': 72, ...}}
        if isinstance(series, dict):
            for key in ("hr", "heart_rate"):
                mm = series.get(key)
                if isinstance(mm, dict):
                    for ts_str, val in mm.items():
                        # keys may be str epochs
                        try:
                            ts_i = int(ts_str)
                            pts.append({"ts": ts_i, "bpm": float(val)})
                        except Exception:
                            continue

        # De-dupe + sort
        seen = set()
        pts = [p for p in pts if not (p["ts"] in seen or seen.add(p["ts"]))]
        pts.sort(key=lambda x: x["ts"])
        return pts, (body if debug else None)

    # ------------------ Build query window(s) ------------------
    items: List[Dict] = []
    raw_hint = None
    window_utc: Tuple[int, int] = (None, None)  # type: ignore

    if minutes:
        # Rolling window ending now (local -> UTC)
        end_local = datetime.now(USER_TZ)
        start_local = end_local - timedelta(minutes=minutes)
        s = _to_epoch(start_local.astimezone(UTC))
        e = _to_epoch(end_local.astimezone(UTC))
        # For "today" safety: cap end at current epoch to avoid slight future rounding
        e = min(e, int(_time_mod.time()))
        pts, raw = _collect(s, e)
        items.extend(pts)
        raw_hint = raw
        window_utc = (s, e)
    else:
        # Date-only or date + HH:MM
        if not start:
            start = datetime.now(USER_TZ).date().isoformat()
        if not end:
            end = start

        start_date = datetime.fromisoformat(start).date()
        end_date = datetime.fromisoformat(end).date()
        if end_date < start_date:
            # swap defensively
            start_date, end_date = end_date, start_date

        cur = start_date
        overall_s = None
        overall_e = None

        while cur <= end_date:
            # start bound
            if cur == start_date:
                s_local = _ymd_hhmm_local(cur.isoformat(), start_time, default_end_now=False)
            else:
                s_local = _ymd_hhmm_local(cur.isoformat(), None, default_end_now=False)

            # end bound
            if cur == end_date:
                # on the final day: use end_time if given, else now (if same single day) else end-of-day
                same_single_day = (start_date == end_date)
                if end_time:
                    e_local = _ymd_hhmm_local(cur.isoformat(), end_time, default_end_now=False)
                elif same_single_day:
                    e_local = datetime.now(USER_TZ)
                else:
                    e_local = s_local.replace(hour=23, minute=59, second=59, microsecond=0)
            else:
                e_local = s_local.replace(hour=23, minute=59, second=59, microsecond=0)

            # Convert to UTC epochs and clamp end to "now"
            s = _to_epoch(s_local.astimezone(UTC))
            e = _to_epoch(min(e_local, datetime.now(USER_TZ)).astimezone(UTC))
            if e > s:
                pts, raw = _collect(s, e)
                items.extend(pts)
                raw_hint = raw_hint or raw
                overall_s = s if overall_s is None else min(overall_s, s)
                overall_e = e if overall_e is None else max(overall_e, e)

            cur += timedelta(days=1)

        if overall_s is not None and overall_e is not None:
            window_utc = (overall_s, overall_e)

    # ------------------ Response ------------------
    resp: Dict = {"items": items}
    if items:
        resp["latest"] = max(items, key=lambda x: x["ts"])
    if window_utc[0] is not None:
        resp["window"] = {"start_utc": window_utc[0], "end_utc": window_utc[1]}
    if debug and raw_hint is not None:
        resp["raw_hint"] = {
            "has_series": isinstance((raw_hint or {}).get("series"), (list, dict)),
            "series_type": type((raw_hint or {}).get("series")).__name__,
            "keys": list((raw_hint or {}).keys())[:8],
        }
    return resp



@router.get("/spo2")
def spo2(
    access_token: str,
    start: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    """
    Latest or range of SpO₂ (%). Persists each reading and updates the daily snapshot.
    """
    headers = _auth(access_token)
    payload = {"action": "getmeas", "meastype": "54", "category": 1}
    if start and end:
        payload.update({"startdateymd": start, "enddateymd": end})
    j = _post(MEASURE_URL, headers, payload)
    if not j:
        return {"items": []}

    items = []
    groups = (j.get("body") or {}).get("measuregrps", [])

    # Resolve user + tz once (best-effort)
    try:
        user, tz_str = _resolve_user_and_tz(db, access_token)
    except Exception:
        user = None
        tz_str = None

    for g in groups:
        ts = g.get("date")
        reading_id = str(g.get("grpid")) if isinstance(g, dict) else None

        for m in g.get("measures", []):
            if m.get("type") == 54:
                v = m.get("value")
                u = m.get("unit", 0)
                p = v * (10 ** u) if isinstance(v, (int, float)) and isinstance(u, (int, float)) else None
                if p is not None:
                    items.append({"ts": ts, "percent": p})
                    # Persist (best-effort)
                    try:
                        if user and isinstance(ts, (int, float)):
                            from datetime import timezone
                            measured_at_utc = datetime.fromtimestamp(ts, tz=timezone.utc)
                            _upsert_spo2_reading(
                                db,
                                user_id=user.id,
                                provider="withings",
                                measured_at_utc=measured_at_utc,
                                avg_pct=float(p),
                                min_pct=None,
                                type_="spot",
                                reading_id=reading_id,
                            )
                            _update_snapshot_spo2(
                                db,
                                user_id=user.id,
                                provider="withings",
                                measured_at_utc=measured_at_utc,
                                tz_str=tz_str,
                                avg_pct=float(p),
                            )
                    except Exception:
                        pass

    # Commit once
    try:
        db.commit()
    except Exception:
        pass

    if not (start and end) and items:
        latest = max(items, key=lambda x: x["ts"])
        return {"latest": latest}
    return {"items": items}



@router.get("/temperature")
def temperature(
    access_token: str,
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str   = Query(..., description="YYYY-MM-DD"),
    tz: str    = Query("UTC", description="IANA tz like Europe/Rome"),
    db: Session = Depends(get_db),
):
    """
    Manual body temperature (attrib=2), °C.
    Always returns newest entry first. Also persists readings and updates the daily snapshot.
    """
    from zoneinfo import ZoneInfo
    import datetime as dt

    headers = _auth(access_token)
    payload = {
        "action": "getmeas",
        "meastype": "71",           # body temp
        "startdateymd": start,
        "enddateymd": end,
    }
    j = _post(MEASURE_URL, headers, payload)

    items = []
    # Resolve user + tz (best-effort)
    try:
        user, tz_str = _resolve_user_and_tz(db, access_token)
    except Exception:
        user = None
        tz_str = tz

    for g in (j or {}).get("body", {}).get("measuregrps", []):
        if g.get("attrib") != 2:     # manual only
            continue
        ts = g.get("date")
        body_val = None

        for m in g.get("measures", []):
            if m.get("type") == 71:
                v, u = m.get("value"), m.get("unit", 0)
                body_val = v * (10 ** u)

        if isinstance(ts, (int, float)) and isinstance(body_val, (int, float)):
            # collect item for response
            items.append({
                "ts": ts,
                "date_local": dt.datetime.fromtimestamp(ts, ZoneInfo(tz)).isoformat(),
                "body_c": float(body_val),
            })

            # persist (best-effort)
            try:
                if user:
                    from datetime import timezone
                    measured_at_utc = dt.datetime.fromtimestamp(ts, tz=timezone.utc)
                    _upsert_temperature_reading(
                        db,
                        user_id=user.id,
                        provider="withings",
                        measured_at_utc=measured_at_utc,
                        body_c=float(body_val),
                        skin_c=None,
                        delta_c=None,
                    )
                    _update_snapshot_temperature(
                        db,
                        user_id=user.id,
                        provider="withings",
                        measured_at_utc=measured_at_utc,
                        tz_str=tz_str,
                        body_c=float(body_val),
                        skin_c=None,
                    )
            except Exception:
                pass

    # sort newest first
    items.sort(key=lambda x: x["ts"], reverse=True)

    # commit once
    try:
        db.commit()
    except Exception:
        pass

    return {
        "start": start,
        "end": end,
        "tz": tz,
        "items": items,
        "latest": items[0] if items else None
    }



@router.get("/sleep")
def sleep_summary(access_token: str,
                  date: str = Query(default=None, description="YYYY-MM-DD (defaults to today)")):
    """
    Sleep for the given local day:
      - sleepHours (sum of totalsleepduration/asleepduration)
    """
    if not date:
        date = _date.today().isoformat()
    headers = _auth(access_token)
    j = _post(SLEEP_V2_URL, headers, {
        "action":"getsummary",
        "startdateymd":date,
        "enddateymd":date,
        "data_fields": "totalsleepduration,asleepduration"
        })
    if not j:
        return {"date": date, "sleepHours": None}
    series = (j.get("body") or {}).get("series") or []
    total_sec = 0
    for item in series:
        data = item.get("data") or {}
        if isinstance(data.get("totalsleepduration"), (int, float)):
            total_sec += data["totalsleepduration"]
        elif isinstance(data.get("asleepduration"), (int, float)):
            total_sec += data["asleepduration"]
    hours = round(total_sec / 3600.0, 2) if total_sec else None
    return {"date": date, "sleepHours": hours}



@router.get("/ecg")
def ecg_list(
    access_token: str,
    start: Optional[str] = Query(None, description="YYYY-MM-DD (default: 7 days ago)"),
    end: Optional[str]   = Query(None, description="YYYY-MM-DD (default: today)"),
    tz: str              = Query("Europe/Rome", description="IANA timezone for window"),
    limit: int           = Query(25, ge=1, le=200, description="Max ECG items"),
    db: Session = Depends(get_db),
):
    """
    List ECG recordings (newest first) within the [start,end] local-day window.
    Persists metadata and updates daily snapshot with the latest-of-day ECG.
    """
    try:
        z = ZoneInfo(tz)
    except Exception:
        z = ZoneInfo("Europe/Rome")

    today_local = datetime.now(z).date()
    start_day = datetime.fromisoformat(start).date() if start else (today_local - timedelta(days=7))
    end_day   = datetime.fromisoformat(end).date()   if end   else today_local
    if end_day < start_day:
        start_day, end_day = end_day, start_day

    start_epoch = int(datetime.combine(start_day, time(0, 0, 0), tzinfo=z).timestamp())
    end_epoch   = int(datetime.combine(end_day,   time(23, 59, 59), tzinfo=z).timestamp())

    headers = _auth(access_token)
    j = _post(HEART_V2_URL, headers, {"action": "list", "startdate": start_epoch, "enddate": end_epoch})
    series = ((j or {}).get("body") or {}).get("series") or []

    # Resolve user+tz once (best-effort)
    try:
        user, tz_str = _resolve_user_and_tz(db, access_token)
    except Exception:
        user = None
        tz_str = tz

    items: List[Dict] = []
    for s in series:
        signalid = s.get("signalid") or s.get("id")
        ts = s.get("timestamp") or s.get("startdate") or s.get("time")
        if not isinstance(ts, (int, float)):
            continue
        hr = s.get("heart_rate") or s.get("hr")
        afib = s.get("afib") or s.get("is_afib")
        cls = (s.get("classification") or s.get("algo_result"))
        deviceid = s.get("deviceid")
        model = s.get("model")
        duration_s = s.get("duration") if isinstance(s.get("duration"), (int, float)) else None

        items.append({
            "signalid": signalid,
            "ts": int(ts),
            "time_iso": datetime.utcfromtimestamp(int(ts)).isoformat() + "Z",
            "heart_rate": hr,
            "afib": afib,
            "classification": cls,
            "deviceid": deviceid,
            "model": model,
        })

        # Persist (best-effort)
        try:
            if user:
                from datetime import timezone
                start_at_utc = datetime.fromtimestamp(int(ts), tz=timezone.utc)
                # Withings list doesn’t always include an end; if absent, use start as end
                end_at_utc = start_at_utc
                _upsert_ecg_record(
                    db,
                    user_id=user.id,
                    provider="withings",
                    record_id=str(signalid) if signalid is not None else None,
                    start_at_utc=start_at_utc,
                    end_at_utc=end_at_utc,
                    hr_bpm=float(hr) if isinstance(hr, (int, float)) else None,
                    classification=str(cls) if cls is not None else None,
                    duration_s=int(duration_s) if isinstance(duration_s, (int, float)) else None,
                    file_ref=None,
                )
        except Exception:
            pass

    # Newest first + limit
    items.sort(key=lambda x: x["ts"], reverse=True)
    if len(items) > limit:
        items = items[:limit]

    # Update daily snapshot using the newest ECG in the response window
    try:
        if user and items:
            latest = items[0]
            from datetime import timezone
            latest_dt = datetime.fromtimestamp(latest["ts"], tz=timezone.utc)
            _update_snapshot_ecg(
                db,
                user_id=user.id,
                provider="withings",
                measured_at_utc=latest_dt,
                tz_str=tz_str,
                hr_bpm=float(latest["heart_rate"]) if isinstance(latest.get("heart_rate"), (int, float)) else None,
            )
        db.commit()
    except Exception:
        pass

    return {
        "start": start or start_day.isoformat(),
        "end": end or end_day.isoformat(),
        "tz": tz,
        "count": len(items),
        "latest": (items[0] if items else None),
        "items": items,
    }



@router.get("/hrv")
def hrv_nightly(
    access_token: str,
    start: Optional[str] = Query(None, description="YYYY-MM-DD (default: today)"),
    end: Optional[str]   = Query(None, description="YYYY-MM-DD (default: start)"),
    tz: str              = Query("Europe/Rome", description="IANA timezone for local days"),
    fallback_yesterday: int = Query(1, ge=0, le=1, description="If today empty, also fetch yesterday")
):
    """
    Nightly HRV from Withings Sleep v2 summary.
    Returns per-day RMSSD (ms) and, if present, SDNN (ms).
    Availability depends on device/feature; missing days return no item.
    """
    try:
        z = ZoneInfo(tz)
    except Exception:
        z = ZoneInfo("Europe/Rome")

    # Build default day window in user's tz
    from datetime import datetime as _dt, timedelta as _td
    today_local = _dt.now(z).date()
    if not start:
        start = today_local.isoformat()
    if not end:
        end = start

    # Optionally extend to yesterday if today is the only day and ends up empty
    query_windows = [(start, end)]
    if fallback_yesterday and start == end:
        y = ( _dt.fromisoformat(start).date() - _td(days=1) ).isoformat()
        query_windows.append((y, y))

    headers = _auth(access_token)

    def fetch(d0: str, d1: str):
        payload = {
            "action": "getsummary",
            "startdateymd": d0,
            "enddateymd": d1,
            # Ask for HR/HRV fields plus sleep duration (not strictly required)
            "data_fields": "rmssd,sdnn,hr_average,asleepduration,totalsleepduration"
        }
        j = _post(SLEEP_V2_URL, headers, payload)
        items = []
        if not j:
            return items
        for row in ((j.get("body") or {}).get("series") or []):
            d = row.get("date") or row.get("startdateymd")  # some payloads add 'date'
            data = row.get("data") or {}
            rmssd = data.get("rmssd")
            sdnn  = data.get("sdnn")
            hravg = data.get("hr_average")
            # Only add when we have at least RMSSD or SDNN
            if isinstance(rmssd, (int, float)) or isinstance(sdnn, (int, float)):
                items.append({
                    "date": d,
                    "rmssd_ms": float(rmssd) if isinstance(rmssd, (int, float)) else None,
                    "sdnn_ms":  float(sdnn)  if isinstance(sdnn,  (int, float)) else None,
                    "hr_average": float(hravg) if isinstance(hravg, (int, float)) else None,
                })
        # Sort by date asc
        items.sort(key=lambda x: (x.get("date") or ""))
        return items

    all_items = []
    for (d0, d1) in query_windows:
        got = fetch(d0, d1)
        all_items.extend(got)
        # If we requested today only and got something, no need to also return yesterday
        if start == end and got:
            break

    # De-dup by date (keep last)
    dedup = {}
    for it in all_items:
        dedup[it["date"]] = it
    items = list(dedup.values())
    items.sort(key=lambda x: (x.get("date") or ""))

    return {
        "start": start,
        "end": end,
        "tz": tz,
        "items": items,
        "latest": (items[-1] if items else None)
    }


@router.get("/steps/series")
def steps_series(
    access_token: str,
    from_: str = Query(..., alias="from", description="YYYY-MM-DD"),
    to:   str = Query(..., alias="to",   description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    """
    Returns a per-day series between [from, to] inclusive.
    Each item: { date, steps, distance_km }
    Internally reuses the existing /daily logic (so today gets intraday merge).
    """
    # Parse & normalize dates
    try:
        start_date = datetime.fromisoformat(from_).date()
        end_date   = datetime.fromisoformat(to).date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    if end_date < start_date:
        start_date, end_date = end_date, start_date

    items = []
    cur = start_date
    while cur <= end_date:
        # Reuse the daily handler so we keep all your intraday/merge/persist rules
        daily = daily_metrics(
            response=Response(),
            access_token=access_token,
            date=cur.isoformat(),
            fallback_days=0,  # don’t jump to other days in a range call
            debug=0,
            db=db,
        )
        steps = daily.get("steps")
        dist_km = daily.get("distanceKm")  # daily returns camelCase; we expose snake_case

        items.append({
            "date": cur.isoformat(),
            "steps": int(steps or 0),
            "distance_km": float(dist_km) if isinstance(dist_km, (int, float)) else 0.0,
        })
        cur += timedelta(days=1)

    # Optional: sort (already ascending) and return
    return {"items": items}




# Cache helpers --------------------------------------------------

@router.get("/weight/history/cached")
def weight_history_cached(
    access_token: str,
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    """Try to get weight history data from cache first. If not available, returns 404."""
    try:
        user, _tz = _resolve_user_and_tz(db, access_token)
        
        try:
            start_date = datetime.strptime(start, "%Y-%m-%d").date()
            end_date = datetime.strptime(end, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

        from app.db.crud.metrics import get_weight_history
        items = get_weight_history(db, user.id, "withings", start_date, end_date)
        
        if not items:
            raise HTTPException(status_code=404, detail="No cached weight data found for this date range")
        
        return {
            "start": start,
            "end": end,
            "items": items,
            "fromCache": True
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Failed to fetch cached weight data: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch cached data")


@router.get("/heart-rate/daily/cached/{date}")
def heart_rate_daily_cached(
    date: str,
    access_token: str,
    db: Session = Depends(get_db),
):
    """Try to get heart rate data from cache first. If not available, returns empty response."""
    try:
        # Convert date string to date object
        try:
            date_local = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
            
        # Get user from access token
        user, _ = _resolve_user_and_tz(db, access_token)
        
        # Get heart rate data from cache
        from app.db.crud.metrics import get_heart_rate_daily
        data = get_heart_rate_daily(db, user.id, "withings", date_local)
        
        if not data:
            raise HTTPException(status_code=404, detail="No cached heart rate data found for this date")
            
        return data
        
    except Exception as e:
        logger.warning(f"Failed to fetch cached heart rate data: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch cached data")

@router.get("/distance/daily/cached/{date}")
def distance_daily_cached(
    date: str,
    access_token: str,
    db: Session = Depends(get_db),
):
    """Try to get distance data from cache first. If not available, returns empty response."""
    try:
        # Convert date string to date object
        try:
            date_local = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
            
        # Get user from access token
        user, _ = _resolve_user_and_tz(db, access_token)
        
        # Get distance data from cache
        from app.db.crud.metrics import get_distance_daily
        data = get_distance_daily(db, user.id, "withings", date_local)
        
        if not data:
            raise HTTPException(status_code=404, detail="No cached distance data found for this date")
            
        return data
        
    except Exception as e:
        logger.warning(f"Failed to fetch cached distance data: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch cached data")
