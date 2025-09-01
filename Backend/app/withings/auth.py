from fastapi import APIRouter, HTTPException, status
import requests
import secrets
from urllib.parse import urlencode
from typing import Dict, Any, Optional
from app.config import WITHINGS_CLIENT_ID, WITHINGS_REDIRECT_URI, WITHINGS_CLIENT_SECRET
import time
import json
import os
from app.withings.utils.withings_parser import parse_withings_measure_group

router = APIRouter()

WITHINGS_AUTHORIZE_URL = "https://account.withings.com/oauth2_user/authorize2"
WITHINGS_TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2"



SESSION_FILE = "withings_sessions.json"

def load_sessions():
    """Load sessions from file"""
    try:
        if os.path.exists(SESSION_FILE):
            with open(SESSION_FILE, 'r') as f:
                return json.load(f)
        return {}
    except Exception as e:
        print(f"Error loading sessions: {e}")
        return {}

def save_sessions(sessions):
    """Save sessions to file"""
    try:
        with open(SESSION_FILE, 'w') as f:
            json.dump(sessions, f, indent=2)
    except Exception as e:
        print(f"Error saving sessions: {e}")


withings_sessions = load_sessions()

@router.get("/withings/login")
def login_withings(scope: str = "user.metrics,user.activity"):
    """Generate authorization URL for Withings OAuth 2.0"""
    try:
        # Generate secure state parameter
        state = secrets.token_urlsafe(32)
        
        # Store state with timestamp
        global withings_sessions
        withings_sessions[state] = {
            "timestamp": int(time.time()),
            "created": time.strftime('%Y-%m-%d %H:%M:%S')
        }
        
        # Save to file
        save_sessions(withings_sessions)
        
        # Build authorization URL
        auth_params = {
            "response_type": "code",
            "client_id": WITHINGS_CLIENT_ID,
            "redirect_uri": WITHINGS_REDIRECT_URI,
            "scope": scope,
            "state": state
        }
        
        auth_url = f"{WITHINGS_AUTHORIZE_URL}?{urlencode(auth_params)}"
        
        return {
            "authorization_url": auth_url,
            "state": state,
            "message": "Visit the authorization_url to authorize the application",
            "debug_info": {
                "stored_sessions": list(withings_sessions.keys()),
                "redirect_uri": WITHINGS_REDIRECT_URI
            }
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generating authorization URL: {str(e)}"
        )

@router.get("/withings/callback")
def withings_callback(
    code: Optional[str] = None, 
    state: Optional[str] = None, 
    error: Optional[str] = None,
    error_description: Optional[str] = None
):
    """Handle callback and exchange authorization code for tokens"""
    try:
        # Load fresh sessions from file
        global withings_sessions
        withings_sessions = load_sessions()
        
        # Check for authorization error
        if error:
            error_msg = f"Authorization failed: {error}"
            if error_description:
                error_msg += f" - {error_description}"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )
        
        # Check if we have the required code
        if not code:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing authorization code"
            )
        
        # Validate state parameter
        state_valid = True
        if state:
            if state not in withings_sessions:
                # print(f"⚠️  State '{state}' not found in sessions: {list(withings_sessions.keys())}")
                # For development, continue but warn
                state_valid = False
            else:
                # print(f"✅ State '{state}' is valid")
                session_data = withings_sessions[state]
                age = int(time.time()) - session_data.get("timestamp", 0)
                # print(f"🕐 Session age: {age} seconds")
        else:
            # print("⚠️  No state parameter provided")
            state_valid = False
        
        token_response = exchange_code_for_tokens(code)
        
        # Clean up session data
        if state_valid and state and state in withings_sessions:
            del withings_sessions[state]
            save_sessions(withings_sessions)
            # print(f"🧹 Cleaned up session for state: {state}")
        
        return {
            "message": "Authorization successful",
            "tokens": token_response,
            "debug_info": {
                "code_length": len(code),
                "state_provided": state is not None,
                "state_valid": state_valid,
                "remaining_sessions": len(withings_sessions)
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        # print(f"❌ Callback error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing callback: {str(e)}"
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

# Debug and utility endpoints
@router.get("/withings/debug-sessions")
def debug_withings_sessions():
    """Debug endpoint to check current sessions"""
    return {
        "sessions": list(withings_sessions.keys()),
        "session_count": len(withings_sessions),
        "sessions_data": {k: v for k, v in withings_sessions.items()}
    }

@router.delete("/withings/cleanup-sessions")
def cleanup_withings_sessions():
    """Clean up all OAuth sessions"""
    global withings_sessions
    cleared_count = len(withings_sessions)
    withings_sessions.clear()
    return {"message": f"Cleared {cleared_count} Withings OAuth sessions"}

@router.delete("/withings/cleanup-expired-sessions")  
def cleanup_expired_sessions(max_age_seconds: int = 3600):
    """Clean up expired OAuth sessions older than max_age_seconds"""
    current_time = int(time.time())
    expired_sessions = []
    
    for state, session_data in list(withings_sessions.items()):
        session_age = current_time - session_data.get("timestamp", 0)
        if session_age > max_age_seconds:
            expired_sessions.append(state)
            del withings_sessions[state]
    
    return {
        "message": f"Cleaned up {len(expired_sessions)} expired sessions",
        "expired_sessions": expired_sessions,
        "remaining_sessions": len(withings_sessions)
    }

# Test endpoint for successful token response you showed
@router.get("/withings/test-user-info")
def test_user_info(access_token: str):
    """Test endpoint using your successful token"""
    
    try:
        params = {"action": "getuserslist"}
        headers = {"Authorization": f"Bearer {access_token}"}
        
        response = requests.post(
            "https://wbsapi.withings.net/v2/user",
            data=params,
            headers=headers,
            timeout=30
        )
        
        # print("📥 Test user info response:", response.status_code, response.text)
        
        if response.status_code == 200:
            return response.json()
        else:
            return {
                "error": f"HTTP {response.status_code}",
                "response": response.text
            }
            
    except Exception as e:
        return {"error": str(e)}


@router.get("/withings/test-measures")
def test_measures(access_token: str):
    params = {"action": "getmeas"}
    headers = {"Authorization": f"Bearer {access_token}"}

    response = requests.post(
        "https://wbsapi.withings.net/measure",
        data=params,
        headers=headers,
        timeout=30
    )

    if response.status_code != 200:
        return {"error": response.text}

    data = response.json()
    measuregrps = data.get("body", {}).get("measuregrps", [])
    parsed = parse_withings_measure_group(measuregrps)

    return {"raw": data, "parsed": parsed}


########################
# ADD: exchange endpoint so SPA can trade code -> tokens
from fastapi import Body

@router.post("/withings/exchange")
def withings_exchange(payload: Dict[str, str] = Body(...)):
    """
    SPA calls this after being redirected to /auth/callback with ?code&state.
    We validate `state` that we created in /withings/login, then exchange code.
    """
    code = payload.get("code")
    state = payload.get("state")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")

    # load latest sessions from file (same as in /withings/callback)
    global withings_sessions
    withings_sessions = load_sessions()

    if state not in withings_sessions:
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")

    # do the token exchange (you already implemented this)
    tokens = exchange_code_for_tokens(code)

    # clean up this state so it can't be reused
    try:
        del withings_sessions[state]
        save_sessions(withings_sessions)
    except Exception:
        pass

    return {"tokens": tokens}
