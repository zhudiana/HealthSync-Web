# app/withings/metrics.py
from fastapi import APIRouter, HTTPException, Query
import requests
from datetime import date as _date
from typing import Optional
from app.withings.utils.withings_parser import parse_withings_measure_group

router = APIRouter(tags=["Withings Metrics"], prefix="/withings/metrics")

MEASURE_URL = "https://wbsapi.withings.net/measure"
MEASURE_V2_URL = "https://wbsapi.withings.net/v2/measure"
SLEEP_V2_URL = "https://wbsapi.withings.net/v2/sleep"

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
        # Return empty payloads instead of throwing to keep UI resilient
        return None
    return j

# -------- Overview (weight + RHR) --------

@router.get("/daily")
def daily_metrics(
    access_token: str,
    date: str = Query(default=None, description="YYYY-MM-DD"),
    fallback_days: int = Query(3, ge=0, le=14, description="Look back if empty"),
    debug: int = Query(0, description="Set 1 to include raw payloads")  # NEW
):
    """
    Daily snapshot from Withings:
      - steps, calories, distanceKm, sleepHours
      - optional fallback: look back a few days for the latest non-empty day
      - debug=1 returns raw JSON blocks to help troubleshoot
    """
    if not date:
        date = _date.today().isoformat()

    headers = _auth(access_token)

    from datetime import datetime, timedelta

    def fetch_for(dstr: str):
        # --- Activity ---
        steps = calories = distance_km = None
        act_payload = {
            "action": "getactivity", 
            "startdateymd": dstr,
            "enddateymd": dstr,
             "data_fields": "steps,distance,calories,totalcalories"
            }
        act_res = requests.post(MEASURE_V2_URL, headers=headers, data=act_payload, timeout=30)

        act_json = None
        if act_res.status_code == 200:
            act_json = act_res.json() or {}
            if act_json.get("status") == 0:
                acts = (act_json.get("body") or {}).get("activities") or []
                a0 = acts[0] if acts else {}
                steps = a0.get("steps")
                calories = a0.get("calories")
                dist = a0.get("distance")
                if isinstance(dist, (int, float)):
                    # Some devices return meters; normalize to km with a heuristic.
                    distance_km = round(dist / 1000.0, 2) if dist > 1000 else round(dist, 2)

        # --- Sleep ---
        sleep_hours = None
        slp_payload = {
            "action": "getsummary", 
            "startdateymd": dstr, 
            "enddateymd": dstr,
            "data_fields": "totalsleepduration,asleepduration"
            }
        slp_res = requests.post(SLEEP_V2_URL, headers=headers, data=slp_payload, timeout=30)

        slp_json = None
        if slp_res.status_code == 200:
            slp_json = slp_res.json() or {}
            if slp_json.get("status") == 0:
                series = (slp_json.get("body") or {}).get("series") or []
                total_sec = 0
                for item in series:
                    data = item.get("data") or {}
                    if isinstance(data.get("totalsleepduration"), (int, float)):
                        total_sec += data["totalsleepduration"]
                    elif isinstance(data.get("asleepduration"), (int, float)):
                        total_sec += data["asleepduration"]
                sleep_hours = round(total_sec / 3600.0, 2) if total_sec else None

        resp = {
            "date": dstr,
            "steps": steps,
            "calories": calories,
            "sleepHours": sleep_hours,
            "distanceKm": distance_km,
        }

        if debug:  # NEW: include raw payloads + print to server logs
            resp["raw"] = {
                "activity": act_json,
                "sleep": slp_json,
            }
            # print("[WITHINGS DAILY DEBUG]", dstr, {"activity": act_json, "sleep": slp_json})  # NEW

        return resp

    # try requested date; if empty, look back
    def _has_any(r):
        return any(r.get(k) is not None for k in ("steps", "calories", "sleepHours", "distanceKm"))

    result = fetch_for(date)
    if not _has_any(result) and fallback_days > 0:
        dt = datetime.fromisoformat(date)
        for i in range(1, fallback_days + 1):
            cand = (dt - timedelta(days=i)).date().isoformat()
            r2 = fetch_for(cand)
            if _has_any(r2):
                r2["fallbackFrom"] = date
                return r2

    return result


