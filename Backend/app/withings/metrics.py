from fastapi import APIRouter, HTTPException, Query, Response, Depends
import requests
from typing import Optional, List, Dict, Tuple
from datetime import datetime, timedelta,time, date as _date, timezone as _tz
from zoneinfo import ZoneInfo
from sqlalchemy.orm import Session
from app.dependencies import get_db, get_current_user
from app.db.models import User, MetricDaily, MetricIntraday
from app.db.models.withings_account import WithingsAccount
from app.utils.crypto import decrypt_text, encrypt_text
from app.withings.auth import refresh_withings_token
from sqlalchemy.dialects.postgresql import insert



router = APIRouter(tags=["Withings Metrics"], prefix="/withings/metrics")

MEASURE_URL = "https://wbsapi.withings.net/measure"
MEASURE_V2_URL = "https://wbsapi.withings.net/v2/measure"
SLEEP_V2_URL = "https://wbsapi.withings.net/v2/sleep"
HEART_V2_URL = "https://wbsapi.withings.net/v2/heart"



def _resolve_withings_access_token(db: Session, app_user: User) -> str:
    acc = (
        db.query(WithingsAccount)
        .filter(WithingsAccount.user_id == app_user.id)
        .first()
    )
    if not acc or not acc.refresh_token:
        raise HTTPException(status_code=401, detail="Withings account not linked")

    try:
        rt_plain = decrypt_text(acc.refresh_token)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt refresh token")

    refreshed = refresh_withings_token(rt_plain)  # returns dict with access_token
    access_token = refreshed.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="Failed to refresh access token")

    # Optional: persist rotation/expiry if provided
    new_refresh = refreshed.get("refresh_token")
    expires_in = refreshed.get("expires_in")
    if new_refresh or isinstance(expires_in, (int, float)):
        try:
            if new_refresh:
                acc.refresh_token = encrypt_text(new_refresh)
            if isinstance(expires_in, (int, float)):
                acc.expires_at = datetime.now(_tz.utc) + timedelta(seconds=int(expires_in))
            db.commit()
        except Exception:
            db.rollback()
            # non-fatal
            pass

    return access_token


# --- tiny 15s memo (per user+key) to absorb duplicates (optional)
_MEMO: Dict[Tuple[int, str], Tuple[float, Dict]] = {}
_MEMO_TTL_SEC = 15

def _memo_get(user_id: int, key: str):
    hit = _MEMO.get((user_id, key))
    if not hit:
        return None
    ts, val = hit
    if (datetime.now().timestamp() - ts) <= _MEMO_TTL_SEC:
        return val
    return None

def _memo_put(user_id: int, key: str, value: Dict):
    _MEMO[(user_id, key)] = (datetime.now().timestamp(), value)
    return value


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


def _resolve_user_and_tz(
    db: Session,
    access_token: str,
    app_user: User | None = None,
) -> tuple[User, str]:
    """
    Prefer the authenticated app user (if provided via get_current_user).
    Fallback: derive Withings userid from the access token, then map to our
    WithingsAccount -> User. Returns (user, tz_string).
    """
    if app_user:
        acc = db.query(WithingsAccount).filter(WithingsAccount.user_id == app_user.id).first()
        tz = (acc.timezone if acc else None) or "UTC"
        return app_user, tz

    # Fallback: call Withings to get the user's withings_user_id
    headers = {"Authorization": f"Bearer {access_token}"}
    r = requests.post(
        "https://wbsapi.withings.net/v2/user",
        headers=headers,
        data={"action": "getuserslist"},
        timeout=15,
    )
    wid = None
    if r.status_code == 200:
        j = r.json() or {}
        if j.get("status") == 0:
            users = (j.get("body") or {}).get("users") or []
            if users:
                wid = str(users[0].get("id"))

    if not wid:
        raise HTTPException(status_code=401, detail="Cannot resolve Withings user from access token")

    acc = db.query(WithingsAccount).filter(WithingsAccount.withings_user_id == wid).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Linked Withings account not found")

    user = db.query(User).filter(User.id == acc.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="App user not found")

    return user, (acc.timezone or "UTC")



