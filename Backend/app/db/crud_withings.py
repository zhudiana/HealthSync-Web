from sqlalchemy.orm import Session
from app.db import models, schemas

def upsert_withings_account(db: Session, user_id, payload: schemas.WithingsAccountCreate) -> models.WithingsAccount:
    acc = (db.query(models.WithingsAccount)
             .filter(models.WithingsAccount.user_id == user_id,
                     models.WithingsAccount.withings_user_id == payload.withings_user_id)
             .first())

    if acc is None:
        acc = models.WithingsAccount(
            user_id=user_id,
            withings_user_id=payload.withings_user_id,
            full_name=payload.full_name,
            email=payload.email,
            timezone=payload.timezone,
            access_token=payload.access_token,
            refresh_token=payload.refresh_token,
            scope=payload.scope,
            token_type=payload.token_type,
            expires_at=payload.expires_at,
        )
        db.add(acc)
    else:
        acc.full_name = payload.full_name or acc.full_name
        acc.timezone = payload.timezone or acc.timezone
        acc.access_token = payload.access_token
        acc.refresh_token = payload.refresh_token
        acc.scope = payload.scope or acc.scope
        acc.token_type = payload.token_type or acc.token_type
        acc.expires_at = payload.expires_at or acc.expires_at

    db.commit()
    db.refresh(acc)
    return acc
