from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.dependencies import get_db, get_current_user
from app.db.models import user as user_models, withings_account as withings_models
from app.db.schemas import withings as schemas

router = APIRouter(prefix="/users", tags=["Users"])

@router.get("/me", response_model=schemas.UserRead)
def get_me(current: user_models = Depends(get_current_user)):
    return current

@router.patch("/me", response_model=schemas.UserRead)
def update_me(payload: schemas.UserUpdate,
              db: Session = Depends(get_db),
              current: user_models = Depends(get_current_user)):

    if payload.email is not None:
        current.email = payload.email
    if payload.display_name is not None:
        current.display_name = payload.display_name
        # optional mirror: fill Withings full_name if empty
        acc = db.query(withings_models).filter(withings_models.user_id == current.id).first()
        if acc and not (acc.full_name and acc.full_name.strip()):
            acc.full_name = payload.display_name
            db.add(acc)

    # thresholds
    min_bpm = payload.hr_min_bpm if payload.hr_min_bpm is not None else current.hr_min_bpm
    max_bpm = payload.hr_max_bpm if payload.hr_max_bpm is not None else current.hr_max_bpm
    if min_bpm is not None and max_bpm is not None and not (min_bpm < max_bpm):
        raise HTTPException(status_code=422, detail="hr_min_bpm must be less than hr_max_bpm")

    if payload.hr_min_bpm is not None:
        current.hr_min_bpm = payload.hr_min_bpm
    if payload.hr_max_bpm is not None:
        current.hr_max_bpm = payload.hr_max_bpm

    db.add(current)
    db.commit()
    db.refresh(current)
    return current


@router.get("/by-auth/{auth_user_id}", response_model=schemas.UserRead)
def get_user_by_auth(auth_user_id: str, db: Session = Depends(get_db)):
    user = db.query(user_models).filter(user_models.auth_user_id == auth_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@router.patch("/by-auth/{auth_user_id}", response_model=schemas.UserRead)
def update_user_by_auth(auth_user_id: str, payload: schemas.UserUpdate, db: Session = Depends(get_db)):
    user = db.query(user_models).filter(user_models.auth_user_id == auth_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Allow updating display name now (email optional if/when you want it)
    if payload.display_name is not None:
        user.display_name = payload.display_name
    if payload.email is not None:
        user.email = payload.email

    db.add(user)
    db.commit()
    db.refresh(user)
    return user