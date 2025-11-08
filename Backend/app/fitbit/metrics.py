from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, HTTPException, Query, Depends
import requests
from sqlalchemy.orm import Session
from app.db.models.fitbit_account import FitbitAccount
from app.db.models.user import User
from app.db.crud import steps as steps_crud
from app.db.crud import weights as weights_crud
from app.dependencies import get_db



router = APIRouter(prefix="/fitbit/metrics", tags=["Fitbit Metrics"])
FITBIT_API = "https://api.fitbit.com"

def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}

def _handle_fitbit_response(response: requests.Response):
    """Helper function to handle common Fitbit API response codes."""
    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="Access token expired or invalid")
    if response.status_code == 429:
        raise HTTPException(
            status_code=429, 
            detail="Fitbit API rate limit exceeded. Please wait a minute before trying again."
        )
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response

def _user_local_today(access_token: str) -> str:
    try:
        r = requests.get(f"{FITBIT_API}/1/user/-/profile.json", headers=_auth_headers(access_token), timeout=15)
        tz = r.json().get("user", {}).get("timezone") or "UTC"
    except Exception:
        tz = "UTC"
    return datetime.now(ZoneInfo(tz)).date().isoformat()


def _resolve_user_and_tz(db: Session, access_token: str) -> tuple[User, str]:
    """
    Resolve app user + tz from FitbitAccount table using the raw access_token.
    """
    acc = (
        db.query(FitbitAccount)
        .filter(FitbitAccount.access_token == access_token)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=404, detail="Fitbit account not found for this access token")

    user = db.query(User).filter(User.id == acc.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="App user not found")

    return user, (acc.timezone or "UTC")




@router.get("/summary")
def daily_summary(access_token: str, date: str = Query(default=None, description="YYYY-MM-DD"), db: Session = Depends(get_db)):
    d = date or _user_local_today(access_token)
    
    # Get user and timezone info
    user, _ = _resolve_user_and_tz(db, access_token)
    
    # Fetch data from Fitbit API
    url = f"{FITBIT_API}/1/user/-/activities/date/{d}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    r = _handle_fitbit_response(r)
    data = r.json()
    summary = data.get("summary", {}) if isinstance(data, dict) else {}
    
    # Save steps data to our database
    active_minutes = (
        (summary.get("fairlyActiveMinutes") or 0) +
        (summary.get("veryActiveMinutes") or 0) +
        (summary.get("lightlyActiveMinutes") or 0)
    )
    
    steps_crud.update_or_create_steps(
        db,
        user_id=user.id,
        provider="fitbit",
        date_local=datetime.strptime(d, "%Y-%m-%d").date(),
        steps=summary.get("steps"),
        active_min=active_minutes,
        calories=summary.get("caloriesOut")
    )
    
    return {
        "date": d,
        "steps": summary.get("steps"),
        # "caloriesOut": summary.get("caloriesOut"),
        "calories": {
            "total": summary.get("caloriesOut"),        # what the app’s “Energy burned” shows
            "active": summary.get("activityCalories"),  # the smaller number you’re seeing
            "bmr_estimate": summary.get("caloriesBMR"), # Fitbit’s BMR estimate for the day
            "goal_total": (data.get("goals") or {}).get("caloriesOut"),
        },
        "distances": summary.get("distances", []),
        "activeMinutes": {
            "fairly": summary.get("fairlyActiveMinutes"),
            "very": summary.get("veryActiveMinutes"),
            "lightly": summary.get("lightlyActiveMinutes"),
        },
        "raw": data,  # keep for dev
    }


