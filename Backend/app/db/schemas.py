from pydantic import BaseModel
from datetime import datetime
from uuid import UUID


class UserSchema(BaseModel):
    id: UUID
    email: str

    class Config:
        orm_mode = True

class FitbitTokenSchema(BaseModel):
    id: str
    user_id: UUID
    access_token: str
    refresh_token: str
    expires_at: datetime

    class Config:
        orm_mode = True