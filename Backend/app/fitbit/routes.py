from fastapi import APIRouter
from . import auth, metrics

router = APIRouter()
router.include_router(auth.router)
router.include_router(metrics.router)
