# app/utils/withings_parser.py

from datetime import datetime, timezone

WITHINGS_MEASURE_TYPES = {
    1: "weight",              # kg
    4: "height",              # m
    5: "fat_free_mass",       # kg
    6: "fat_ratio",           # %
    8: "fat_mass_weight",     # kg
    9: "diastolic_bp",        # mmHg
    10: "systolic_bp",        # mmHg
    11: "heart_rate",         # bpm
    54: "sp02",               # %
    71: "muscle_mass",        # kg
    76: "hydration",          # %
    77: "bone_mass",          # kg
    88: "pulse_wave_velocity",# m/s
    # Add more as needed
}

def parse_withings_measure_group(measuregrps: list) -> list[dict]:
    """
    Convert Withings API 'measuregrps' into human-readable values.
    Returns a list of dicts, one per measurement group.
    """
    results = []

    for group in measuregrps:
        # Convert timestamp -> UTC ISO string
        timestamp_unix = group.get("date")
        timestamp_iso = (
            datetime.fromtimestamp(timestamp_unix, tz=timezone.utc).isoformat()
            if timestamp_unix
            else None
        )

        entry = {
            "group_id": group.get("grpid"),
            "timestamp": timestamp_iso,
            "category": group.get("category"),
            "measures": {}
        }

        for measure in group.get("measures", []):
            m_type = measure["type"]
            name = WITHINGS_MEASURE_TYPES.get(m_type, f"unknown_{m_type}")
            value = measure["value"] * (10 ** measure["unit"])
            entry["measures"][name] = value

        results.append(entry)

    return results