def _upsert_daily(
    db: Session,
    *,
    user_id,
    provider: str,
    metric: str,
    date_local,            # datetime.date
    value: float,
    unit: str | None,
    tz: str | None = None,
    source_updated_at: datetime | None = None,
):
    stmt = insert(MetricDaily).values(
        user_id=user_id,
        provider=provider,
        metric=metric,
        date_local=date_local,
        value=value,
        unit=unit,
        tz=tz,
        source_updated_at=source_updated_at,
    )
    # relies on a unique constraint on (user_id, provider, metric, date_local)
    stmt = stmt.on_conflict_do_update(
        index_elements=["user_id", "provider", "metric", "date_local"],
        set_={
            "value": stmt.excluded.value,
            "unit": stmt.excluded.unit,
            "tz": stmt.excluded.tz,
            "source_updated_at": stmt.excluded.source_updated_at,
            "updated_at": datetime.utcnow(),
        },
    )
    db.execute(stmt)
    db.commit()


def _bulk_upsert_intraday(db: Session, rows: list[dict]):
    if not rows:
        return
    # rows: dicts with keys matching MetricIntraday columns
    stmt = insert(MetricIntraday).values(rows)
    # unique on (user_id, provider, metric, ts_utc)
    stmt = stmt.on_conflict_do_update(
        index_elements=["user_id", "provider", "metric", "ts_utc"],
        set_={
            "value": stmt.excluded.value,
            "unit": stmt.excluded.unit,
            "date_local": stmt.excluded.date_local,
            "tz": stmt.excluded.tz,
            "updated_at": datetime.utcnow(),
        },
    )
    db.execute(stmt)
    db.commit()


def _persist_daily_snapshot(db: Session, access_token: str, app_user: User | None, payload: dict):
    """Writes steps, distance_km, sleep_hours, calories_total into metrics_daily."""
    user, tz = _resolve_user_and_tz(db, access_token, app_user)
    day_local = datetime.fromisoformat(payload["date"]).date()

    def upsert(metric: str, value: float, unit: str | None):
        stmt = insert(MetricDaily).values(
            user_id=user.id,
            provider="withings",
            metric=metric,
            date_local=day_local,
            value=float(value),
            unit=unit,
            tz=tz,
        ).on_conflict_do_update(
            index_elements=["user_id", "provider", "metric", "date_local"],
            set_={
                "value": float(value),
                "unit": unit,
                "tz": tz,
                "updated_at": datetime.utcnow(),
            },
        )
        db.execute(stmt)

    if payload.get("steps") is not None:
        upsert("steps", payload["steps"], "count")
    if payload.get("distanceKm") is not None:
        upsert("distance_km", payload["distanceKm"], "km")
    if payload.get("sleepHours") is not None:
        upsert("sleep_hours", payload["sleepHours"], "h")
    if payload.get("calories") is not None:
        upsert("calories_total", payload["calories"], "kcal")

    db.commit()