@router.get("/overview")
def overview(access_token: str):
    """
    Minimal snapshot: latest weight (kg) and resting heart rate (bpm).
    """
    headers = _auth(access_token)
    # 1=weight, 11=HR; category=1 = real measurements
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
def weight_latest(access_token: str, lookback_days: int = Query(90, ge=1, le=365)):
    """
    Latest weight (kg) within lookback window.
    """
    headers = _auth(access_token)
    # Pull last N days by start/end ymd using v2/measure getactivity-like window isn’t needed for weight.
    # getmeas supports lastupdate; simplest is no window: API returns many groups, we pick last.
    j = _post(MEASURE_URL, headers, {"action":"getmeas","meastype":"1","category":1})
    if not j:
        return {"value": None, "latest_date": None}
    groups = (j.get("body") or {}).get("measuregrps", [])
    latest = None
    latest_ts = -1
    for g in groups:
        ts = g.get("date", -1)
        for m in g.get("measures", []):
            if m.get("type") == 1:
                v = m.get("value")
                u = m.get("unit",0)
                val = v * (10 ** u) if isinstance(v,(int,float)) and isinstance(u,(int,float)) else None
                if val is not None and ts > latest_ts:
                    latest_ts = ts
                    latest = (val, ts)
    if not latest:
        return {"value": None, "latest_date": None}
    from datetime import datetime, timezone
    return {"value": latest[0], "latest_date": datetime.fromtimestamp(latest[1], tz=timezone.utc).date().isoformat()}

@router.get("/weight/history")
def weight_history(access_token: str,
                   start: str = Query(..., description="YYYY-MM-DD"),
                   end: str = Query(..., description="YYYY-MM-DD")):
    headers = _auth(access_token)
    j = _post(MEASURE_URL, headers, {"action":"getmeas","meastype":"1","category":1,"startdateymd":start,"enddateymd":end})
    if not j:
        return {"start": start, "end": end, "items": []}
    items = []
    for g in (j.get("body") or {}).get("measuregrps", []):
        w = None
        for m in g.get("measures", []):
            if m.get("type") == 1:
                v = m.get("value")
                u = m.get("unit",0)
                w = v * (10 ** u) if isinstance(v,(int,float)) and isinstance(u,(int,float)) else None
        if w is not None:
            items.append({"date": _date.fromtimestamp(g.get("date")).isoformat(), "weight": w})
    # optional: sort by date
    items.sort(key=lambda x: x["date"])
    return {"start": start, "end": end, "items": items}


@router.get("/heart-rate/daily")
def heart_rate_daily(
    access_token: str,
    date: Optional[str] = Query(None, description="YYYY-MM-DD (defaults to today)")
):
    """
    Daily heart-rate roll-up from Withings (avg/min/max) for the given local day.
    This is NOT 'resting HR'; it's the day's HR summary calculated by Withings.
    """
    if not date:
        date = _date.today().isoformat()

    headers = _auth(access_token)
    payload = {
        "action": "getactivity",
        "startdateymd": date,
        "enddateymd": date,
        "data_fields": "hr_average,hr_min,hr_max"
    }
    j = _post(MEASURE_V2_URL, headers, payload)
    if not j:
        return {"date": date, "hr_average": None, "hr_min": None, "hr_max": None, "updatedAt": None}

    acts = (j.get("body") or {}).get("activities") or []
    a0 = acts[0] if acts else {}
    updated_at = a0.get("modified") or a0.get("date")  # epoch seconds if present

    return {
        "date": date,
        "hr_average": a0.get("hr_average"),
        "hr_min": a0.get("hr_min"),
        "hr_max": a0.get("hr_max"),
        "updatedAt": updated_at  # epoch seconds or None
    }

