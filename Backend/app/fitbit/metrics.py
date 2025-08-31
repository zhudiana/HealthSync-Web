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
    """
#   Daily summary (steps, calories, etc.) for a given date (default today).
#   """
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

    return {
        "date": d,
        "steps": steps,
        "caloriesOut": calories,
        "restingHeartRate": rhr,
        "sleepHours": sleep_hours,
        "weight": weight_value,
    }