@router.get("/steps")
def fitbit_steps(
    access_token: str,
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(get_db)
):
    """
    Return Fitbit steps data for a date range.
    First tries to get data from our database, then fetches missing data from Fitbit API.
    """
    # Resolve user from access token
    user, _ = _resolve_user_and_tz(db, access_token)
    
    # Convert dates to datetime.date objects
    start = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()
    
    # Query existing data from our database
    db_data = steps_crud.get_steps_by_date_range(
        db,
        user_id=user.id,
        provider="fitbit",
        start_date=start,
        end_date=end
    )
    
    # Create a map of existing data by date
    data_by_date = {item.date_local.isoformat(): item for item in db_data}
    
    # For any missing dates, fetch from Fitbit API
    current = start
    while current <= end:
        date_str = current.isoformat()
        
        if date_str not in data_by_date:
            # Fetch from Fitbit API
            try:
                url = f"{FITBIT_API}/1/user/-/activities/date/{date_str}.json"
                r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
                r = _handle_fitbit_response(r)
                data = r.json()
                summary = data.get("summary", {}) if isinstance(data, dict) else {}
                
                # Calculate active minutes
                active_minutes = (
                    (summary.get("fairlyActiveMinutes") or 0) +
                    (summary.get("veryActiveMinutes") or 0) +
                    (summary.get("lightlyActiveMinutes") or 0)
                )
                
                # Save to database
                db_item = steps_crud.update_or_create_steps(
                    db,
                    user_id=user.id,
                    provider="fitbit",
                    date_local=current,
                    steps=summary.get("steps"),
                    active_min=active_minutes,
                    calories=summary.get("caloriesOut")
                )
                
                # Add to our response data
                data_by_date[date_str] = db_item
                
            except Exception as e:
                print(f"Failed to fetch steps for {date_str}: {e}")
                
        current += timedelta(days=1)
    
    # Format the response
    items = [
        {
            "date": item.date_local.isoformat(),
            "steps": item.steps,
            "active_minutes": item.active_min,
            "calories": item.calories
        }
        for item in sorted(data_by_date.values(), key=lambda x: x.date_local)
    ]
    
    return {
        "start": start_date,
        "end": end_date,
        "items": items
    }


@router.get("/resting-hr")
def fitbit_resting_hr(access_token: str, date: str = Query(default=None, description="YYYY-MM-DD")):
    """
    Resting heart rate for a given date (default today).
    """
    d = date or _user_local_today(access_token)
    url = f"{FITBIT_API}/1/user/-/activities/heart/date/{d}/1d.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    r = _handle_fitbit_response(r)
    j = r.json()
    arr = j.get("activities-heart", []) if isinstance(j, dict) else []
    v = (arr[0].get("value") if arr else {}) or {}
    return {"date": d, "restingHeartRate": v.get("restingHeartRate"), "raw": j}


@router.get("/sleep")
def fitbit_sleep_summary(access_token: str, date: str = Query(default=None, description="YYYY-MM-DD")):
    d = date or _user_local_today(access_token)
    url = f"{FITBIT_API}/1.2/user/-/sleep/date/{d}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    r = _handle_fitbit_response(r)
    j = r.json() if r.headers.get("content-type","").startswith("application/json") else {}
    s = j.get("summary", {}) if isinstance(j, dict) else {}
    mins_all = s.get("totalMinutesAsleep")

    # NEW: compute main-sleep-only minutes
    logs = j.get("sleep", []) if isinstance(j, dict) else []
    mins_main = sum((log.get("minutesAsleep") or 0) for log in logs if log.get("isMainSleep"))

    hours_all = round(mins_all / 60, 2) if isinstance(mins_all, (int, float)) else None
    hours_main = round(mins_main / 60, 2) if mins_main else None

    return {
        "date": d,
        "totalMinutesAsleep": mins_all,
        "hoursAsleep": hours_all,
        "hoursAsleepMain": hours_main,   # NEW
        "stages": s.get("stages", {}),
        "raw": j,
    }


@router.get("/steps")
def get_steps(
    access_token: str,
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(get_db)
):
    """
    Get steps data for a date range from the database.
    This endpoint returns the stored steps data instead of fetching from Fitbit API.
    """
    user, _ = _resolve_user_and_tz(db, access_token)
    
    start = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()
    
    steps_data = steps_crud.get_steps_by_date_range(
        db,
        user_id=user.id,
        provider="fitbit",
        start_date=start,
        end_date=end
    )
    
    return {
        "start": start_date,
        "end": end_date,
        "items": [
            {
                "date": item.date_local.isoformat(),
                "steps": item.steps,
                "active_minutes": item.active_min,
                "calories": item.calories
            }
            for item in steps_data
        ]
    }

