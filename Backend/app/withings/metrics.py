# app/withings/metrics.py
from fastapi import APIRouter, HTTPException, Query
import requests
from typing import Optional, List, Dict, Tuple
from app.withings.utils.withings_parser import parse_withings_measure_group
from datetime import datetime, timedelta,time, date as _date
from zoneinfo import ZoneInfo


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


def _user_tz(headers) -> ZoneInfo:
    # call Withings user/profile endpoint once and cache per access_token/user_id
    # tz_str = response["body"]["profile"]["timezone"]  # example field; store wherever you keep it
    tz_str = "America/Argentina/Cordoba"  # <- fetched dynamically
    try:
        return ZoneInfo(tz_str)
    except Exception:
        return ZoneInfo("Europe/Rome")


@router.get("/daily")
def daily_metrics(
    access_token: str,
    date: str = Query(default=None, description="YYYY-MM-DD"),
    fallback_days: int = Query(3, ge=0, le=14, description="Look back if empty"),
    debug: int = Query(0, description="Set 1 to include raw payloads")
):
    """
    Withings daily snapshot:
      - steps, distanceKm, (optional calories), sleepHours
      - uses daily roll-up when present
      - fills/overrides with intraday sums for the requested day window in user TZ
      - robust intraday parsing (list, epoch->object, metric->epoch->number)
    """
    if not date:
        date = _date.today().isoformat()

    headers = _auth(access_token)

    def fetch_for(dstr: str):
        steps = None
        calories = None
        distance_km = None
        tzname = None
        act_json = intr_json = None
        slp_json = None

        # ---------- Daily roll-up ----------
        act_payload = {
            "action": "getactivity",
            "startdateymd": dstr,
            "enddateymd": dstr,
            "data_fields": "steps,distance,calories,totalcalories,timezone",
            "timezone": "Europe/Rome",  # ensure day window aligns to user
        }
        act_res = requests.post(MEASURE_V2_URL, headers=headers, data=act_payload, timeout=30)
        if act_res.status_code == 200:
            act_json = act_res.json() or {}
            if act_json.get("status") == 0:
                activities = (act_json.get("body") or {}).get("activities") or []
                total_steps = 0
                total_dist_m = 0.0
                for a in activities:
                    tzname = tzname or a.get("timezone")
                    s = a.get("steps")
                    d_m = a.get("distance")
                    c = a.get("calories")
                    if isinstance(s, (int, float)):
                        total_steps += int(s)
                    if isinstance(d_m, (int, float)):
                        total_dist_m += float(d_m)  # meters
                    if calories is None and isinstance(c, (int, float)):
                        calories = c
                if total_steps > 0:
                    steps = total_steps
                if total_dist_m > 0:
                    distance_km = round(total_dist_m / 1000.0, 2)  # meters -> km

        # Resolve timezone for intraday window
        try:
            tz = ZoneInfo(tzname) if tzname else ZoneInfo("Europe/Rome")
        except Exception:
            tz = ZoneInfo("UTC")

        # ---------- Intraday fill for the requested day ----------
        # Build [start, end) for the entire requested date in that TZ
        day_dt = datetime.fromisoformat(dstr).date()
        start_dt = datetime.combine(day_dt, time(0, 0, 0)).replace(tzinfo=tz)
        end_dt = start_dt + timedelta(days=1)

        # If the requested date is today, cap end at "now" in TZ
        now_tz = datetime.now(tz)
        end_for_query = min(now_tz, end_dt) if day_dt == now_tz.date() else end_dt

        # Use intraday whenever roll-up is missing/partial (steps None/0 or distance None)
        if (steps is None or steps == 0) or (distance_km is None):
            intr_payload = {
                "action": "getintradayactivity",
                "startdate": int(start_dt.timestamp()),
                "enddate": int(end_for_query.timestamp()),
                "data_fields": "steps,distance",
                "timezone": "Europe/Rome",
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
                        # [{startdate, enddate, steps, distance}, ...]
                        for it in series or []:
                            add_pair(it or {})
                    elif isinstance(series, dict):
                        # Two possibilities:
                        # (A) { "epoch": {"steps":..,"distance":..}, ... }
                        # (B) { "steps": {"epoch": n, ...}, "distance": {"epoch": m, ...} }
                        keys = list(series.keys())
                        looks_like_metrics = all(
                            isinstance(series[k], dict) and
                            all(isinstance(v, (int, float)) for v in series[k].values())
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
                            for _k, v in series.items():
                                add_pair(v)

                    # Merge: prefer higher of daily vs intraday
                    if intr_steps > 0:
                        steps = max(int(steps or 0), intr_steps)
                    if intr_dist_m > 0:
                        distance_km = max(float(distance_km or 0.0), round(intr_dist_m / 1000.0, 2))

        # ---------- Sleep (unchanged) ----------
        sleep_hours = None
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
        if debug:
            resp["raw"] = {"activity": act_json, "intraday": intr_json, "sleep": slp_json}
        return resp

    def _has_any(r):
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
    # date-only convenience
    start: Optional[str] = Query(None, description="YYYY-MM-DD (defaults to today, user local)"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD (defaults to start)"),
    # NEW: rolling window ending now (takes precedence if provided)
    minutes: Optional[int] = Query(
        None, ge=1, le=1440,
        description="Lookback window in minutes, ending now (UTC-converted). If set, ignores start/end."
    ),
    # NEW: finer control within days (used only when minutes is not provided)
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