from pydantic import BaseModel, ConfigDict
from datetime import datetime
from uuid import UUID

# ----------- User Schemas -----------

class UserCreate(BaseModel):
    auth_user_id: str
    email: str | None = None
    display_name: str | None = None
    

class UserUpdate(BaseModel):
    email: str | None = None
    display_name: str | None = None
    hr_threshold_low: float | None = None
    hr_threshold_high: float | None = None

class UserRead(BaseModel):
    id: UUID
    auth_user_id: str
    email: str | None
    display_name: str | None
    hr_threshold_low: float | None
    hr_threshold_high: float | None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ----------- Withings Schemas -----------

class WithingsAccountCreate(BaseModel):
    withings_user_id: str
    full_name: str | None = None
    email: str | None = None  
    timezone: str | None = None
    access_token: str
    refresh_token: str
    scope: str | None = None
    token_type: str | None = None
    expires_at: datetime | None = None

class WithingsAccountRead(BaseModel):
    id: UUID
    user_id: UUID
    withings_user_id: str
    full_name: str | None
    email: str | None
    timezone: str | None
    scope: str | None
    token_type: str | None
    expires_at: datetime | None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

