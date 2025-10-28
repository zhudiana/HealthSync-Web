# app/withings/routes.py
from fastapi import APIRouter
from .auth import router as auth_router
from .metrics import router as metrics_router
from app.routes.users import router as users_router

router = APIRouter()
router.include_router(auth_router)        # /withings/login, /withings/exchange, etc.
router.include_router(metrics_router)     # /withings/metrics/...
router.include_router(users_router)       # /withings/users/...