@router.get("/overview")
def fitbit_overview(access_token: str, date: str = Query(default=None, description="YYYY-MM-DD")):
    """
    Aggregated snapshot: steps, (active) calories, resting HR, main-sleep hours, weight, distance.
    """
    d = date or _user_local_today(access_token)

    def _get(url):
        try:
            rr = requests.get(url, headers=_auth_headers(access_token), timeout=30)
            rr = _handle_fitbit_response(rr)
            return rr.json()
        except HTTPException as e:
            if e.status_code == 429:  # Only re-raise rate limit errors
                raise
            return None

    daily  = _get(f"{FITBIT_API}/1/user/-/activities/date/{d}.json") or {}
    heart  = _get(f"{FITBIT_API}/1/user/-/activities/heart/date/{d}/1d.json") or {}
    sleep  = _get(f"{FITBIT_API}/1.2/user/-/sleep/date/{d}.json") or {}
    weight = _get(f"{FITBIT_API}/1/user/-/body/log/weight/date/{d}/7d.json") or {}

    summary = (daily.get("summary") or {})
    steps = summary.get("steps")
    activity_cals = summary.get("activityCalories")     # preferred (matches app)
    calories_out  = summary.get("caloriesOut")          # includes BMR

    # Safely get resting heart rate with proper null checks
    activities_heart = heart.get("activities-heart", [])
    rhr = None
    if activities_heart and len(activities_heart) > 0:
        heart_data = activities_heart[0]
        if isinstance(heart_data, dict):
            value = heart_data.get("value")
            if isinstance(value, dict):
                rhr = value.get("restingHeartRate")

    # MAIN sleep
    logs = sleep.get("sleep", []) if isinstance(sleep, dict) else []
    mins_main = sum((log.get("minutesAsleep") or 0) for log in logs if log.get("isMainSleep"))
    sleep_hours = round(mins_main/60, 2) if mins_main else None

    # Get the latest weight from the logs
    weight_logs = weight.get("weight", []) if isinstance(weight, dict) else []
    weight_value = None
    if weight_logs:
        # Sort by date in descending order and get the most recent
        latest_weight = sorted(weight_logs, key=lambda x: x.get("date", ""), reverse=True)[0]
        weight_value = latest_weight.get("weight") if isinstance(latest_weight, dict) else None

    distances = summary.get("distances", [])
    total_km = None
    for dct in distances:
        if dct.get("activity") == "total":
            val = dct.get("distance")
            total_km = round(val, 2) if isinstance(val, (int, float)) else None
            break

    return {
        "date": d,
        "steps": steps,
        "caloriesOut": calories_out,         
        "activityCalories": activity_cals,   
        "restingHeartRate": rhr,
        "sleepHours": sleep_hours,           
        "weight": weight_value,
        "total_km": total_km,
    }


@router.get("/weight")
def fitbit_weight_logs(
    access_token: str,
    date: str = Query(default=None, description="YYYY-MM-DD (default: today)"),
    period: str = Query(default="1m", description="One of: 1d,7d,30d,1w,1m,3m,6m,1y,max"),
    end: str | None = Query(default=None, description="YYYY-MM-DD (use this to request a date range instead of a period)"),
    db: Session = Depends(get_db)
):
    """
    Return Fitbit weight logs and store them in our database.
    - If `end` is provided, uses the date-range endpoint.
    - Otherwise uses the date+period endpoint.
    """
    # Resolve user from access token
    user, tz = _resolve_user_and_tz(db, access_token)
    d = date or _user_local_today(access_token)

    allowed = {"1d","7d","30d","1w","1m","3m","6m","1y","max"}
    if end:
        url = f"{FITBIT_API}/1/user/-/body/log/weight/date/{d}/{end}.json"
    else:
        if period not in allowed:
            raise HTTPException(status_code=400, detail=f"Invalid period '{period}'. Allowed: {sorted(allowed)}")
        url = f"{FITBIT_API}/1/user/-/body/log/weight/date/{d}/{period}.json"

    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    r = _handle_fitbit_response(r)
    j = r.json()
    items = j.get("weight", []) if isinstance(j, dict) else []

    # Store weight readings in our database
    processed_items = []
    for item in items:
        # Convert Fitbit's timestamp to UTC
        log_id = str(item.get("logId"))
        date_str = item.get("date")
        time_str = item.get("time", "00:00:00")
        try:
            # Parse the local time
            local_dt = datetime.fromisoformat(f"{date_str}T{time_str}")
            # Get timezone offset from the item or use user's timezone
            tz_offset_min = item.get("timeZoneOffset", 0) * 60  # Fitbit uses hours, we use minutes
            
            # Convert to UTC
            utc_dt = local_dt - timedelta(minutes=tz_offset_min)
            utc_dt = utc_dt.replace(tzinfo=timezone.utc)

            # Store in database
            reading = weights_crud.update_or_create_weight(
                db,
                user_id=user.id,
                provider="fitbit",
                measured_at_utc=utc_dt,
                weight_kg=item.get("weight"),
                fat_pct=item.get("fat"),
                provider_measure_id=log_id,
                device=item.get("source"),
                tz_offset_min=tz_offset_min
            )
            
            processed_items.append({
                "date": date_str,
                "time": time_str,
                "weight": reading.weight_kg,
                "fat": reading.fat_pct,
                "source": reading.device,
                "logId": reading.provider_measure_id
            })
        except Exception as e:
            print(f"Failed to process weight reading: {e}")
            continue

    return {
        "date": d,
        "period": None if end else period,
        "end": end,
        "count": len(processed_items),
        "items": processed_items
    }


