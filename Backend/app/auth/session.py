# app/auth/session.py
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Tuple
import uuid
import jwt  

ALGORITHM = "HS256"
AUDIENCE = "healthsync"
ISSUER = "healthsync"

def create_session_token(
    *,
    user_id: uuid.UUID,
    auth_user_id: str,
    secret_key: str,
    expires_in_days: int = 7,
) -> str:
    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "sub": str(user_id),
        "uid": auth_user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=expires_in_days)).timestamp()),
        "aud": AUDIENCE,
        "iss": ISSUER,
    }
    return jwt.encode(payload, secret_key, algorithm=ALGORITHM)

def create_session_token_with_jti(
    *,
    user_id: uuid.UUID,
    auth_user_id: str,
    secret_key: str,
    expires_in_days: int = 7,
) -> Tuple[str, str]:
    """
    Mint a JWT and include a unique JTI we can store in DB for revocation.
    Returns (token, jti).
    """
    now = datetime.now(timezone.utc)
    jti = uuid.uuid4().hex
    payload: Dict[str, Any] = {
        "jti": jti,
        "sub": str(user_id),
        "uid": auth_user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=expires_in_days)).timestamp()),
        "aud": AUDIENCE,
        "iss": ISSUER,
    }
    token = jwt.encode(payload, secret_key, algorithm=ALGORITHM)
    return token, jti

def decode_session_token(token: str, *, secret_key: str) -> dict:
    return jwt.decode(token, secret_key, algorithms=[ALGORITHM], audience=AUDIENCE, issuer=ISSUER)
