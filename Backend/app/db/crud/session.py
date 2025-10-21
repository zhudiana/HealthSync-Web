from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session as DBSession

from app.db.models.session import Session as SessionModel


def create_session(
    db: DBSession,
    *,
    jti: str,
    user_id,
    expires_at: datetime,
    user_agent: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> SessionModel:
    sess = SessionModel(
        jti=jti,
        user_id=user_id,
        created_at=datetime.now(timezone.utc),
        expires_at=expires_at,
        user_agent=user_agent,
        ip_address=ip_address,
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return sess


def get_session_by_jti(db: DBSession, jti: str) -> Optional[SessionModel]:
    return db.query(SessionModel).filter(SessionModel.jti == jti).first()


def revoke_session(db: DBSession, jti: str) -> bool:
    sess = get_session_by_jti(db, jti)
    if not sess or sess.revoked_at is not None:
        return False
    sess.revoked_at = datetime.now(timezone.utc)
    db.commit()
    return True


def touch_session_last_seen(db: DBSession, jti: str) -> None:
    sess = get_session_by_jti(db, jti)
    if not sess:
        return
    sess.last_seen_at = datetime.now(timezone.utc)
    db.commit()