@router.get("/spo2-nightly")
def fitbit_spo2_nightly(
    access_token: str,
    date: str = Query(default=None, description="YYYY-MM-DD")
):
    def _fetch(day: str):
        url = f"{FITBIT_API}/1/user/-/spo2/date/{day}.json"
        r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
        if r.status_code == 401:
            raise HTTPException(status_code=401, detail="Access token expired or invalid")
        if r.status_code != 200:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        j = r.json() if r.headers.get("content-type","").startswith("application/json") else {}
        
        # Check if we have valid data
        if isinstance(j, dict) and "value" in j and isinstance(j["value"], dict):
            v = j["value"]
            avg = v.get("avg")
            mn = v.get("min")
            mx = v.get("max")
        else:
            # Try legacy format
            arr = (j.get("spo2") or []) if isinstance(j, dict) else []
            it = arr[0] if arr else {}
            v = it.get("value")
            if isinstance(v, dict):
                avg = v.get("avg")
                mn = v.get("min")
                mx = v.get("max")
            else:
                avg = mn = mx = None

        return {"date": day, "average": avg, "min": mn, "max": mx, "raw": j}

    # try the requested date or user-local today
    d = date or _user_local_today(access_token)
    out = _fetch(d)

    # If no data and no explicit date provided, auto-fallback to yesterday (user-local)
    if out["average"] is None and date is None:
        # derive user-local yesterday from profile tz (same logic as _user_local_today)
        try:
            tz = requests.get(f"{FITBIT_API}/1/user/-/profile.json",
                               headers=_auth_headers(access_token), timeout=15
                              ).json().get("user", {}).get("timezone") or "UTC"
        except Exception:
            tz = "UTC"
        y = (datetime.now(ZoneInfo(tz)).date() - timedelta(days=1)).isoformat()
        out = _fetch(y)

    return out


@router.get("/hrv")
def fitbit_hrv(access_token: str,
               start: str = Query(..., description="YYYY-MM-DD"),
               end: str = Query(..., description="YYYY-MM-DD")):
    url = f"{FITBIT_API}/1/user/-/hrv/date/{start}/{end}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Access token expired or invalid")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    j = r.json()
    items = (j.get("hrv") or []) if isinstance(j, dict) else []
    out = [{"date": i.get("dateTime"),
            "rmssd_ms": (i.get("value") or {}).get("dailyRmssd")} for i in items]
    return {"start": start, "end": end, "items": out, "raw": j}


@router.get("/respiratory-rate")
def fitbit_breathing_rate(access_token: str,
                          start: str = Query(..., description="YYYY-MM-DD"),
                          end: str = Query(..., description="YYYY-MM-DD")):
    url = f"{FITBIT_API}/1/user/-/br/date/{start}/{end}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Access token expired or invalid")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    j = r.json()
    items = (j.get("br") or []) if isinstance(j, dict) else []
    out = [{"date": i.get("dateTime"),
            "full_day_avg": (i.get("value") or {}).get("breathingRate"),  # Changed field name
            "deep_sleep_avg": None,
            "light_sleep_avg": None,
            "rem_sleep_avg": None} for i in items]
    return {"start": start, "end": end, "items": out, "raw": j}


