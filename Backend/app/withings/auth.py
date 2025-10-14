from app.config import WITHINGS_CLIENT_ID, WITHINGS_REDIRECT_URI, WITHINGS_CLIENT_SECRET, APP_SECRET_KEY
from app.auth.session import create_session_token, create_session_token_with_jti, decode_session_token
from app.db.crud.session import create_session as create_session_row, revoke_session
from fastapi import Body, APIRouter, HTTPException, status, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.redis_kv import put_oauth_state, pop_oauth_state
from app.db.crud.user import get_or_create_user_from_withings   
from app.db.crud.withings import upsert_withings_account
from datetime import datetime, timedelta, timezone
from app.db.schemas import withings as db_schemas
from app.dependencies import get_db
from sqlalchemy.orm import Session
from urllib.parse import urlencode
from typing import Dict, Any
import requests
import secrets
import time
import json
import os


router = APIRouter()

WITHINGS_AUTHORIZE_URL = "https://account.withings.com/oauth2_user/authorize2"
WITHINGS_TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2"


bearer_for_logout = HTTPBearer(auto_error=True)



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
            except: 
                error_detail = response.text
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
        if "access_token" not in tokens or "refresh_token" not in tokens or "userid" not in tokens:
            raise HTTPException(400, "Malformed token response from Withings")
        return tokens
        
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to connect to Withings API: {str(e)}"
        )


@router.post("/withings/exchange")
def withings_exchange(
    payload: Dict[str, str] = Body(...),
    db: Session = Depends(get_db),
    request: Request = None
):
    code = payload.get("code")
    state = payload.get("state")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")

    state_blob = pop_oauth_state(state)
    if not state_blob:
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")


    tokens = exchange_code_for_tokens(code) 

    # # cleanup state
    # try:
    #     del withings_sessions[state]
    #     save_sessions(withings_sessions)
    # except Exception:
    #     pass

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

    session_token = create_session_token(
        user_id=user.id,
        auth_user_id=user.auth_user_id,
        secret_key=APP_SECRET_KEY,
        expires_in_days=7
    )


    # ---- Upsert Withings account row (no user_id linking yet) ----
    create_payload = db_schemas.WithingsAccountCreate(
        withings_user_id=userid,
        full_name=full_name,
        email=None,
        timezone=None,
        refresh_token=refresh_token,
        scope=scope,
        token_type=token_type,
        expires_at=expires_at,
    )
    acc = upsert_withings_account(db,user.id, create_payload)

    # --- Create app session (JWT + DB row) ---
    token, jti = create_session_token_with_jti(
        user_id=user.id,
        auth_user_id=user.auth_user_id,
        secret_key=APP_SECRET_KEY,
        expires_in_days=7,
    )

    # Persist session row (revocable)
    expires_at = datetime.utcnow() + timedelta(days=7)
    ua = request.headers.get("user-agent") if request else None
    ip = (request.client.host if request and request.client else None)

    create_session_row(
        db,
        jti=jti,
        user_id=user.id,
        expires_at=expires_at,
        user_agent=ua,
        ip_address=ip,
    )


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
        "session": {
            "token": session_token,
            "aud": "HealthSync",
            "ttl_days": 7
        }
    }

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
            except ValueError:
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

        resp = requests.post(
            "https://wbsapi.withings.net/v2/user",
            headers=headers,
            data=data,
            timeout=30,
        )

        placeholder = {
            "id": None,
            "firstName": None,
            "lastName": None,
            "fullName": "Withings User",
        }

        if resp.status_code != 200:
            return placeholder

        try:
            resp_json = resp.json() or {}
        except ValueError:
            return placeholder

        if resp_json.get("status") != 0:
            return placeholder

        users = (resp_json.get("body") or {}).get("users") or []
        user_obj = users[0] if users else {}

        first = (user_obj.get("firstname") or "").strip() or None
        last = (user_obj.get("lastname") or "").strip() or None
        full = (f"{first or ''} {last or ''}".strip() or None)

        return {
            "id": user_obj.get("id"),
            "firstName": first,
            "lastName": last,
            "fullName": full or "Withings User",
        }

    except requests.exceptions.RequestException:
        return {"id": None, "firstName": None, "lastName": None, "fullName": "Withings User"}

