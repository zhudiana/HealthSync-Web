import os
import json
from typing import Optional, Dict, Any
import redis

REDIS_URL = os.getenv("REDIS_URL")  # must be set in prod
r = redis.Redis.from_url(
    REDIS_URL,
    decode_responses=True, 
)

NAMESPACE = "oauth:withings:state:"



def _key(state: str) -> str:
    return f"{NAMESPACE}{state}"

def put_oauth_state(state: str, payload: Dict[str, Any], ttl_seconds: int = 900) -> None:
    r.set(_key(state), json.dumps(payload), ex=ttl_seconds, nx=True)

def pop_oauth_state(state: str) -> Optional[Dict[str, Any]]:
    if hasattr(r, "getdel"):
        raw = r.getdel(_key(state))  # Redis >= 6.2
    else:
        pipe = r.pipeline()
        pipe.get(_key(state))
        pipe.delete(_key(state))
        raw, _ = pipe.execute()
    return json.loads(raw) if raw else None


