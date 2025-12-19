from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, HTTPException, Query, Depends
import requests
from sqlalchemy.orm import Session
from app.db.models.fitbit_account import FitbitAccount
from app.db.models.user import User
from app.db.crud import steps as steps_crud
from app.db.crud import weights as weights_crud
from app.db.crud import sleep as sleep_crud
from app.db.crud import calories as calories_crud
from app.db.crud import heart_rate as heart_rate_crud
from app.db.crud import heart_rate_intraday as heart_rate_intraday_crud
from app.db.crud import hrv as hrv_crud
from app.db.crud import breathing_rate as breathing_rate_crud
from app.db.crud.metrics import _upsert_spo2_reading, _upsert_temperature_reading
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


@router.get("/sleep/today")
def fitbit_sleep_today(
    access_token: str,
    date: str = Query(default=None, description="YYYY-MM-DD (default: today)"),
    db: Session = Depends(get_db)
):
    """
    Get Fitbit sleep data for a given date and store sleep sessions in our database.
    """
    import json
    
    # Resolve user from access token
    user, tz = _resolve_user_and_tz(db, access_token)
    d = date or _user_local_today(access_token)
    
    # Fetch sleep data from Fitbit API
    url = f"{FITBIT_API}/1.2/user/-/sleep/date/{d}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    r = _handle_fitbit_response(r)
    j = r.json() if r.headers.get("content-type","").startswith("application/json") else {}
    
    # Parse sleep data
    logs = j.get("sleep", []) if isinstance(j, dict) else []
    saved_count = 0
    
    # Save each sleep session to database
    try:
        for log in logs:
            if not isinstance(log, dict):
                continue
            
            # Extract session data
            session_id = str(log.get("logId"))
            start_time = log.get("startTime")
            end_time = log.get("endTime")
            total_min = log.get("duration") and log.get("duration") // 60  # Convert milliseconds to minutes
            
            # Parse timestamps
            if not start_time or not end_time:
                continue
            
            try:
                start_at_utc = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
                end_at_utc = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                continue
            
            # Serialize stages if available
            stages_json = None
            if "levels" in log and isinstance(log["levels"], dict):
                try:
                    stages_json = json.dumps(log["levels"])
                except (TypeError, ValueError):
                    stages_json = None
            
            # Get timezone offset
            tz_offset_min = None
            try:
                local_tz = ZoneInfo(tz)
                dt_local = datetime.fromisoformat(start_time)
                if dt_local.tzinfo is None:
                    dt_local = dt_local.replace(tzinfo=local_tz)
                tz_offset_min = int(dt_local.utcoffset().total_seconds() / 60)
            except Exception:
                pass
            
            # Save to database
            try:
                sleep_crud.update_or_create_sleep_session(
                    db,
                    user_id=user.id,
                    provider="fitbit",
                    session_id=session_id,
                    start_at_utc=start_at_utc,
                    end_at_utc=end_at_utc,
                    total_min=total_min,
                    stages_json=stages_json,
                    tz_offset_min=tz_offset_min
                )
                saved_count += 1
            except Exception as e:
                print(f"Failed to save sleep session {session_id}: {e}")
    except Exception as e:
        print(f"Failed to save sleep data for {d}: {e}")
        db.rollback()
    
    # Get summary data
    s = j.get("summary", {}) if isinstance(j, dict) else {}
    mins_all = s.get("totalMinutesAsleep")
    mins_main = sum((log.get("minutesAsleep") or 0) for log in logs if isinstance(log, dict) and log.get("isMainSleep"))
    
    hours_all = round(mins_all / 60, 2) if isinstance(mins_all, (int, float)) else None
    hours_main = round(mins_main / 60, 2) if mins_main else None
    
    return {
        "date": d,
        "totalMinutesAsleep": mins_all,
        "hoursAsleep": hours_all,
        "hoursAsleepMain": hours_main,
        "sessions_saved": saved_count,
        "total_sessions": len(logs)
    }


