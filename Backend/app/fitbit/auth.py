from app.config import FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET, FITBIT_REDIRECT_URI
from fastapi import APIRouter, HTTPException, status, Body, Depends
from app.core.redis_kv import put_oauth_state, pop_oauth_state
from app.db.crud.user import get_or_create_user_from_fitbit
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Dict, Any
from app.dependencies import get_db
from app.db.schemas import fitbit as db_schemas
from app.db.crud.fitbit import upsert_fitbit_account
import base64
import requests
import hashlib
import secrets
import urllib.parse


router = APIRouter(prefix="/fitbit", tags=["Fitbit Auth"])


FITBIT_AUTHORIZE_URL = "https://www.fitbit.com/oauth2/authorize"
FITBIT_TOKEN_URL = "https://api.fitbit.com/oauth2/token"

oauth_sessions = {}

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    scope: str
    token_type: str
    user_id: str

class PKCEValues(BaseModel):
    code_verifier: str
    code_challenge: str
    state: str

def generate_pkce_values() -> PKCEValues:
    """Generate PKCE code verifier, challenge, and state values"""
    # Generate code verifier (random string 43-128 characters)
    code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode('utf-8').rstrip('=')
    
    # Generate code challenge (SHA256 hash of code verifier)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode('utf-8')).digest()
    ).decode('utf-8').rstrip('=')
    
    # Generate state parameter for CSRF protection
    state = secrets.token_urlsafe(32)
    
    return PKCEValues(
        code_verifier=code_verifier,
        code_challenge=code_challenge,
        state=state
    )



@router.get("/login")
def login_fitbit():
    FITBIT_SCOPES = "activity heartrate sleep temperature oxygen_saturation weight profile settings"
    pkce = generate_pkce_values()

    # Save state + code_verifier via Redis (15 min TTL)
    put_oauth_state(
        pkce.state,
        {
            "provider": "fitbit",
            "code_verifier": pkce.code_verifier,
            "created_at": int(datetime.now(tz=timezone.utc).timestamp()),
        },
        ttl_seconds=15 * 60,
    )

    auth_params = {
        "client_id": FITBIT_CLIENT_ID,
        "response_type": "code",
        "code_challenge": pkce.code_challenge,
        "code_challenge_method": "S256",
        "scope": FITBIT_SCOPES,
        "state": pkce.state,
        "redirect_uri": FITBIT_REDIRECT_URI,
        "prompt": "consent",
        "include_granted_scopes": "true",
    }
    url = f"{FITBIT_AUTHORIZE_URL}?{urllib.parse.urlencode(auth_params)}"
    return {"authorization_url": url, "state": pkce.state, "redirect_uri": FITBIT_REDIRECT_URI}


