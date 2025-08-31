from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
import base64
import requests
import hashlib
import secrets
import urllib.parse
from typing import Optional, Dict, Any
from app.config import FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET, FITBIT_REDIRECT_URI

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
def login_fitbit(scope: str = "activity heartrate location nutrition profile settings sleep social weight"):
    """
    Step 1 & 2: Generate PKCE values and redirect user to Fitbit authorization page
    
    Available scopes:
    - activity: Access to activities, steps, distance, calories burned, and active minutes
    - heartrate: Access to heart rate data
    - location: Access to GPS data
    - nutrition: Access to food logging data
    - profile: Access to profile information
    - settings: Access to user settings
    - sleep: Access to sleep data
    - social: Access to friends and leaderboards
    - weight: Access to weight and body fat data
    """
    try:
        # Generate PKCE values
        pkce_values = generate_pkce_values()
        
        # Store PKCE values and state in session
        oauth_sessions[pkce_values.state] = {
            "code_verifier": pkce_values.code_verifier,
            "code_challenge": pkce_values.code_challenge,
            "timestamp": secrets.token_hex(16)  # For session cleanup
        }
        
        # Build authorization URL
        auth_params = {
            "client_id": FITBIT_CLIENT_ID,
            "response_type": "code",
            "code_challenge": pkce_values.code_challenge,
            "code_challenge_method": "S256",
            "scope": scope,
            "state": pkce_values.state,
            "redirect_uri": FITBIT_REDIRECT_URI
        }
        
        auth_url = f"{FITBIT_AUTHORIZE_URL}?{urllib.parse.urlencode(auth_params)}"
        
        return {
            "authorization_url": auth_url,
            "state": pkce_values.state,
            "message": "Visit the authorization_url to authorize the application"
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generating authorization URL: {str(e)}"
        )

@router.get("/callback")
def fitbit_callback(code: str, state: str, error: Optional[str] = None):
    """
    Step 3 & 4: Handle the callback from Fitbit and exchange authorization code for tokens
    """
    try:
        # Check for authorization error
        if error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Authorization failed: {error}"
            )
        
        # Validate state parameter (CSRF protection)
        if state not in oauth_sessions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired state parameter"
            )
        
        session_data = oauth_sessions[state]
        code_verifier = session_data["code_verifier"]
        
        # Exchange authorization code for tokens
        token_response = exchange_code_for_tokens(code, code_verifier)
        
        # Clean up session data
        del oauth_sessions[state]
        
        return {
            "message": "Authorization successful",
            "tokens": token_response,
            "user_id": token_response.get("user_id")
        }
        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing callback: {str(e)}"
        )

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





