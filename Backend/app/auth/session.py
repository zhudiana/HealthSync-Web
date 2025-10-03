# app/auth/session.py
from datetime import datetime, timedelta, timezone
from typing import Any, Dict
import uuid
import jwt  # pip install PyJWT

ALGORITHM = "HS256"
AUDIENCE = "healthsync"

def create_session_token(
    *,
    user_id: uuid.UUID,
    auth_user_id: str,
    secret_key: str,
    expires_in_days: int = 7,
) -> str:
    """
    Create a short-lived app session token (JWT) that the frontend will send
    as 'Authorization: Bearer <token>' on every API request.
    """
    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "sub": str(user_id),        # primary key in your users table
        "uid": auth_user_id,        # e.g. "withings:<userid>"
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=expires_in_days)).timestamp()),
        "aud": AUDIENCE,
    }
    return jwt.encode(payload, secret_key, algorithm=ALGORITHM)

def decode_session_token(token: str, *, secret_key: str) -> dict:
    """
    Verify and decode the JWT sent by the frontend.
    Raises if invalid/expired.
    """
    return jwt.decode(token, secret_key, algorithms=[ALGORITHM], audience=AUDIENCE)
