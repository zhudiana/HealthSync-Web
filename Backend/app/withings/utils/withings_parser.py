from datetime import datetime, timezone

WITHINGS_MEASURE_TYPES = {
    1:  "weight",               # kg
    4:  "height",               # m
    5:  "fat_free_mass",        # kg
    6:  "fat_ratio",            # %
    8:  "fat_mass_weight",      # kg
    9:  "diastolic_bp",         # mmHg
    10: "systolic_bp",          # mmHg
    11: "heart_rate",           # bpm
    12: "temperature",          # °C 
    54: "spo2",                 # %
    71: "body_temperature",     # °C
    73: "skin_temperature",     # °C
    76: "muscle_mass",          # kg
    77: "hydration",            # kg 
    88: "bone_mass",            # kg
    91: "pulse_wave_velocity",  # m/s
}

def parse_withings_measure_group(measuregrps: list) -> list[dict]:
    results = []
    for group in measuregrps or []:
        ts_unix = group.get("date")
        ts_iso = datetime.fromtimestamp(ts_unix, tz=timezone.utc).isoformat() if ts_unix else None
        entry = {
            "group_id": group.get("grpid"),
            "timestamp": ts_iso,
            "category": group.get("category"),
            "measures": {}
        }
        for m in group.get("measures", []):
            name = WITHINGS_MEASURE_TYPES.get(m.get("type"), f"unknown_{m.get('type')}")
            value = m.get("value")
            unit_pow10 = m.get("unit", 0)
            val = value * (10 ** unit_pow10) if isinstance(value, (int, float)) and isinstance(unit_pow10, (int, float)) else None
            entry["measures"][name] = val
        results.append(entry)
    return results