@router.get("/heart-rate/intraday")
def heart_rate_intraday(
    access_token: str,
    start: Optional[str] = Query(None, description="YYYY-MM-DD (defaults to today)"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD (defaults to start)")
):
    """
    Intraday heart-rate samples (bpm) using Measure v2 getintradayactivity.
    Use for charts or 'current' HR. Returns timestamps (epoch seconds) with bpm.
    """
    from datetime import datetime, timezone as _tz, timedelta
    import time as _time_mod

    headers = _auth(access_token)

    if not start:
        start = _date.today().isoformat()
    if not end:
        end = start

    def _day_bounds(ymd: str):
        # local start/end of day; if your server is UTC-only, adjust here
        start_dt_local = datetime.fromisoformat(ymd).replace(hour=0, minute=0, second=0, microsecond=0)
        end_dt_local = start_dt_local + timedelta(days=1)
        return int(start_dt_local.replace(tzinfo=_tz.utc).timestamp()), int(end_dt_local.replace(tzinfo=_tz.utc).timestamp())

    def _collect(start_unix: int, end_unix: int):
        payload = {
            "action": "getintradayactivity",
            "startdate": start_unix,
            "enddate": end_unix,
            "data_fields": "heart_rate"
        }
        j = _post(MEASURE_V2_URL, headers, payload)
        if not j:
            return []
        body = (j.get("body") or {})
        series = body.get("series")
        points = []
        if isinstance(series, list):
            src = series
        elif isinstance(series, dict):
            src = series.get("data") if isinstance(series.get("data"), list) else list(series.values())
        else:
            src = (body.get("data") or []) if isinstance(body.get("data"), list) else []

        for pt in src:
            d = pt.get("data") if isinstance(pt, dict) and isinstance(pt.get("data"), dict) else pt
            bpm = d.get("heart_rate")
            ts = pt.get("timestamp") or pt.get("time")  # different shapes exist
            if isinstance(bpm, (int, float)) and isinstance(ts, (int, float, int)):
                points.append({"ts": int(ts), "bpm": float(bpm)})
        return points

    items: list[dict] = []
    cur = _date.fromisoformat(start)
    last = _date.fromisoformat(end)
    while cur <= last:
        s, e = _day_bounds(cur.isoformat())
    
        if cur == _date.today():
            e = min(e, int(_time_mod.time()))
        items.extend(_collect(s, e))
        cur += timedelta(days=1)

  
    if start == end and items:
        latest = max(items, key=lambda x: x["ts"])
        return {"latest": latest, "items": items}

    return {"items": items}


# -------- Oxygen Saturation (SpO₂) --------
@router.get("/spo2")
def spo2(access_token: str,
         start: Optional[str] = Query(None, description="YYYY-MM-DD"),
         end: Optional[str] = Query(None, description="YYYY-MM-DD")):
    """
    Latest or range of SpO₂ (%).
    """
    headers = _auth(access_token)
    payload = {"action":"getmeas","meastype":"54","category":1}
    if start and end:
        payload.update({"startdateymd": start, "enddateymd": end})
    j = _post(MEASURE_URL, headers, payload)
    if not j:
        return {"items": []}
    items = []
    for g in (j.get("body") or {}).get("measuregrps", []):
        for m in g.get("measures", []):
            if m.get("type") == 54:
                v = m.get("value")
                u = m.get("unit",0)
                p = v * (10 ** u) if isinstance(v,(int,float)) and isinstance(u,(int,float)) else None
                if p is not None:
                    items.append({"ts": g.get("date"), "percent": p})
    if not (start and end) and items:
        latest = max(items, key=lambda x: x["ts"])
        return {"latest": latest}
    return {"items": items}


# -------- Body & Skin Temperature --------
@router.get("/temperature")
def temperature(access_token: str,
                start: str = Query(..., description="YYYY-MM-DD"),
                end: str = Query(..., description="YYYY-MM-DD")):
    """
    Range query for body_temp (71/12) and skin_temp (73), values in °C.
    Returns daily latest for each day in window when available.
    """
    headers = _auth(access_token)
    payload = {"action":"getmeas","meastype":"71,73,12","category":1,"startdateymd":start,"enddateymd":end}
    j = _post(MEASURE_URL, headers, payload)
    if not j:
        return {"start": start, "end": end, "items": []}
    items = []
    for g in (j.get("body") or {}).get("measuregrps", []):
        ts = g.get("date")
        body_c = None
        skin_c = None
        for m in g.get("measures", []):
            v = m.get("value"); u = m.get("unit",0)  # noqa: E702
            val = v * (10 ** u) if isinstance(v,(int,float)) and isinstance(u,(int,float)) else None
            t = m.get("type")
            if t in (71, 12) and val is not None:
                body_c = val
            if t == 73 and val is not None:
                skin_c = val
        if body_c is not None or skin_c is not None:
            items.append({"ts": ts, "body_c": body_c, "skin_c": skin_c})
    return {"start": start, "end": end, "items": items}


# -------- Sleep summary (hours) --------
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


@router.get("/test-measures")
def test_measures(access_token: str):
    params = {"action": "getmeas"}
    headers = {"Authorization": f"Bearer {access_token}"}

    response = requests.post(
        "https://wbsapi.withings.net/measure",
        data=params,
        headers=headers,
        timeout=30
    )

    if response.status_code != 200:
        return {"error": response.text}

    data = response.json()
    measuregrps = data.get("body", {}).get("measuregrps", [])
    parsed = parse_withings_measure_group(measuregrps) 

    return {"raw": data, "parsed": parsed}