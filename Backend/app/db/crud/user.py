from sqlalchemy.orm import Session
from app.db.models.user import User  # <-- import the class, not the module

def get_or_create_user_from_withings(db: Session, withings_user_id: str, full_name: str | None = None) -> User:
    auth_user_id = f"withings:{withings_user_id}"
    user = db.query(User).filter(User.auth_user_id == auth_user_id).first()
    if user:
        if full_name and not user.display_name:
            user.display_name = full_name
            db.add(user)
            db.commit()
            db.refresh(user)
        return user
    user = User(auth_user_id=auth_user_id, display_name=full_name)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
