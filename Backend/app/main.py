from fastapi import FastAPI
from app.withings.routes import router as withings_router
from app.fitbit.routes import router as fitbit_router
from fastapi.middleware.cors import CORSMiddleware
import app.db.models
from app.db.models import User, WithingsAccount, MetricDaily, MetricIntraday
from app.db.base import Base
from app.db.engine import engine
from app.routes import users as users_routes
from app.core.email import EmailConfig
from app.core.tasks import start_background_tasks
import asyncio
import os


app = FastAPI()
app.include_router(withings_router)
app.include_router(fitbit_router)
app.include_router(users_routes.router)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[  
        "http://localhost:8080",
        # "https://health-sync-web.vercel.app"
        ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    # Create database tables
    Base.metadata.create_all(bind=engine)
    
    # Initialize email configuration from environment variables
    EmailConfig.load_from_env()
    
    # Start background tasks
    asyncio.create_task(start_background_tasks())