@router.get("/steps/today")
def fitbit_steps_today(
    access_token: str,
    date: str = Query(default=None, description="YYYY-MM-DD (default: today)"),
    db: Session = Depends(get_db)
):
    """
    Return Fitbit steps for a given date and store it in our database.
    Steps data comes from the daily summary endpoint.
    """
    # Resolve user from access token
    user, _ = _resolve_user_and_tz(db, access_token)
    d = date or _user_local_today(access_token)
    
    # Fetch data from Fitbit API
    url = f"{FITBIT_API}/1/user/-/activities/date/{d}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    r = _handle_fitbit_response(r)
    data = r.json()
    summary = data.get("summary", {}) if isinstance(data, dict) else {}
    
    # Extract steps and active minutes
    steps_value = summary.get("steps")
    active_minutes = (
        (summary.get("fairlyActiveMinutes") or 0) +
        (summary.get("veryActiveMinutes") or 0) +
        (summary.get("lightlyActiveMinutes") or 0)
    )
    calories = summary.get("caloriesOut")
    
    # Save to database
    try:
        steps_crud.update_or_create_steps(
            db,
            user_id=user.id,
            provider="fitbit",
            date_local=datetime.strptime(d, "%Y-%m-%d").date(),
            steps=steps_value,
            active_min=active_minutes,
            calories=calories
        )
    except Exception as e:
        print(f"Failed to save steps for {d}: {e}")
    
    return {
        "date": d,
        "steps": steps_value,
        "active_min": active_minutes,
        "calories": calories
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
                "weight_kg": reading.weight_kg,
                "fat_pct": reading.fat_pct,
                "bmi": item.get("bmi"),  # From Fitbit API if available
                "logId": reading.provider_measure_id,
                "source": reading.device
            })
        except Exception as e:
            print(f"Failed to process weight reading: {e}")
            continue

    return {
        "date": d,
        "period": None if end else period,
        "end": end,
        "count": len(processed_items),
        "weight": processed_items
    }


@router.get("/distance")
def fitbit_distance(
    access_token: str,
    date: str = Query(default=None, description="YYYY-MM-DD (default: today)"),
    db: Session = Depends(get_db)
):
    """
    Return Fitbit distance for a given date and store it in our database.
    Distance data comes from the daily summary endpoint.
    """
    from app.db.crud.metrics import _upsert_distance_daily
    
    # Resolve user from access token
    user, _ = _resolve_user_and_tz(db, access_token)
    d = date or _user_local_today(access_token)
    
    # Fetch data from Fitbit API
    url = f"{FITBIT_API}/1/user/-/activities/date/{d}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    r = _handle_fitbit_response(r)
    data = r.json()
    summary = data.get("summary", {}) if isinstance(data, dict) else {}
    
    # Extract total distance
    distances = summary.get("distances", [])
    total_km = None
    for dct in distances:
        if dct.get("activity") == "total":
            val = dct.get("distance")
            total_km = round(val, 2) if isinstance(val, (int, float)) else None
            break
    
    # Save to database
    try:
        date_obj = datetime.strptime(d, "%Y-%m-%d").date()
        _upsert_distance_daily(
            db,
            user_id=user.id,
            provider="fitbit",
            date_local=date_obj,
            distance_km=total_km
        )
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Failed to save distance: {e}")
    
    return {
        "date": d,
        "distance_km": total_km
    }