@router.get("/temperature")
def fitbit_temperature(
    access_token: str,
    start: str = Query(None, description="YYYY-MM-DD"),
    end: str = Query(None, description="YYYY-MM-DD"),
    period: str = Query("1m", description="Ignored if start/end given. e.g. 1w,1m,3m,1y,max")
):
    """
    Skin temperature *delta* (nightlyRelative, °C). Returns the latest non-null value.
    If start/end are omitted, looks back `period` from today (default 1m).
    """
    # choose endpoint shape
    if start and end:
        url = f"{FITBIT_API}/1/user/-/temp/skin/date/{start}/{end}.json"
    else:
        base = _user_local_today(access_token)
        url = f"{FITBIT_API}/1/user/-/temp/skin/date/{base}/{period}.json"

    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Access token expired or invalid")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)

    j = r.json()
    items = (j.get("tempSkin") or []) if isinstance(j, dict) else []

    # normalize and pick the most recent non-null nightlyRelative
    normalized = []
    for i in items:
        v = (i.get("value") or {}).get("nightlyRelative")
        normalized.append({
            "date": i.get("dateTime"),
            "delta_c": v  # may be None
        })
    latest = next((x for x in reversed(normalized) if x["delta_c"] is not None), None)

    return {
        "query_type": "range" if (start and end) else "period",
        "start": start,
        "end": end,
        "period": period if not (start and end) else None,
        "latest": latest,              # {"date": "...", "delta_c": float} or None
        "count": len(normalized),
        "items": normalized,           # keep the series for charts
        "raw": j
    }


@router.get("/workouts")
def fitbit_workouts(access_token: str,
                    after_date: str = Query(..., description="YYYY-MM-DD"),
                    limit: int = Query(20, ge=1, le=100),
                    sort: str = Query("desc", regex="^(asc|desc)$"),
                    offset: int = Query(0, ge=0)):
    url = (f"{FITBIT_API}/1/user/-/activities/list.json"
           f"?afterDate={after_date}&sort={sort}&offset={offset}&limit={limit}")
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Access token expired or invalid")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    j = r.json()
    items = j.get("activities", []) if isinstance(j, dict) else []
    # Normalize a few common fields
    out = [{
        "logId": a.get("logId"),
        "startTime": a.get("startTime"),
        "duration_ms": a.get("duration"),
        "type": a.get("activityName") or a.get("activityTypeId"),
        "calories": a.get("calories"),
        "averageHeartRate": a.get("averageHeartRate"),
        "distance_km": a.get("distance")
    } for a in items]
    return {"afterDate": after_date, "count": len(out), "items": out, "raw": j}


