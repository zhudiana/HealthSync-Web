from fastapi import APIRouter, HTTPException, Query
import requests
from datetime import datetime
from zoneinfo import ZoneInfo

router = APIRouter(prefix="/fitbit/metrics", tags=["Fitbit Metrics"])
FITBIT_API = "https://api.fitbit.com"

def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}

def _user_local_today(access_token: str) -> str:
    try:
        r = requests.get(f"{FITBIT_API}/1/user/-/profile.json", headers=_auth_headers(access_token), timeout=15)
        tz = r.json().get("user", {}).get("timezone") or "UTC"
    except Exception:
        tz = "UTC"
    return datetime.now(ZoneInfo(tz)).date().isoformat()

@router.get("/summary")
def daily_summary(access_token: str, date: str = Query(default=None, description="YYYY-MM-DD")):
    d = date or _user_local_today(access_token)
    url = f"{FITBIT_API}/1/user/-/activities/date/{d}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Access token expired or invalid")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)

    data = r.json()
    summary = data.get("summary", {}) if isinstance(data, dict) else {}
    return {
        "date": d,
        "steps": summary.get("steps"),
        "caloriesOut": summary.get("caloriesOut"),
        "distances": summary.get("distances", []),
        "activeMinutes": {
            "fairly": summary.get("fairlyActiveMinutes"),
            "very": summary.get("veryActiveMinutes"),
            "lightly": summary.get("lightlyActiveMinutes"),
        },
        "raw": data,  # keep for dev
    }


@router.get("/resting-hr")
def fitbit_resting_hr(access_token: str, date: str = Query(default=None, description="YYYY-MM-DD")):
    """
    Resting heart rate for a given date (default today).
    """
    d = date or _user_local_today(access_token)
    url = f"{FITBIT_API}/1/user/-/activities/heart/date/{d}/1d.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Access token expired or invalid")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)

    j = r.json()
    arr = j.get("activities-heart", []) if isinstance(j, dict) else []
    v = (arr[0].get("value") if arr else {}) or {}
    return {"date": d, "restingHeartRate": v.get("restingHeartRate"), "raw": j}


@router.get("/sleep")
def fitbit_sleep_summary(access_token: str, date: str = Query(default=None, description="YYYY-MM-DD")):
    """
    Sleep summary for a given date (night ending on `date`, default today).
    """
    d = date or _user_local_today(access_token)
    url = f"{FITBIT_API}/1.2/user/-/sleep/date/{d}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Access token expired or invalid")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)

    j = r.json() if r.headers.get("content-type","").startswith("application/json") else {}
    s = j.get("summary", {}) if isinstance(j, dict) else {}
    mins_asleep = s.get("totalMinutesAsleep")
    hours = round(mins_asleep / 60, 2) if isinstance(mins_asleep, (int, float)) else None
    return {
        "date": d,
        "totalMinutesAsleep": mins_asleep,
        "hoursAsleep": hours,
        "stages": s.get("stages", {}),
        "raw": j,
    }



@router.get("/overview")
def fitbit_overview(access_token: str, date: str = Query(default=None, description="YYYY-MM-DD")):
    """
    Aggregated snapshot: steps, calories, resting HR, sleep hours, weight.
    """
    d = date or _user_local_today(access_token)

    def _get(url):
        rr = requests.get(url, headers=_auth_headers(access_token), timeout=30)
        if rr.status_code != 200:
            return None
        return rr.json()

    daily = _get(f"{FITBIT_API}/1/user/-/activities/date/{d}.json") or {}
    heart = _get(f"{FITBIT_API}/1/user/-/activities/heart/date/{d}/1d.json") or {}
    sleep = _get(f"{FITBIT_API}/1.2/user/-/sleep/date/{d}.json") or {}
    weight = _get(f"{FITBIT_API}/1/user/-/body/log/weight/date/{d}.json") or {}

    steps = (daily.get("summary") or {}).get("steps")
    calories = (daily.get("summary") or {}).get("caloriesOut")
    rhr = (((heart.get("activities-heart") or [])[0] or {}).get("value") or {}).get("restingHeartRate")
    mins_asleep = (sleep.get("summary") or {}).get("totalMinutesAsleep")
    sleep_hours = round(mins_asleep/60, 2) if isinstance(mins_asleep,(int,float)) else None
    latest_weight = ((weight.get("weight") or [])[:1] or [None])[0]
    weight_value = latest_weight.get("weight") if isinstance(latest_weight, dict) else None

    distances = (daily.get("summary") or {}).get("distances", [])
    total_km = None
    for dct in distances:
        if dct.get("activity") == "total":
             val = dct.get("distance")
             total_km = round(val, 2) if isinstance(val, (int, float)) else None
             break

    return {
        "date": d,
        "steps": steps,
        "caloriesOut": calories,
        "restingHeartRate": rhr,
        "sleepHours": sleep_hours,
        "weight": weight_value,
        "total_km": total_km,
    }


