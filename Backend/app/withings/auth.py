from fastapi import Body
from fastapi import APIRouter, HTTPException, status
import requests
import secrets
from urllib.parse import urlencode
from typing import Dict, Any
from app.config import WITHINGS_CLIENT_ID, WITHINGS_REDIRECT_URI, WITHINGS_CLIENT_SECRET
import time
from fastapi import Depends
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.db.schemas import withings as db_schemas
from app.db.crud.withings import upsert_withings_account
from datetime import datetime, timedelta, timezone
from app.db.crud.user import get_or_create_user_from_withings  
from app.core.redis_kv import put_oauth_state, pop_oauth_state 


router = APIRouter()

WITHINGS_AUTHORIZE_URL = "https://account.withings.com/oauth2_user/authorize2"
WITHINGS_TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2"



@router.get("/withings/login")
def login_withings():
    """Generate authorization URL for Withings OAuth 2.0"""

    WITHINGS_SCOPE = "user.info,user.metrics,user.activity,user.sleepevents"
    try:
        # Generate secure state parameter
        state = secrets.token_urlsafe(32)
        
        put_oauth_state(
            state,
            {
                "created_at": int(time.time()),
                "provider": "withings",
            },
            ttl_seconds=15 * 60,
        )
        # Build authorization URL
        auth_params = {
            "response_type": "code",
            "client_id": WITHINGS_CLIENT_ID,
            "redirect_uri": WITHINGS_REDIRECT_URI,
            "scope": WITHINGS_SCOPE,
            "state": state
        }
        
        auth_url = f"{WITHINGS_AUTHORIZE_URL}?{urlencode(auth_params)}"
        
        return {
            "authorization_url": auth_url,
            "state": state,
            "message": "Visit the authorization_url to authorize the application",
            "debug_info": {
                "redirect_uri": WITHINGS_REDIRECT_URI
            }
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generating authorization URL: {str(e)}"
        )


def exchange_code_for_tokens(auth_code: str) -> Dict[str, Any]:
    """
    Exchange authorization code for access and refresh tokens
    OAuth 2.0 - No signatures required!
    """
    try:
        # Prepare token request data - OAuth 2.0 standard
        token_data = {
            "action": "requesttoken",  # Withings specific
            "client_id": WITHINGS_CLIENT_ID,
            "client_secret": WITHINGS_CLIENT_SECRET,
            "redirect_uri": WITHINGS_REDIRECT_URI,
            "grant_type": "authorization_code",
            "code": auth_code
        }
        
        
        # Make token request
        response = requests.post(
            WITHINGS_TOKEN_URL,
            data=token_data,
            headers={
                "Content-Type": "application/x-www-form-urlencoded"
            },
            timeout=30
        )
        
        if response.status_code != 200:
            try:
                error_detail = response.json()
            except Exception as e: 
                error_detail = {e}
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Token exchange failed: {error_detail}"
            )
        
        response_data = response.json()
        
        # Check if Withings returned an error in the response body
        if response_data.get("status") != 0:
            error_msg = response_data.get("error", "Unknown error")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Withings API error: {error_msg}"
            )
        
        tokens = response_data.get("body", {})
        return tokens
        
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to connect to Withings API: {str(e)}"
        )


@router.post("/withings/refresh")
def refresh_withings_token(refresh_token: str):
    """
    Refresh expired access token using refresh token
    """
    try:
        # Prepare refresh request data
        refresh_data = {
            "action": "requesttoken",
            "client_id": WITHINGS_CLIENT_ID,
            "client_secret": WITHINGS_CLIENT_SECRET,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token
        }
        
        
        response = requests.post(
            WITHINGS_TOKEN_URL,
            data=refresh_data,
            headers={
                "Content-Type": "application/x-www-form-urlencoded"
            },
            timeout=30
        )
 
        
        if response.status_code != 200:
            try:
                error_detail = response.json()
            except:
                error_detail = response.text
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Token refresh failed: {error_detail}"
            )
        
        response_data = response.json()
        
        if response_data.get("status") != 0:
            error_msg = response_data.get("error", "Unknown error")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Withings API error: {error_msg}"
            )
        
        return response_data.get("body", {})
        
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to connect to Withings API: {str(e)}"
        )


@router.get("/withings/profile")
def withings_profile(access_token: str):
    """
    Return a minimal Withings profile (id, firstName, lastName, fullName).
    Never 400s for UX: if Withings errors, return a safe placeholder.
    Requires scope: user.info
    """
    try:
        headers = {"Authorization": f"Bearer {access_token}"}
        data = {"action": "getuserslist"}

        r = requests.post(
            "https://wbsapi.withings.net/v2/user",
            headers=headers,
            data=data,
            timeout=30,
        )

        # Default placeholder (don’t break the UI)
        placeholder = {"id": None, "firstName": None, "lastName": None, "fullName": "Withings User"}

        # HTTP failure → return placeholder
        if r.status_code != 200:
            return placeholder

        j = r.json() or {}

        # Withings-level failure → return placeholder
        if j.get("status") != 0:
            # You can log j here for debugging if you want
            return placeholder

        users = (j.get("body") or {}).get("users") or []
        u = users[0] if users else {}

        first = (u.get("firstname") or "").strip() or None
        last  = (u.get("lastname") or "").strip() or None
        full  = (f"{first or ''} {last or ''}".strip() or None)

        return {
            "id": u.get("id"),
            "firstName": first,
            "lastName": last,
            "fullName": full or "Withings User",
        }

    except requests.exceptions.RequestException:
        # Network error → still return placeholder
        return {"id": None, "firstName": None, "lastName": None, "fullName": "Withings User"}


@router.post("/withings/exchange")
def withings_exchange(
    payload: Dict[str, str] = Body(...),
    db: Session = Depends(get_db),
):
    code = payload.get("code")
    state = payload.get("state")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")

    state_blob = pop_oauth_state(state)
    if not state_blob:
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")

    tokens = exchange_code_for_tokens(code)  # { access_token, refresh_token, expires_in, scope, token_type, userid, ... }

    

    # ---- Build payload ----
    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    scope = tokens.get("scope")
    token_type = tokens.get("token_type")
    userid = str(tokens.get("userid") or "")
    expires_in = tokens.get("expires_in")
    expires_at = (
        datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        if isinstance(expires_in, (int, float)) else None
    )

    # fetch profile name
    try:
        prof = withings_profile(access_token)
        full_name = prof.get("fullName")
    except Exception:
        full_name = None

    # ---- Create/find your APP user from Withings userid ----
    user = get_or_create_user_from_withings(db, userid, full_name)


    # ---- Upsert Withings account row (no user_id linking yet) ----
    create_payload = db_schemas.WithingsAccountCreate(
        withings_user_id=userid,
        full_name=full_name,
        email=None,
        timezone=None,
        access_token=access_token,
        refresh_token=refresh_token,
        scope=scope,
        token_type=token_type,
        expires_at=expires_at,
    )
    acc = upsert_withings_account(db,user.id, create_payload)

    return {
        "message": "Authorization successful",
        "account_id": str(acc.id),
        "withings_user_id": acc.withings_user_id,
        "full_name": acc.full_name,
        "app_user": {
            "id": str(user.id),
            "auth_user_id": user.auth_user_id,
            "display_name": user.display_name,
        },
        "expires_at": acc.expires_at.isoformat() if acc.expires_at else None,
        "scope": acc.scope,
        "tokens": tokens,
    }