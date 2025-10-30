from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.db.models.user import User
from app.db.models.withings_account import WithingsAccount
from app.db.schemas.withings import UserRead, UserUpdate

router = APIRouter(prefix="/users", tags=["Users"])

@router.get("/by-auth/{auth_user_id}", response_model=UserRead)
def get_user_by_auth(auth_user_id: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.auth_user_id == auth_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/by-auth/{auth_user_id}", response_model=UserRead)
def update_user_by_auth(
    auth_user_id: str,
    payload: UserUpdate,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.auth_user_id == auth_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.display_name is not None:
        user.display_name = payload.display_name

        acc = db.query(WithingsAccount).filter(WithingsAccount.user_id == user.id).first()
        if acc:
            acc.full_name = payload.display_name
            db.add(acc)

    if payload.email is not None:
        user.email = payload.email

    # Handle heart rate thresholds
    if payload.hr_threshold_low is not None:
        user.hr_threshold_low = payload.hr_threshold_low
    
    if payload.hr_threshold_high is not None:
        user.hr_threshold_high = payload.hr_threshold_high

    db.add(user)
    db.commit()
    db.refresh(user)
    return user
