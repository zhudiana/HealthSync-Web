# app/withings/routes.py
from fastapi import APIRouter
from .auth import router as auth_router
from .metrics import router as metrics_router

router = APIRouter()
router.include_router(auth_router)        # /withings/login, /withings/exchange, etc.
router.include_router(metrics_router)     # /withings/metrics/...