@router.post("/exchange")
def fitbit_exchange(
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

    code_verifier = (state_blob or {}).get("code_verifier")
    if not code_verifier:
        raise HTTPException(status_code=400, detail="Missing PKCE code_verifier for this state")

    # 1) Exchange code → tokens (Fitbit returns user_id here)
    tokens = exchange_code_for_tokens(code, code_verifier)
    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    scope = tokens.get("scope")
    token_type = tokens.get("token_type")
    fitbit_uid = str(tokens.get("user_id") or "")

    expires_in = tokens.get("expires_in")
    expires_at = (
        datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        if isinstance(expires_in, (int, float)) else None
    )

    # 2) Optional: fetch profile for a friendly name
    full_name = None
    try:
        prof = get_user_profile(access_token)  # your existing GET /fitbit/user-profile logic
        # Fitbit profile shape: {"user": {"displayName": "...", "fullName": "...", ...}}
        user_obj = (prof or {}).get("user") or {}
        full_name = user_obj.get("fullName") or user_obj.get("displayName")
    except Exception:
        pass

    # 3) Create/find app user (auth_user_id = "fitbit:{user_id}")
    user = get_or_create_user_from_fitbit(db, fitbit_uid, full_name)

    # 4) Upsert Fitbit account row (store refresh_token, not access_token)
    create_payload = db_schemas.FitbitAccountCreate(
        fitbit_user_id=fitbit_uid,
        full_name=full_name,
        email=None,
        timezone=None,
        access_token=access_token,
        refresh_token=refresh_token,
        scope=scope,
        token_type=token_type,
        expires_at=expires_at,
    )
    acc = upsert_fitbit_account(db, user.id, create_payload)

    return {
        "message": "Authorization successful",
        "account_id": str(acc.id),
        "fitbit_user_id": acc.fitbit_user_id,
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


def exchange_code_for_tokens(auth_code: str, code_verifier: str) -> Dict[str, Any]:
    """
    Exchange authorization code for access and refresh tokens
    """
    try:
        # Prepare Basic Authentication header
        credentials = f"{FITBIT_CLIENT_ID}:{FITBIT_CLIENT_SECRET}"
        encoded_credentials = base64.b64encode(credentials.encode()).decode()
        
        headers = {
            "Authorization": f"Basic {encoded_credentials}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        
        # Prepare token request data
        token_data = {
            "client_id": FITBIT_CLIENT_ID,
            "grant_type": "authorization_code",
            "redirect_uri": FITBIT_REDIRECT_URI,
            "code": auth_code,
            "code_verifier": code_verifier
        }
        
        # Make token request
        response = requests.post(
            FITBIT_TOKEN_URL,
            headers=headers,
            data=token_data,
            timeout=30
        )
        
        if response.status_code != 200:
            error_detail = response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Token exchange failed: {error_detail}"
            )
        
        return response.json()
        
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to connect to Fitbit API: {str(e)}"
        )


@router.post("/refresh")
def refresh_fitbit_token(refresh_token: str):
    """
    Refresh expired access token using refresh token
    """
    try:
        # Prepare Basic Authentication header
        credentials = f"{FITBIT_CLIENT_ID}:{FITBIT_CLIENT_SECRET}"
        encoded_credentials = base64.b64encode(credentials.encode()).decode()
        
        headers = {
            "Authorization": f"Basic {encoded_credentials}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        
        # Prepare refresh request data
        refresh_data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token
        }
        
        # Make refresh request
        response = requests.post(
            FITBIT_TOKEN_URL,
            headers=headers,
            data=refresh_data,
            timeout=30
        )
        
        if response.status_code != 200:
            error_detail = response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Token refresh failed: {error_detail}"
            )
        
        return response.json()
        
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to connect to Fitbit API: {str(e)}"
        )


@router.get("/revoke")
def revoke_fitbit_token(access_token: str):
    """
    Revoke access token (logout user)
    """
    try:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        
        data = {
            "token": access_token
        }
        
        response = requests.post(
            "https://api.fitbit.com/oauth2/revoke",
            headers=headers,
            data=data,
            timeout=30
        )
        
        if response.status_code != 200:
            error_detail = response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Token revocation failed: {error_detail}"
            )
        
        return {"message": "Token revoked successfully"}
        
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to connect to Fitbit API: {str(e)}"
        )


@router.get("/token-info")
def get_token_info(access_token: str):
    """Introspect an access token (active, scope, exp, etc.)."""
    try:
        creds = f"{FITBIT_CLIENT_ID}:{FITBIT_CLIENT_SECRET}"
        encoded = base64.b64encode(creds.encode()).decode()
        headers = {
            "Authorization": f"Basic {encoded}",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        data = {"token": access_token}

        r = requests.post(
            "https://api.fitbit.com/1.1/oauth2/introspect",
            headers=headers,
            data=data,
            timeout=30,
        )

        if r.status_code != 200:
            detail = r.json() if "application/json" in r.headers.get("content-type","") else r.text
            raise HTTPException(status_code=r.status_code, detail=detail)

        return r.json()

    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=503, detail=f"Failed to connect to Fitbit API: {e}")


# Clean up expired sessions (call this periodically or use a background task)
@router.delete("/cleanup-sessions")
def cleanup_expired_sessions():
    """
    Clean up expired OAuth sessions (for development/testing)
    In production, implement proper session management with TTL
    """
    global oauth_sessions
    # For now, just clear all sessions
    # In production, implement proper TTL-based cleanup
    cleared_count = len(oauth_sessions)
    oauth_sessions.clear()
    
    return {"message": f"Cleared {cleared_count} OAuth sessions"}


@router.get("/user-profile")
def get_user_profile(access_token: str):
    """
    Example endpoint to fetch user profile data using access token
    """
    try:
        headers = {
            "Authorization": f"Bearer {access_token}"
        }
        
        response = requests.get(
            "https://api.fitbit.com/1/user/-/profile.json",
            headers=headers,
            timeout=30
        )
        
        if response.status_code == 401:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Access token expired or invalid"
            )
        elif response.status_code != 200:
            error_detail = response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Failed to fetch profile: {error_detail}"
            )
        
        return response.json()
        
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to connect to Fitbit API: {str(e)}"
        )





