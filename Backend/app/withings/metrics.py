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
# @router.get("/daily")
# def daily_metrics(access_token: str, date: str = Query(default=None, description="YYYY-MM-DD")):
#     """
#     Daily snapshot from Withings:
#       - steps
#       - calories
#       - sleepHours
#     """
#     if not date:
#         date = _date.today().isoformat()

#     headers = _auth(access_token)

#     # --- Activity (steps + calories) ---
#     act_payload = {"action": "getactivity", "startdateymd": date, "enddateymd": date}
#     act_res = requests.post("https://wbsapi.withings.net/v2/measure", headers=headers, data=act_payload, timeout=30)
#     if act_res.status_code != 200:
#         return {"date": date, "steps": None, "calories": None, "sleepHours": None}
#     act_json = act_res.json() or {}
#     steps = calories = distance_km = None
#     if act_json.get("status") == 0:
#         acts = (act_json.get("body") or {}).get("activities") or []
#         a0 = acts[0] if acts else {}
#         steps = a0.get("steps")
#         calories = a0.get("calories")
#         distance_km = a0.get("distance")

#     # --- Sleep (hours) ---
#     slp_res = requests.post("https://wbsapi.withings.net/v2/sleep",
#                             headers=headers,
#                             data={"action": "getsummary", "startdateymd": date, "enddateymd": date},
#                             timeout=30)
#     sleep_hours = None
#     if slp_res.status_code == 200:
#         slp_json = slp_res.json() or {}
#         if slp_json.get("status") == 0:
#             series = (slp_json.get("body") or {}).get("series") or []
#             total_sec = 0
#             for item in series:
#                 data = item.get("data") or {}
#                 if isinstance(data.get("totalsleepduration"), (int, float)):
#                     total_sec += data["totalsleepduration"]
#                 elif isinstance(data.get("asleepduration"), (int, float)):
#                     total_sec += data["asleepduration"]
#             sleep_hours = round(total_sec / 3600.0, 2) if total_sec else None

#     return {
#         "date": date, 
#         "steps": steps, 
#         "calories": calories, 
#         "sleepHours": sleep_hours, 
#         "distanceKm": distance_km
#         }

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
        act_payload = {"action": "getactivity", "startdateymd": dstr, "enddateymd": dstr}
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
        slp_payload = {"action": "getsummary", "startdateymd": dstr, "enddateymd": dstr}
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

# -------- Weight --------
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

# -------- Heart Rate (latest/range) --------
@router.get("/heart-rate")
def heart_rate(access_token: str,
               start: Optional[str] = Query(None, description="YYYY-MM-DD"),
               end: Optional[str] = Query(None, description="YYYY-MM-DD")):
    """
    Latest or range of heart rate samples (bpm).
    If start/end omitted, returns the latest sample.
    """
    headers = _auth(access_token)
    payload = {"action":"getmeas","meastype":"11","category":1}
    if start and end:
        payload.update({"startdateymd": start, "enddateymd": end})
    j = _post(MEASURE_URL, headers, payload)
    if not j:
        return {"items": []}
    items = []
    for g in (j.get("body") or {}).get("measuregrps", []):
        for m in g.get("measures", []):
            if m.get("type") == 11:
                v = m.get("value")
                u = m.get("unit",0)
                bpm = v * (10 ** u) if isinstance(v,(int,float)) and isinstance(u,(int,float)) else None
                if bpm is not None:
                    items.append({"ts": g.get("date"), "bpm": bpm})
    if not (start and end) and items:
        latest = max(items, key=lambda x: x["ts"])
        return {"latest": latest}
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
    j = _post(SLEEP_V2_URL, headers, {"action":"getsummary","startdateymd":date,"enddateymd":date})
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