@router.get("/daily")
def daily_metrics(
    response: Response,
    date: str = Query(default=None, description="YYYY-MM-DD"),
    fallback_days: int = Query(3, ge=0, le=14, description="Look back if empty"),
    debug: int = Query(0, description="Set 1 to include raw payloads"),
    db: Session = Depends(get_db),
    app_user: User = Depends(get_current_user),
):
    """
    Withings daily snapshot:
      - steps, distanceKm, sleepHours
      - use roll-up when present, but ALWAYS fill/override with intraday for 'today'
    Also persists results to metrics_daily (best-effort; UI never breaks).
    """
    if not date:
        date = _date.today().isoformat()


    if not app_user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # ---- Resolve a fresh Withings access token from the user's stored refresh_token
    acc = (
        db.query(WithingsAccount)
        .filter(WithingsAccount.user_id == app_user.id)
        .first()
    )
    if not acc or not acc.refresh_token:
        raise HTTPException(status_code=400, detail="Withings account not linked")

    try:
        rt_plain = decrypt_text(acc.refresh_token)
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to read refresh token")

    def _refresh_once() -> str:
        refreshed = refresh_withings_token(rt_plain)  # returns dict
        at = refreshed.get("access_token")
        if not at:
            raise HTTPException(status_code=400, detail="Failed to refresh access token")
        return at

    try:  # returns dict with access_token
        access_token = _refresh_once()
        if not access_token:
            raise HTTPException(status_code=400, detail="Failed to refresh access token")
    except HTTPException:
        
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Token refresh error")


    headers = _auth(access_token)

    def fetch_for(dstr: str):
        steps: Optional[int] = None
        # calories: Optional[float] = None
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
                    if isinstance(s, (int, float)):
                        total_steps += int(s)
                    if isinstance(d_m, (int, float)):
                        total_dist_m += float(d_m)
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

        resp = {
            "date": dstr,
            "steps": steps,
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
                    _persist_daily_snapshot(db, access_token, app_user, r2)
                except Exception:
                    pass
                return r2

    # Prevent browser/CDN caching
    response.headers["Cache-Control"] = "no-store"

    # Persist the requested day (best-effort)
    try:
        _persist_daily_snapshot(db, access_token, app_user, result)
    except Exception:
        pass

    return result


@router.get("/overview")
def overview(
    response: Response,
    db: Session = Depends(get_db),
    app_user: User = Depends(get_current_user),
):
    """
    Minimal snapshot: latest weight (kg) and resting heart rate (bpm).
    JWT-only: resolves Withings token server-side.
    """
    if not app_user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    cache_key = "overview"
    cached = _memo_get(app_user.id, cache_key)
    if cached is not None:
        response.headers["Cache-Control"] = "no-store"
        return cached

    access_token = _resolve_withings_access_token(db, app_user)
    headers = _auth(access_token)

    # 1=weight, 11=HR; category=1 = measurements
    j = _post(MEASURE_URL, headers, {"action": "getmeas", "meastype": "1,11", "category": 1})
    latest_weight = None
    latest_hr = None
    for g in (j.get("body") or {}).get("measuregrps", []):
        for m in g.get("measures", []):
            v = m.get("value"); u = m.get("unit", 0)
            val = v * (10 ** u) if isinstance(v, (int, float)) and isinstance(u, (int, float)) else None
            if m.get("type") == 1 and val is not None:
                latest_weight = val
            if m.get("type") == 11 and val is not None:
                latest_hr = val

    resp = {"weightKg": latest_weight, "restingHeartRate": latest_hr}
    response.headers["Cache-Control"] = "no-store"
    return _memo_put(app_user.id, cache_key, resp)



@router.get("/weight/latest")
def weight_latest(
    lookback_days: int = Query(90, ge=1, le=365),
    db: Session = Depends(get_db),
    app_user: User = Depends(get_current_user),
):
    """
    Latest weight (kg) within lookback window.
    Uses the app session (JWT) to resolve a fresh Withings access token.
    """
    # 1) Find the user's Withings account
    acc = (
        db.query(WithingsAccount)
        .filter(WithingsAccount.user_id == app_user.id)
        .first()
    )
    if not acc or not acc.refresh_token:
        raise HTTPException(status_code=401, detail="Withings account not linked")

    # 2) Refresh to a short-lived access token
    try:
        rt_plain = decrypt_text(acc.refresh_token)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt refresh token")

    refreshed = refresh_withings_token(rt_plain)  # returns dict with access_token
    access_token = refreshed.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="Failed to refresh access token")

    # 3) Call Withings for weight
    headers = _auth(access_token)
    j = _post(MEASURE_URL, headers, {"action": "getmeas", "meastype": "1", "category": 1})
    if not j:
        return {"value": None, "latest_date": None}

    groups = (j.get("body") or {}).get("measuregrps", [])
    latest = None
    latest_ts = -1
    for g in groups:
        ts = g.get("date", -1)
        # optional window filter by lookback_days if you want to enforce it later
        for m in g.get("measures", []):
            if m.get("type") == 1:
                v = m.get("value")
                u = m.get("unit", 0)
                val = v * (10 ** u) if isinstance(v, (int, float)) and isinstance(u, (int, float)) else None
                if val is not None and ts > latest_ts:
                    latest_ts = ts
                    latest = (val, ts)

    if not latest:
        return {"value": None, "latest_date": None}

    from datetime import datetime, timezone
    return {
        "value": latest[0],
        "latest_date": datetime.fromtimestamp(latest[1], tz=timezone.utc).date().isoformat(),
    }


