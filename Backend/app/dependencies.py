from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.db.engine import SessionLocal
from app.db.models.user import User
from app.db.models.session import Session as SessionModel  # add this
from app.auth.session import decode_session_token
from app.config import APP_SECRET_KEY

# --- Database Dependency ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

bearer_scheme = HTTPBearer(auto_error=True)

async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    raw_token = creds.credentials
    try:
        payload = decode_session_token(raw_token, secret_key=APP_SECRET_KEY)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Malformed token (missing 'sub')")

    # Optional JTI validation (backward-compatible)
    jti = payload.get("jti")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # If the token includes a JTI, enforce DB session checks.
    if jti:
        now = datetime.now(timezone.utc)
        sess = (
            db.query(SessionModel)
            .filter(
                SessionModel.jti == jti,
                SessionModel.user_id == user.id,
                SessionModel.revoked_at.is_(None),
                SessionModel.expires_at > now,
            )
            .first()
        )
        if not sess:
            raise HTTPException(status_code=401, detail="Session expired or revoked")

    return user
