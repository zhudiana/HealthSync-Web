from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session
from app.db.database import SessionLocal
from app.db import models
from app.auth.session import decode_session_token
from app.config import APP_SECRET_KEY

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _extract_bearer(auth_header: str | None) -> str:
    """Extract the raw token from 'Authorization: Bearer <token>'."""
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid Authorization header format")
    return parts[1]

async def get_current_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> models.User:
    """
    Resolve the current app user from the app session token (JWT).
    The token is issued after Withings OAuth in your callback route and
    must be sent by the frontend on every request as 'Authorization: Bearer <token>'.
    """
    raw_token = _extract_bearer(authorization)

    try:
        payload = decode_session_token(raw_token, secret_key=APP_SECRET_KEY)
    except Exception:
        # You can special-case jwt.ExpiredSignatureError, jwt.InvalidTokenError, etc.
        raise HTTPException(status_code=401, detail="Invalid or expired session token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Malformed token (missing 'sub')")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        # Token is valid but user was deleted in the meantime.
        raise HTTPException(status_code=401, detail="User not found")

    return user