from sqlalchemy.orm import Session
from app.db.models.withings_account import WithingsAccount   # <- direct import
from app.db.schemas import withings as schemas
from app.utils.crypto import encrypt_text

def upsert_withings_account(db: Session, user_id, payload: schemas.WithingsAccountCreate) -> WithingsAccount:
    acc = (
        db.query(WithingsAccount)
        .filter(
            WithingsAccount.user_id == user_id,
            WithingsAccount.withings_user_id == payload.withings_user_id,
        )
        .first()
    )
    if acc is None:
        acc = WithingsAccount(
            user_id=user_id,
            withings_user_id=payload.withings_user_id,
            full_name=payload.full_name,
            email=payload.email,
            timezone=payload.timezone,
            access_token=encrypt_text(payload.access_token),
            refresh_token=encrypt_text(payload.refresh_token),
            scope=payload.scope,
            token_type=payload.token_type,
            expires_at=payload.expires_at,
        )
        db.add(acc)
    else:
        acc.full_name = payload.full_name or acc.full_name
        acc.timezone = payload.timezone or acc.timezone
        acc.access_token = encrypt_text(payload.access_token)
        acc.refresh_token = encrypt_text(payload.refresh_token)
        acc.scope = payload.scope or acc.scope
        acc.token_type = payload.token_type or acc.token_type
        acc.expires_at = payload.expires_at or acc.expires_at

    db.commit()
    db.refresh(acc)
    return acc
