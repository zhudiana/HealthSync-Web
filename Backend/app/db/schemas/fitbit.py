from datetime import datetime
from pydantic import BaseModel

class FitbitAccountBase(BaseModel):
    fitbit_user_id: str
    full_name: str | None = None
    email: str | None = None
    timezone: str | None = None
    scope: str | None = None
    token_type: str | None = None
    expires_at: datetime | None = None

class FitbitAccountCreate(FitbitAccountBase):
    access_token: str
    refresh_token: str

class FitbitAccountUpdate(BaseModel):
    # allow partial updates on rotation/expiry
    access_token: str | None = None
    refresh_token: str | None = None
    scope: str | None = None
    token_type: str | None = None
    expires_at: datetime | None = None
    full_name: str | None = None
    email: str | None = None
    timezone: str | None = None