@router.get("/weight/history")
def weight_history(
    response: Response,
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    app_user: User = Depends(get_current_user),
):
    if not app_user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    cache_key = f"weight_hist:{start}:{end}"
    cached = _memo_get(app_user.id, cache_key)
    if cached is not None:
        response.headers["Cache-Control"] = "no-store"
        return cached

    access_token = _resolve_withings_access_token(db, app_user)
    headers = _auth(access_token)

    j = _post(MEASURE_URL, headers, {
        "action": "getmeas",
        "meastype": "1",
        "category": 1,
        "startdateymd": start,
        "enddateymd": end,
    })
    items = []
    for g in (j.get("body") or {}).get("measuregrps", []):
        w = None
        for m in g.get("measures", []):
            if m.get("type") == 1:
                v = m.get("value"); u = m.get("unit", 0)
                w = v * (10 ** u) if isinstance(v,(int,float)) and isinstance(u,(int,float)) else None
        if w is not None:
            items.append({"date": _date.fromtimestamp(g.get("date")).isoformat(), "weight": w})
    items.sort(key=lambda x: x["date"])

    resp = {"start": start, "end": end, "items": items}
    response.headers["Cache-Control"] = "no-store"
    return _memo_put(app_user.id, cache_key, resp)


@router.get("/heart-rate/daily")
def heart_rate_daily(
    response: Response,
    date: Optional[str] = Query(None, description="YYYY-MM-DD (defaults to today)"),
    db: Session = Depends(get_db),
    app_user: User = Depends(get_current_user),
):
    if not app_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not date:
        date = _date.today().isoformat()

    cache_key = f"hr_daily:{date}"
    cached = _memo_get(app_user.id, cache_key)
    if cached is not None:
        response.headers["Cache-Control"] = "no-store"
        return cached

    access_token = _resolve_withings_access_token(db, app_user)
    headers = _auth(access_token)
    payload = {
        "action": "getactivity",
        "startdateymd": date,
        "enddateymd": date,
        "data_fields": "hr_average,hr_min,hr_max"
    }
    j = _post(MEASURE_V2_URL, headers, payload)
    acts = (j.get("body") or {}).get("activities") or []
    a0 = acts[0] if acts else {}
    updated_at = a0.get("modified") or a0.get("date")

    resp = {
        "date": date,
        "hr_average": a0.get("hr_average"),
        "hr_min": a0.get("hr_min"),
        "hr_max": a0.get("hr_max"),
        "updatedAt": updated_at
    }
    response.headers["Cache-Control"] = "no-store"
    return _memo_put(app_user.id, cache_key, resp)