@router.get("/heart-rate/intraday")
def fitbit_intraday_heart_rate(
    access_token: str,
    minutes: int | None = Query(None, ge=1, le=1440, description="Rolling lookback ending now (user local)"),
    start: str | None = Query(None, description="YYYY-MM-DD (user local)"),
    end: str | None = Query(None, description="YYYY-MM-DD (user local; defaults to start)"),
    start_time: str | None = Query(None, description="HH:MM (used with 'start')"),
    end_time: str | None = Query(None, description="HH:MM (used with 'end')"),
    detail: str = Query("1sec", regex="^(1sec|1min)$", description="Intraday granularity")
):
    """
    Fitbit Intraday Heart Rate.
    - If 'minutes' is provided: fetch the last N minutes ending now (may span midnight).
    - Else: fetch explicit slice(s) defined by date/time.
    Returns: { items: [{ts,bpm}], latest?: {ts,bpm}, window: {start_local,end_local,tz} }
    """
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    import requests

    # --- get user's timezone from profile (kept local to this route) ---
    try:
        prof = requests.get(f"{FITBIT_API}/1/user/-/profile.json",
                            headers=_auth_headers(access_token), timeout=15)
        tzname = (prof.json() or {}).get("user", {}).get("timezone") or "UTC"
    except Exception:
        tzname = "UTC"
    USER_TZ = ZoneInfo(tzname)

    def _slice_url(date_str: str, hhmm_start: str | None, hhmm_end: str | None) -> str:
        if hhmm_start and hhmm_end:
            return (f"{FITBIT_API}/1/user/-/activities/heart/date/"
                    f"{date_str}/{date_str}/{detail}/time/{hhmm_start}/{hhmm_end}.json")
        return (f"{FITBIT_API}/1/user/-/activities/heart/date/"
                f"{date_str}/{date_str}/{detail}.json")

    def _fetch(date_str: str, hhmm_start: str | None, hhmm_end: str | None) -> dict:
        url = _slice_url(date_str, hhmm_start, hhmm_end)
        r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
        if r.status_code == 401:
            raise HTTPException(status_code=401, detail="Access token expired or invalid")
        if r.status_code == 403:
            # Usually: intraday not approved for client/server apps
            raise HTTPException(status_code=403, detail="Forbidden: intraday access not granted for this app/scopes")
        if r.status_code == 429:
            raise HTTPException(status_code=429, detail="Rate limit exceeded; back off and retry")
        if r.status_code != 200:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        return r.json() or {}

    def _parse(j: dict, date_str: str) -> list[dict]:
        data = (j.get("activities-heart-intraday") or {}).get("dataset") or []
        out: list[dict] = []
        if not isinstance(data, list):
            return out
        for row in data:
            t = row.get("time")
            v = row.get("value")
            if not isinstance(t, str) or not isinstance(v, (int, float)):
                continue
            # Fitbit gives 'HH:MM' or 'HH:MM:SS' in user's local TZ
            if len(t) == 5:
                t = t + ":00"
            try:
                dt_local = datetime.fromisoformat(f"{date_str}T{t}").replace(tzinfo=USER_TZ)
                ts = int(dt_local.astimezone(ZoneInfo("UTC")).timestamp())
                out.append({"ts": ts, "bpm": float(v)})
            except Exception:
                continue
        # sort + dedupe
        out.sort(key=lambda x: x["ts"])
        seen, dedup = set(), []
        for p in out:
            if p["ts"] not in seen:
                dedup.append(p)
                seen.add(p["ts"])
        return dedup

    # ----- build local window -----
    if minutes:
        end_local = datetime.now(USER_TZ)
        start_local = end_local - timedelta(minutes=minutes)
    else:
        # default: today full day if not provided
        if not start:
            today = datetime.now(USER_TZ)
            start_local = today.replace(hour=0, minute=0, second=0, microsecond=0)
            end_local = today
        else:
            sdate = datetime.fromisoformat(start).date()
            edate = datetime.fromisoformat(end or start).date()
            if edate < sdate:
                sdate, edate = edate, sdate
            start_local = datetime.combine(sdate, datetime.min.time()).replace(tzinfo=USER_TZ)
            end_local = datetime.combine(edate, datetime.max.time()).replace(tzinfo=USER_TZ)
            if start_time:
                h, m = map(int, start_time.split(":"))
                start_local = start_local.replace(hour=h, minute=m, second=0, microsecond=0)
            if end_time and sdate == edate:
                h, m = map(int, end_time.split(":"))
                end_local = end_local.replace(hour=h, minute=m, second=0, microsecond=0)
            # clamp to now for live day
            now_local = datetime.now(USER_TZ)
            if end_local > now_local:
                end_local = now_local

    if end_local <= start_local:
        return {"items": []}

    # ----- split by day (Fitbit intraday must be single-day) -----
    items: list[dict] = []
    cur = start_local.date()
    last = end_local.date()

    while cur <= last:
        day_start = datetime.combine(cur, datetime.min.time()).replace(tzinfo=USER_TZ)
        day_end = datetime.combine(cur, datetime.max.time()).replace(tzinfo=USER_TZ)
        s = max(start_local, day_start)
        e = min(end_local, day_end)

        s_hhmm = s.strftime("%H:%M")
        e_hhmm = e.strftime("%H:%M")

        j = _fetch(cur.isoformat(), s_hhmm, e_hhmm)
        items.extend(_parse(j, cur.isoformat()))

        cur += timedelta(days=1)

    items.sort(key=lambda x: x["ts"])
    latest = items[-1] if items else None

    return {
        "items": items,
        "latest": latest,
        "window": {
            "start_local": int(start_local.timestamp()),
            "end_local": int(end_local.timestamp()),
            "tz": tzname
        }
    }