@router.get("/calories/today")
def fitbit_calories_today(
    access_token: str,
    date: str = Query(default=None, description="YYYY-MM-DD (default: today)"),
    db: Session = Depends(get_db)
):
    """
    Return Fitbit calories for a given date and store it in our database.
    Calories data comes from the daily summary endpoint.
    """
    # Resolve user from access token
    user, _ = _resolve_user_and_tz(db, access_token)
    d = date or _user_local_today(access_token)
    
    # Fetch data from Fitbit API
    url = f"{FITBIT_API}/1/user/-/activities/date/{d}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    r = _handle_fitbit_response(r)
    data = r.json()
    summary = data.get("summary", {}) if isinstance(data, dict) else {}
    
    # Extract calories data
    calories_out = summary.get("caloriesOut")
    activity_calories = summary.get("activityCalories")
    bmr_calories = summary.get("caloriesBMR")
    
    # Save to database
    try:
        date_obj = datetime.strptime(d, "%Y-%m-%d").date()
        calories_crud.update_or_create_calories(
            db,
            user_id=user.id,
            provider="fitbit",
            date_local=date_obj,
            calories_out=calories_out,
            activity_calories=activity_calories,
            bmr_calories=bmr_calories
        )
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Failed to save calories: {e}")
    
    return {
        "date": d,
        "calories_out": calories_out,
        "activity_calories": activity_calories,
        "bmr_calories": bmr_calories
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


@router.get("/spo2-nightly/today")
def fitbit_spo2_nightly_today(
    access_token: str,
    date: str = Query(default=None, description="YYYY-MM-DD (default: today)"),
    db: Session = Depends(get_db)
):
    """
    Get nightly SpO2 reading for a given date and store it in our database.
    """
    # Resolve user from access token
    user, tz = _resolve_user_and_tz(db, access_token)
    d = date or _user_local_today(access_token)
    
    # Fetch SpO2 data from Fitbit API
    url = f"{FITBIT_API}/1/user/-/spo2/date/{d}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    r = _handle_fitbit_response(r)
    j = r.json() if r.headers.get("content-type","").startswith("application/json") else {}
    
    # Parse SpO2 value
    avg_pct = None
    min_pct = None
    
    if isinstance(j, dict) and "value" in j and isinstance(j["value"], dict):
        v = j["value"]
        avg_pct = v.get("avg")
        min_pct = v.get("min")
    else:
        # Try legacy format
        arr = (j.get("spo2") or []) if isinstance(j, dict) else []
        it = arr[0] if arr else {}
        v = it.get("value")
        if isinstance(v, dict):
            avg_pct = v.get("avg")
            min_pct = v.get("min")
    
    # Save to database if we have a reading
    try:
        if avg_pct is not None:
            # Parse the date to get the measured_at_utc timestamp
            # Use the date as measured_at_utc (end of day in user's timezone)
            date_obj = datetime.strptime(d, "%Y-%m-%d")
            # Convert to UTC by assuming the measurement is at midnight in user's timezone
            local_tz = ZoneInfo(tz)
            measured_at_local = date_obj.replace(tzinfo=local_tz)
            measured_at_utc = measured_at_local.astimezone(timezone.utc)
            
            reading_id = f"fitbit_spo2_{d}"
            
            _upsert_spo2_reading(
                db,
                user_id=user.id,
                provider="fitbit",
                measured_at_utc=measured_at_utc,
                avg_pct=avg_pct,
                min_pct=min_pct,
                type_="nightly",
                reading_id=reading_id
            )
            db.commit()
    except Exception as e:
        print(f"Failed to save SpO2 for {d}: {e}")
        db.rollback()
    
    return {
        "date": d,
        "average": avg_pct,
        "min": min_pct,
        "saved": avg_pct is not None
    }


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


@router.get("/respiratory-rate/today")
def fitbit_breathing_rate_today(
    access_token: str,
    date: str = Query(default=None, description="YYYY-MM-DD (default: today)"),
    db: Session = Depends(get_db)
):
    """
    Get Fitbit breathing rate for a given date and save it to the database.
    """
    # Resolve user from access token
    user, tz = _resolve_user_and_tz(db, access_token)
    d = date or _user_local_today(access_token)
    
    # Fetch breathing rate data from Fitbit API for a single day
    url = f"{FITBIT_API}/1/user/-/br/date/{d}/{d}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    r = _handle_fitbit_response(r)
    j = r.json()
    items = (j.get("br") or []) if isinstance(j, dict) else []
    
    # Extract breathing rate data
    full_day_avg = None
    deep_sleep_avg = None
    light_sleep_avg = None
    rem_sleep_avg = None
    
    if items and len(items) > 0:
        first_item = items[0]
        value_obj = first_item.get("value") or {}
        full_day_avg = value_obj.get("breathingRate")
        deep_sleep_avg = value_obj.get("deepSleepAverage")
        light_sleep_avg = value_obj.get("lightSleepAverage")
        rem_sleep_avg = value_obj.get("remSleepAverage")
    
    # Save to database if we have a reading
    try:
        if full_day_avg is not None:
            date_obj = datetime.strptime(d, "%Y-%m-%d").date()
            
            breathing_rate_crud.update_or_create_breathing_rate_daily(
                db,
                user_id=user.id,
                provider="fitbit",
                date_local=date_obj,
                full_day_avg=full_day_avg,
                deep_sleep_avg=deep_sleep_avg,
                light_sleep_avg=light_sleep_avg,
                rem_sleep_avg=rem_sleep_avg
            )
            db.commit()
    except Exception as e:
        db.rollback()
        print(f"Failed to save breathing rate for {d}: {e}")
    
    return {
        "date": d,
        "full_day_avg": full_day_avg,
        "deep_sleep_avg": deep_sleep_avg,
        "light_sleep_avg": light_sleep_avg,
        "rem_sleep_avg": rem_sleep_avg,
        "saved": full_day_avg is not None
    }


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


@router.get("/temperature/today")
def fitbit_temperature_today(
    access_token: str,
    date: str = Query(default=None, description="YYYY-MM-DD (default: today)"),
    db: Session = Depends(get_db)
):
    """
    Get Fitbit skin temperature for a given date and store it in our database.
    Fetches the latest temperature reading for the date and saves it.
    """
    # Resolve user from access token
    user, tz = _resolve_user_and_tz(db, access_token)
    d = date or _user_local_today(access_token)
    
    # Fetch temperature data from Fitbit API for a single day
    url = f"{FITBIT_API}/1/user/-/temp/skin/date/{d}/{d}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    r = _handle_fitbit_response(r)
    j = r.json()
    items = (j.get("tempSkin") or []) if isinstance(j, dict) else []
    
    # Get the latest temperature reading
    delta_c = None
    measured_at_utc = None
    all_readings = []
    
    if items:
        # Collect all readings for debugging
        for item in items:
            value_obj = item.get("value") or {}
            reading_delta = value_obj.get("nightlyRelative")
            all_readings.append({
                "date": item.get("dateTime"),
                "delta_c": reading_delta,
                "value": value_obj
            })
        
        # Get the most recent reading with a valid delta value
        # Find the last item with a non-null nightlyRelative
        for item in reversed(items):
            value_obj = item.get("value") or {}
            reading_delta = value_obj.get("nightlyRelative")
            if reading_delta is not None:
                delta_c = reading_delta
                date_time_str = item.get("dateTime")
                
                # Parse the timestamp
                if date_time_str:
                    try:
                        # Parse ISO format timestamp
                        measured_at_utc = datetime.fromisoformat(date_time_str.replace("Z", "+00:00"))
                    except (ValueError, AttributeError):
                        # Fallback: use midnight of the date in user's timezone
                        try:
                            date_obj = datetime.strptime(d, "%Y-%m-%d")
                            local_tz = ZoneInfo(tz)
                            measured_at_local = date_obj.replace(tzinfo=local_tz)
                            measured_at_utc = measured_at_local.astimezone(timezone.utc)
                        except Exception:
                            pass
                break
    
    # Save to database if we have a reading
    try:
        if delta_c is not None and measured_at_utc is not None:
            _upsert_temperature_reading(
                db,
                user_id=user.id,
                provider="fitbit",
                measured_at_utc=measured_at_utc,
                body_c=None,
                skin_c=None,
                delta_c=delta_c
            )
            db.commit()
    except Exception as e:
        db.rollback()
        print(f"Failed to save temperature for {d}: {e}")
    
    return {
        "date": d,
        "delta_c": delta_c,
        "saved": delta_c is not None,
        "reading_count": len(items),
        "all_readings": all_readings  # Include all readings for debugging
    }


@router.get("/resting-hr/today")
def fitbit_resting_hr_today(
    access_token: str,
    date: str = Query(default=None, description="YYYY-MM-DD (default: today)"),
    db: Session = Depends(get_db)
):
    """
    Get Fitbit resting heart rate for a given date and save it to the database.
    """
    # Resolve user from access token
    user, tz = _resolve_user_and_tz(db, access_token)
    d = date or _user_local_today(access_token)
    
    # Fetch resting heart rate data from Fitbit API
    url = f"{FITBIT_API}/1/user/-/activities/heart/date/{d}/1d.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    r = _handle_fitbit_response(r)
    j = r.json()
    arr = j.get("activities-heart", []) if isinstance(j, dict) else []
    v = (arr[0].get("value") if arr else {}) or {}
    resting_hr = v.get("restingHeartRate")
    
    # Save to database if we have a reading
    try:
        if resting_hr is not None:
            # Parse the date to UTC (midnight of that day in user's timezone)
            try:
                date_obj = datetime.strptime(d, "%Y-%m-%d")
                local_tz = ZoneInfo(tz)
                measured_at_local = date_obj.replace(tzinfo=local_tz)
                measured_at_utc = measured_at_local.astimezone(timezone.utc)
            except Exception:
                measured_at_utc = datetime.now(timezone.utc)
            
            heart_rate_crud.update_or_create_heart_rate_daily(
                db,
                user_id=user.id,
                provider="fitbit",
                date_local=date_obj,
                avg_bpm=resting_hr,
                min_bpm=None,
                max_bpm=None,
                sample_count=1
            )
            db.commit()
    except Exception as e:
        db.rollback()
        print(f"Failed to save resting HR for {d}: {e}")
    
    return {
        "date": d,
        "resting_hr": resting_hr,
        "saved": resting_hr is not None
    }


@router.get("/hrv/today")
def fitbit_hrv_today(
    access_token: str,
    date: str = Query(default=None, description="YYYY-MM-DD (default: today)"),
    db: Session = Depends(get_db)
):
    """
    Get Fitbit HRV for a given date and save it to the database.
    """
    # Resolve user from access token
    user, tz = _resolve_user_and_tz(db, access_token)
    d = date or _user_local_today(access_token)
    
    # Fetch HRV data from Fitbit API for a single day
    url = f"{FITBIT_API}/1/user/-/hrv/date/{d}/{d}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    r = _handle_fitbit_response(r)
    j = r.json()
    items = (j.get("hrv") or []) if isinstance(j, dict) else []
    
    # Extract HRV data
    rmssd_ms = None
    coverage = None
    low_quartile = None
    high_quartile = None
    
    if items and len(items) > 0:
        first_item = items[0]
        value_obj = first_item.get("value") or {}
        rmssd_ms = value_obj.get("dailyRmssd")
        coverage = value_obj.get("coverage")
        low_quartile = value_obj.get("lowQuartile")
        high_quartile = value_obj.get("highQuartile")
    
    # Save to database if we have a reading
    try:
        if rmssd_ms is not None:
            date_obj = datetime.strptime(d, "%Y-%m-%d").date()
            
            hrv_crud.update_or_create_hrv_daily(
                db,
                user_id=user.id,
                provider="fitbit",
                date_local=date_obj,
                rmssd_ms=rmssd_ms,
                coverage=coverage,
                low_quartile=low_quartile,
                high_quartile=high_quartile
            )
            db.commit()
    except Exception as e:
        db.rollback()
        print(f"Failed to save HRV for {d}: {e}")
    
    return {
        "date": d,
        "rmssd_ms": rmssd_ms,
        "coverage": coverage,
        "low_quartile": low_quartile,
        "high_quartile": high_quartile,
        "saved": rmssd_ms is not None
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


@router.get("/latest-heart-rate")
def get_latest_heart_rate_cached(access_token: str, db: Session = Depends(get_db)):
    """
    Get the latest heart rate reading without database caching.
    Fetches the last 2 hours of intraday HR data and returns the most recent value.
    """
    user, _ = _resolve_user_and_tz(db, access_token)
    
    try:
        # Fetch intraday heart rate for the last 2 hours with explicit detail parameter
        intraday_result = fitbit_intraday_heart_rate(
            access_token=access_token,
            minutes=120,
            detail="1sec"
        )
        
        items = intraday_result.get("items", [])
        latest = intraday_result.get("latest")
        
        if latest and isinstance(latest, dict):
            return {
                "bpm": latest.get("bpm"),
                "ts": latest.get("ts"),
                "cached_at": datetime.utcnow().isoformat(),
                "age_seconds": 0
            }
        
        return {
            "bpm": None,
            "ts": None,
            "cached_at": None,
            "age_seconds": None
        }
    except Exception as e:
        # If intraday fails, return empty
        return {
            "bpm": None,
            "ts": None,
            "cached_at": None,
            "age_seconds": None,
            "error": str(e)
        }


@router.get("/latest-heart-rate/persist")
def persist_latest_heart_rate(access_token: str, db: Session = Depends(get_db)):
    """
    Fetch the last 2 hours of intraday heart rate data and persist it to the database.
    This captures all HR readings from the rolling 2-hour window.
    """
    user, tz = _resolve_user_and_tz(db, access_token)
    
    try:
        # Fetch intraday heart rate for the last 2 hours with explicit detail parameter
        intraday_result = fitbit_intraday_heart_rate(
            access_token=access_token,
            minutes=120,
            detail="1sec"
        )
        
        items = intraday_result.get("items", [])
        window = intraday_result.get("window", {})
        
        if not items:
            return {
                "saved": False,
                "count": 0,
                "message": "No heart rate data available"
            }
        
        # Determine the date_local from the window
        start_local = window.get("start_local")
        if start_local:
            # Convert unix timestamp to datetime
            dt_local = datetime.fromtimestamp(start_local, tz=timezone.utc)
            date_local = dt_local.date()
        else:
            date_local = datetime.now().date()
        
        # Determine resolution (1sec or 1min based on data)
        resolution = "1sec" if len(items) > 60 else "1min"
        
        # Extract start and end times in UTC
        start_ts = window.get("start_local")
        end_ts = window.get("end_local")
        
        if start_ts and end_ts:
            start_at_utc = datetime.fromtimestamp(start_ts, tz=timezone.utc)
            end_at_utc = datetime.fromtimestamp(end_ts, tz=timezone.utc)
        else:
            # Fallback: use current time
            end_at_utc = datetime.now(timezone.utc)
            start_at_utc = end_at_utc - timedelta(hours=2)
        
        # Save to database
        try:
            heart_rate_intraday_crud.update_or_create_heart_rate_intraday(
                db,
                user_id=user.id,
                provider="fitbit",
                date_local=date_local,
                start_at_utc=start_at_utc,
                end_at_utc=end_at_utc,
                resolution=resolution,
                samples=items
            )
            db.commit()
            
            return {
                "saved": True,
                "count": len(items),
                "date_local": date_local.isoformat(),
                "start_utc": start_at_utc.isoformat(),
                "end_utc": end_at_utc.isoformat(),
                "resolution": resolution,
                "latest_bpm": items[-1].get("bpm") if items else None
            }
        except Exception as e:
            db.rollback()
            print(f"Failed to save intraday heart rate: {e}")
            return {
                "saved": False,
                "count": 0,
                "error": str(e)
            }
    except Exception as e:
        return {
            "saved": False,
            "count": 0,
            "error": str(e)
        }



