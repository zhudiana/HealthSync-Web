import os
from dotenv import load_dotenv

load_dotenv()

WITHINGS_CLIENT_ID = os.getenv("WITHINGS_CLIENT_ID")
WITHINGS_REDIRECT_URI = os.getenv("WITHINGS_REDIRECT_URI")
WITHINGS_CLIENT_SECRET = os.getenv("WITHINGS_CLIENT_SECRET")

FITBIT_CLIENT_ID = os.getenv("FITBIT_CLIENT_ID")
FITBIT_REDIRECT_URI = os.getenv("FITBIT_REDIRECT_URI")
FITBIT_CLIENT_SECRET = os.getenv("FITBIT_CLIENT_SECRET")

SQLALCHEMY_DATABASE_URL = os.getenv("SQLALCHEMY_DATABASE_URL")

APP_SECRET_KEY = os.getenv("APP_SECRET_KEY", "dev-insecure-change-me")

REDIS_URL = os.getenv("REDIS_URL")

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASS", "")
FROM_EMAIL = os.getenv("SMTP_FROM", "")