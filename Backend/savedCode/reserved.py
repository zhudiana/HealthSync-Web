#############################################################################################
################## We will use this when we build a webapp ##################################

# def generate_code_verifier():
#     return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode('utf-8').rstrip('=')

# def generate_code_challenge(verifier):
#     digest = hashlib.sha256(verifier.encode('utf-8')).digest()
#     return base64.urlsafe_b64encode(digest).decode('utf-8').rstrip('=')

# @router.get("/fitbit/login")
# def fitbit_login(request: Request):
#     code_verifier = generate_code_verifier()
#     code_challenge = generate_code_challenge(code_verifier)
#     state = secrets.token_urlsafe(32)  
    
    
#     if "code_verifiers" not in request.session:
#         request.session["code_verifiers"] = {}
#     request.session["code_verifiers"][state] = code_verifier

#     print("Session at login:", request.session)

    
#     params = {
#         "client_id": FITBIT_CLIENT_ID,
#         "response_type": "code",
#         "scope": "activity heartrate sleep profile",  
#         "redirect_uri": FITBIT_REDIRECT_URI,
#         "code_challenge": code_challenge,
#         "code_challenge_method": "S256",
#         "state": state
#     }
    
#     query = urlencode(params, quote_via=quote)
#     return RedirectResponse(url=f"https://www.fitbit.com/oauth2/authorize?{query}")

    
# @router.get("/fitbit/callback")
# def fitbit_callback(request: Request, code: str, state: str = None):
#     code_verifiers = request.session.get("code_verifiers", {})
#     code_verifier = code_verifiers.pop(state, None) if state else None

#     request.session["code_verifiers"] = code_verifiers

#     if not code_verifier:
#         return {"error": "Invalid state parameter - possible CSRF attack"}
    
#     credentials = f"{FITBIT_CLIENT_ID}:{FITBIT_CLIENT_SECRET}"
#     auth_header = base64.b64encode(credentials.encode()).decode()
    
#     headers = {
#         "Authorization": f"Basic {auth_header}",
#         "Content-Type": "application/x-www-form-urlencoded"
#     }
    
#     data = {
#         "client_id": FITBIT_CLIENT_ID,
#         "grant_type": "authorization_code",
#         "code": code,
#         "code_verifier": code_verifier,  # Required for PKCE
#         # Note: redirect_uri might be required depending on your app setup
#         "redirect_uri": FITBIT_REDIRECT_URI,
#     }
    
#     token_url = "https://api.fitbit.com/oauth2/token"
    
#     print("Session at callback:", request.session)
    
#     try:
#         res = requests.post(token_url, headers=headers, data=data)
#         res.raise_for_status()  # Raise exception for HTTP errors
        
#         token_data = res.json()
#         print("📥 Token response:", token_data)
        
        
#         return token_data
        
#     except requests.exceptions.HTTPError as e:
#         print("❌ HTTP Error:", e)
#         print("📦 Response status:", res.status_code)
#         print("📦 Response text:", res.text)
#         return {"error": f"HTTP {res.status_code}", "details": res.text}
    
#     except Exception as e:
#         print("❌ Error:", e)
#         return {"error": "Failed to exchange code for token", "details": str(e)}

#############################################################################################