@router.post("/auth/logout")
def logout_current_session(
    creds: HTTPAuthorizationCredentials = Depends(bearer_for_logout),
    db: Session = Depends(get_db),
):
    """
    Revoke the current app session (DB-backed).
    Client must send: Authorization: Bearer <session JWT>
    """
    raw_token = creds.credentials
    try:
        claims = decode_session_token(raw_token, secret_key=APP_SECRET_KEY)
    except Exception:
        # invalid signature/expired/etc.
        raise HTTPException(status_code=401, detail="Invalid or expired session token")

    jti = claims.get("jti")
    if not jti:
        raise HTTPException(status_code=400, detail="Malformed token (missing 'jti')")

    ok = revoke_session(db, jti)
    return {"revoked": bool(ok)}




































# comment the following at production
# @router.get("/withings/debug-sessions")
# def debug_withings_sessions():
#     """Debug endpoint to check current sessions (DEV only)."""
#     if os.getenv("ENV", "dev") != "dev":
#         raise HTTPException(status_code=404, detail="Not found")

#     sessions = load_sessions()

#     masked = {k[:8] + "…" : v for k, v in sessions.items()}

#     return {
#         "session_count": len(sessions),
#         "sessions": list(masked.keys()),
#         "sessions_data": masked,
#     }


# @router.delete("/withings/cleanup-sessions")
# def cleanup_withings_sessions():
#     """Clean up all OAuth sessions (DEV only)."""
#     if os.getenv("ENV", "dev") != "dev":
#         raise HTTPException(status_code=404, detail="Not found")

#     sessions = load_sessions()
#     cleared_count = len(sessions)

#     sessions.clear()
#     save_sessions(sessions)  # overwrite file with {}

#     global withings_sessions
#     withings_sessions = {}

#     return {"message": f"Cleared {cleared_count} Withings OAuth sessions"}


# @router.delete("/withings/cleanup-expired-sessions")
# def cleanup_expired_sessions(max_age_seconds: int = 3600):
#     """
#     Clean up expired OAuth sessions older than max_age_seconds (defaults to 1 hour).
#     Deletes from both in-memory and the persisted JSON file.
#     """
#     # Optional: hide in prod
#     if os.getenv("ENV", "dev") != "dev":
#         raise HTTPException(status_code=404, detail="Not found")

#     # Sanitize input
#     if max_age_seconds < 0:
#         max_age_seconds = 0

#     # Load the freshest snapshot from disk
#     sessions = load_sessions()
#     current_time = int(time.time())
#     expired = []

#     # Build a new dict keeping only non-expired entries with valid timestamps
#     kept: dict[str, dict] = {}
#     for state, session_data in sessions.items():
#         ts = 0
#         if isinstance(session_data, dict):
#             ts = int(session_data.get("timestamp", 0) or 0)
#         age = current_time - ts
#         if ts <= 0 or age > max_age_seconds:
#             expired.append(state)
#         else:
#             kept[state] = session_data

#     # Persist trimmed set to disk
#     save_sessions(kept)

#     # Keep the in-memory global in sync
#     global withings_sessions
#     withings_sessions = kept

#     # Mask states in the response (avoid leaking full tokens)
#     masked_expired = [s[:8] + "…" for s in expired]
#     masked_remaining = [s[:8] + "…" for s in kept.keys()]

#     return {
#         "message": f"Cleaned up {len(expired)} expired sessions",
#         "expired_count": len(expired),
#         "remaining_count": len(kept),
#         "expired_sessions": masked_expired,
#         "remaining_sessions": masked_remaining,
#     }