@router.get("/heart-rate/intraday")
def heart_rate_intraday(
    response: Response,
    start: Optional[str] = Query(None, description="YYYY-MM-DD (defaults to today, user local)"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD (defaults to start)"),
    minutes: Optional[int] = Query(None, ge=1, le=1440),
    start_time: Optional[str] = Query(None, description="HH:MM (local)"),
    end_time: Optional[str] = Query(None, description="HH:MM (local)"),
    debug: int = Query(0, ge=0, le=1),
    db: Session = Depends(get_db),
    app_user: User = Depends(get_current_user),
):
    if not app_user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # small memo key (captures the query shape)
    key_bits = [f"m={minutes}" if minutes else "", f"s={start}" if start else "", f"e={end}" if end else "", f"st={start_time}" if start_time else "", f"et={end_time}" if end_time else "", f"d={debug}"]
    cache_key = "hr_intraday:" + "|".join([b for b in key_bits if b])
    cached = _memo_get(app_user.id, cache_key)
    if cached is not None:
        response.headers["Cache-Control"] = "no-store"
        return cached

    access_token = _resolve_withings_access_token(db, app_user)
    headers = _auth(access_token)

    # (Keep your existing windowing/collection logic exactly as-is, just replace 'headers' and remove access_token param.)
    # --- BEGIN unchanged logic from your function (uses headers = _auth(access_token)) ---
    from datetime import datetime as _dt, timedelta as _td
    USER_TZ = ZoneInfo("Europe/Rome")
    UTC = ZoneInfo("UTC")

    def _to_epoch(dt: _dt) -> int: return int(dt.timestamp())

    def _parse_hhmm(hhmm: Optional[str]) -> Tuple[Optional[int], Optional[int]]:
        if not hhmm: return None, None
        h, m = hhmm.split(":"); return int(h), int(m)

    def _ymd_hhmm_local(ymd: str, hhmm: Optional[str], default_end_now=False) -> _dt:
        base = _dt.fromisoformat(ymd).replace(tzinfo=USER_TZ)
        if hhmm:
            h, m = _parse_hhmm(hhmm); return base.replace(hour=h or 0, minute=m or 0, second=0, microsecond=0)
        return _dt.now(USER_TZ) if default_end_now else base.replace(hour=0, minute=0, second=0, microsecond=0)

    def _collect(start_unix: int, end_unix: int):
        payload = {"action": "getintradayactivity", "startdate": start_unix, "enddate": end_unix, "data_fields": "heart_rate"}
        j = _post(MEASURE_V2_URL, headers, payload)
        if not j: return [], None
        body = (j.get("body") or {}); series = body.get("series"); pts: List[Dict] = []
        if isinstance(series, list):
            for chunk in series or []:
                data_list = chunk.get("data") if isinstance(chunk, dict) else None
                if isinstance(data_list, list):
                    for pt in data_list:
                        bpm = pt.get("hr", pt.get("heart_rate")); ts = pt.get("timestamp") or pt.get("time")
                        if isinstance(bpm, (int, float)) and isinstance(ts, (int, float)): pts.append({"ts": int(ts), "bpm": float(bpm)})
        if isinstance(series, dict) and isinstance(series.get("data"), list):
            for pt in series["data"]:
                bpm = pt.get("hr", pt.get("heart_rate")); ts = pt.get("timestamp") or pt.get("time")
                if isinstance(bpm, (int, float)) and isinstance(ts, (int, float)): pts.append({"ts": int(ts), "bpm": float(bpm)})
        if isinstance(series, dict):
            for key in ("hr", "heart_rate"):
                mm = series.get(key)
                if isinstance(mm, dict):
                    for ts_str, val in mm.items():
                        try: ts_i = int(ts_str); pts.append({"ts": ts_i, "bpm": float(val)})
                        except Exception: continue
        seen = set(); pts = [p for p in pts if not (p["ts"] in seen or seen.add(p["ts"]))]; pts.sort(key=lambda x: x["ts"])
        return pts, (body if debug else None)

    items: List[Dict] = []; raw_hint = None; window_utc: Tuple[int, int] = (None, None)  # type: ignore

    if minutes:
        end_local = _dt.now(USER_TZ); start_local = end_local - _td(minutes=minutes)
        s = _to_epoch(start_local.astimezone(UTC)); e = _to_epoch(min(end_local, _dt.now(USER_TZ)).astimezone(UTC))
        pts, raw = _collect(s, e); items.extend(pts); raw_hint = raw; window_utc = (s, e)
    else:
        if not start: start = _dt.now(USER_TZ).date().isoformat()
        if not end: end = start
        start_date = _dt.fromisoformat(start).date(); end_date = _dt.fromisoformat(end).date()
        if end_date < start_date: start_date, end_date = end_date, start_date
        cur = start_date; overall_s = None; overall_e = None
        while cur <= end_date:
            s_local = _ymd_hhmm_local(cur.isoformat(), start_time if cur == start_date else None)
            same_single_day = (start_date == end_date)
            if cur == end_date:
                e_local = _ymd_hhmm_local(cur.isoformat(), end_time, default_end_now=same_single_day)
            else:
                e_local = s_local.replace(hour=23, minute=59, second=59, microsecond=0)
            s = _to_epoch(s_local.astimezone(UTC)); e = _to_epoch(min(e_local, _dt.now(USER_TZ)).astimezone(UTC))
            if e > s:
                pts, raw = _collect(s, e); items.extend(pts); raw_hint = raw_hint or raw
                overall_s = s if overall_s is None else min(overall_s, s)
                overall_e = e if overall_e is None else max(overall_e, e)
            cur += _td(days=1)

        if overall_s is not None and overall_e is not None: window_utc = (overall_s, overall_e)

    resp: Dict = {"items": items}
    if items: resp["latest"] = max(items, key=lambda x: x["ts"])
    if window_utc[0] is not None: resp["window"] = {"start_utc": window_utc[0], "end_utc": window_utc[1]}
    if debug and raw_hint is not None:
        resp["raw_hint"] = {"has_series": isinstance((raw_hint or {}).get("series"), (list, dict)),
                            "series_type": type((raw_hint or {}).get("series")).__name__,
                            "keys": list((raw_hint or {}).keys())[:8]}
    # --- END unchanged logic ---
    response.headers["Cache-Control"] = "no-store"
    return _memo_put(app_user.id, cache_key, resp)


@router.get("/spo2")
def spo2(
    response: Response,
    start: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    app_user: User = Depends(get_current_user),
):
    if not app_user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    cache_key = f"spo2:{start or ''}:{end or ''}"
    cached = _memo_get(app_user.id, cache_key)
    if cached is not None:
        response.headers["Cache-Control"] = "no-store"
        return cached

    access_token = _resolve_withings_access_token(db, app_user)
    headers = _auth(access_token)

    payload = {"action": "getmeas", "meastype": "54", "category": 1}
    if start and end:
        payload.update({"startdateymd": start, "enddateymd": end})
    j = _post(MEASURE_URL, headers, payload)

    items = []
    for g in (j.get("body") or {}).get("measuregrps", []):
        for m in g.get("measures", []):
            if m.get("type") == 54:
                v = m.get("value"); u = m.get("unit", 0)
                p = v * (10 ** u) if isinstance(v,(int,float)) and isinstance(u,(int,float)) else None
                if p is not None:
                    items.append({"ts": g.get("date"), "percent": p})

    resp = {"items": items}
    if not (start and end) and items:
        resp = {"latest": max(items, key=lambda x: x["ts"])}

    response.headers["Cache-Control"] = "no-store"
    return _memo_put(app_user.id, cache_key, resp)



@router.get("/temperature")
def temperature(
    response: Response,
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str   = Query(..., description="YYYY-MM-DD"),
    tz: str    = Query("UTC", description="IANA tz like Europe/Rome"),
    db: Session = Depends(get_db),
    app_user: User = Depends(get_current_user),
):
    if not app_user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    cache_key = f"temp:{start}:{end}:{tz}"
    cached = _memo_get(app_user.id, cache_key)
    if cached is not None:
        response.headers["Cache-Control"] = "no-store"
        return cached

    access_token = _resolve_withings_access_token(db, app_user)
    headers = _auth(access_token)

    j = _post(MEASURE_URL, headers, {
        "action": "getmeas",
        "meastype": "71",
        "startdateymd": start,
        "enddateymd": end,
    })

    from zoneinfo import ZoneInfo as _ZI
    import datetime as dt
    items = []
    for g in (j or {}).get("body", {}).get("measuregrps", []):
        if g.get("attrib") != 2:  # manual only
            continue
        ts = g.get("date")
        for m in g.get("measures", []):
            if m.get("type") == 71:
                v, u = m.get("value"), m.get("unit", 0)
                val = v * (10 ** u)
                items.append({
                    "ts": ts,
                    "date_local": dt.datetime.fromtimestamp(ts, _ZI(tz)).isoformat(),
                    "body_c": val,
                })
    items.sort(key=lambda x: x["ts"], reverse=True)

    resp = {"start": start, "end": end, "tz": tz, "items": items, "latest": (items[0] if items else None)}
    response.headers["Cache-Control"] = "no-store"
    return _memo_put(app_user.id, cache_key, resp)


@router.get("/sleep")
def sleep_summary(
    response: Response,
    date: str = Query(default=None, description="YYYY-MM-DD (defaults to today)"),
    db: Session = Depends(get_db),
    app_user: User = Depends(get_current_user),
):
    if not app_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not date:
        date = _date.today().isoformat()

    cache_key = f"sleep:{date}"
    cached = _memo_get(app_user.id, cache_key)
    if cached is not None:
        response.headers["Cache-Control"] = "no-store"
        return cached

    access_token = _resolve_withings_access_token(db, app_user)
    headers = _auth(access_token)

    j = _post(SLEEP_V2_URL, headers, {
        "action": "getsummary",
        "startdateymd": date,
        "enddateymd": date,
        "data_fields": "totalsleepduration,asleepduration"
    })
    series = (j.get("body") or {}).get("series") or []
    total_sec = 0
    for item in series:
        data = item.get("data") or {}
        if isinstance(data.get("totalsleepduration"), (int, float)):
            total_sec += data["totalsleepduration"]
        elif isinstance(data.get("asleepduration"), (int, float)):
            total_sec += data["asleepduration"]
    hours = round(total_sec / 3600.0, 2) if total_sec else None

    resp = {"date": date, "sleepHours": hours}
    response.headers["Cache-Control"] = "no-store"
    return _memo_put(app_user.id, cache_key, resp)



@router.get("/ecg")
def ecg_list(
    response: Response,
    start: Optional[str] = Query(None, description="YYYY-MM-DD (default: 7 days ago)"),
    end: Optional[str]   = Query(None, description="YYYY-MM-DD (default: today)"),
    tz: str              = Query("Europe/Rome", description="IANA timezone for window"),
    limit: int           = Query(25, ge=1, le=200, description="Max ECG items"),
    db: Session = Depends(get_db),
    app_user: User = Depends(get_current_user),
):
    if not app_user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    cache_key = f"ecg:{start or ''}:{end or ''}:{tz}:{limit}"
    cached = _memo_get(app_user.id, cache_key)
    if cached is not None:
        response.headers["Cache-Control"] = "no-store"
        return cached

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

    access_token = _resolve_withings_access_token(db, app_user)
    headers = _auth(access_token)
    j = _post(HEART_V2_URL, headers, {"action": "list", "startdate": start_epoch, "enddate": end_epoch})
    series = ((j or {}).get("body") or {}).get("series") or []

    items: List[Dict] = []
    for s in series:
        signalid = s.get("signalid") or s.get("id")
        ts = s.get("timestamp") or s.get("startdate") or s.get("time")
        if not isinstance(ts, (int, float)):
            continue
        hr = s.get("heart_rate") or s.get("hr")
        afib = s.get("afib") or s.get("is_afib")
        cls = s.get("classification") or s.get("algo_result")
        items.append({
            "signalid": signalid,
            "ts": int(ts),
            "time_iso": datetime.utcfromtimestamp(int(ts)).isoformat() + "Z",
            "heart_rate": hr,
            "afib": afib,
            "classification": cls,
            "deviceid": s.get("deviceid"),
            "model": s.get("model"),
        })

    items.sort(key=lambda x: x["ts"], reverse=True)
    if len(items) > limit:
        items = items[:limit]

    resp = {
        "start": start or start_day.isoformat(),
        "end": end or end_day.isoformat(),
        "tz": tz,
        "count": len(items),
        "latest": (items[0] if items else None),
        "items": items,
    }
    response.headers["Cache-Control"] = "no-store"
    return _memo_put(app_user.id, cache_key, resp)


@router.get("/hrv")
def hrv_nightly(
    response: Response,
    start: Optional[str] = Query(None, description="YYYY-MM-DD (default: today)"),
    end: Optional[str]   = Query(None, description="YYYY-MM-DD (default: start)"),
    tz: str              = Query("Europe/Rome", description="IANA timezone for local days"),
    fallback_yesterday: int = Query(1, ge=0, le=1),
    db: Session = Depends(get_db),
    app_user: User = Depends(get_current_user),
):
    if not app_user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    cache_key = f"hrv:{start or ''}:{end or ''}:{tz}:{fallback_yesterday}"
    cached = _memo_get(app_user.id, cache_key)
    if cached is not None:
        response.headers["Cache-Control"] = "no-store"
        return cached

    try:
        z = ZoneInfo(tz)
    except Exception:
        z = ZoneInfo("Europe/Rome")

    from datetime import datetime as _dt, timedelta as _td
    today_local = _dt.now(z).date()
    if not start:
        start = today_local.isoformat()
    if not end:
        end = start

    query_windows = [(start, end)]
    if fallback_yesterday and start == end:
        y = (_dt.fromisoformat(start).date() - _td(days=1)).isoformat()
        query_windows.append((y, y))

    access_token = _resolve_withings_access_token(db, app_user)
    headers = _auth(access_token)

    def fetch(d0: str, d1: str):
        payload = {
            "action": "getsummary",
            "startdateymd": d0,
            "enddateymd": d1,
            "data_fields": "rmssd,sdnn,hr_average,asleepduration,totalsleepduration"
        }
        j = _post(SLEEP_V2_URL, headers, payload)
        items = []
        if not j:
            return items
        for row in ((j.get("body") or {}).get("series") or []):
            d = row.get("date") or row.get("startdateymd")
            data = row.get("data") or {}
            rmssd = data.get("rmssd"); sdnn = data.get("sdnn"); hravg = data.get("hr_average")
            if isinstance(rmssd, (int, float)) or isinstance(sdnn, (int, float)):
                items.append({
                    "date": d,
                    "rmssd_ms": float(rmssd) if isinstance(rmssd, (int, float)) else None,
                    "sdnn_ms": float(sdnn) if isinstance(sdnn, (int, float)) else None,
                    "hr_average": float(hravg) if isinstance(hravg, (int, float)) else None,
                })
        items.sort(key=lambda x: (x.get("date") or ""))
        return items

    all_items = []
    for (d0, d1) in query_windows:
        got = fetch(d0, d1)
        all_items.extend(got)
        if start == end and got:
            break

    dedup = {};  # keep last by date
    for it in all_items:
        dedup[it["date"]] = it
    items = list(dedup.values()); items.sort(key=lambda x: (x.get("date") or ""))

    resp = {"start": start, "end": end, "tz": tz, "items": items, "latest": (items[-1] if items else None)}
    response.headers["Cache-Control"] = "no-store"
    return _memo_put(app_user.id, cache_key, resp)