@router.get("/weight")
def fitbit_weight_latest(access_token: str, date: str = Query(default=None, description="YYYY-MM-DD")):
    """
    Latest weight log on or before `date` (default today).
    """
    # d = date or _today_str()
    d = date or _user_local_today(access_token)
    url = f"{FITBIT_API}/1/user/-/body/log/weight/date/{d}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Access token expired or invalid")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)

    j = r.json()
    items = j.get("weight", []) if isinstance(j, dict) else []
    latest = items[0] if items else {}
    # Fitbit returns in the user's unit setting; most dev accounts default to kg
    return {"date": d, "latest": latest, "value": latest.get("weight"), "raw": j}

# @router.get("/weight/latest")
# def fitbit_weight_latest(access_token: str):
#     """
#     Most recent weight log in the last 30 days (not just today).
#     """
#     url = f"{FITBIT_API}/1/user/-/body/log/weight/date/today/1m.json"
#     r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
#     if r.status_code == 401:
#         raise HTTPException(status_code=401, detail="Access token expired or invalid")
#     if r.status_code != 200:
#         raise HTTPException(status_code=r.status_code, detail=r.text)

#     j = r.json()
#     items = j.get("weight", []) if isinstance(j, dict) else []
#     latest = items[0] if items else {}
#     return {
#         "latest_date": latest.get("date"),
#         "value": latest.get("weight"),
#         "unit": latest.get("unit", "kg"),
#         "raw": j
#     }


@router.get("/vo2max")
def fitbit_vo2max(access_token: str,
                  start: str = Query(..., description="YYYY-MM-DD"),
                  end: str = Query(..., description="YYYY-MM-DD")):
    url = f"{FITBIT_API}/1/user/-/cardio-fitness/date/{start}/{end}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Access token expired or invalid")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)

    j = r.json()
    items = j.get("cardio-fitness", []) if isinstance(j, dict) else []
    # Normalize to ml/kg/min where present
    out = [{"date": i.get("dateTime"),
            "vo2max_ml_kg_min": (i.get("value") or {}).get("vo2Max")} for i in items]
    return {"start": start, "end": end, "items": out, "raw": j}


@router.get("/spo2-nightly")
def fitbit_spo2_nightly(access_token: str,
                        date: str = Query(default=None, description="YYYY-MM-DD")):
    d = date or _user_local_today(access_token)
    url = f"{FITBIT_API}/1/user/-/spo2/date/{d}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Access token expired or invalid")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)

    j = r.json()
    val = (j.get("spo2") or [{}])[0] if isinstance(j, dict) else {}
    return {
        "date": d,
        "average": (val.get("value") or {}).get("avg"),
        "min": (val.get("value") or {}).get("min"),
        "max": (val.get("value") or {}).get("max"),
        "raw": j
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
            "breaths_per_min": (i.get("value") or {}).get("breathingRate")} for i in items]
    return {"start": start, "end": end, "items": out, "raw": j}


@router.get("/temperature")
def fitbit_temperature(access_token: str,
                       start: str = Query(..., description="YYYY-MM-DD"),
                       end: str = Query(..., description="YYYY-MM-DD")):
    url = f"{FITBIT_API}/1/user/-/temp/skin/date/{start}/{end}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Access token expired or invalid")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    j = r.json()
    items = (j.get("tempSkin") or []) if isinstance(j, dict) else []
    out = [{"date": i.get("dateTime"),
            "delta_c": (i.get("value") or {}).get("nightlyRelative")} for i in items]
    return {"start": start, "end": end, "items": out, "raw": j}


@router.get("/azm")
def fitbit_active_zone_minutes(access_token: str,
                               start: str = Query(..., description="YYYY-MM-DD"),
                               end: str = Query(..., description="YYYY-MM-DD")):
    url = f"{FITBIT_API}/1/user/-/activities/active-zone-minutes/date/{start}/{end}.json"
    r = requests.get(url, headers=_auth_headers(access_token), timeout=30)
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Access token expired or invalid")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    j = r.json()
    items = (j.get("activities-active-zone-minutes") or []) if isinstance(j, dict) else []
    out = [{"date": i.get("dateTime"),
            "minutes": (i.get("value") or {}).get("activeZoneMinutes")} for i in items]
    return {"start": start, "end": end, "items": out, "raw": j}


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


