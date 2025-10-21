from sqlalchemy.orm import Session
from app.db.models.fitbit_account import FitbitAccount
from app.db.schemas.fitbit import FitbitAccountCreate, FitbitAccountUpdate
from uuid import UUID

def upsert_fitbit_account(
    db: Session,
    user_id: UUID,
    payload: FitbitAccountCreate | FitbitAccountUpdate,
) -> FitbitAccount:
    acc = (
        db.query(FitbitAccount)
        .filter(FitbitAccount.user_id == user_id,
                FitbitAccount.fitbit_user_id == payload.fitbit_user_id)
        .first()
    )

    if acc is None:
        acc = FitbitAccount(
            user_id=user_id,
            fitbit_user_id=payload.fitbit_user_id,
        )
        db.add(acc)

    # update common fields
    for field in ["full_name", "email", "timezone", "scope", "token_type", "expires_at"]:
        if hasattr(payload, field):
            setattr(acc, field, getattr(payload, field))

    # refresh token if present
    if getattr(payload, "refresh_token", None):
        acc.refresh_token = payload.refresh_token

    db.commit()
    db.refresh(acc)
    return acc
