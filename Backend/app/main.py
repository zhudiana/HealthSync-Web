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
    Base.metadata.create_all(bind=engine)
    
    EmailConfig.initialize(
        smtp_user=EmailConfig.SMTP_USER,
        smtp_password=EmailConfig.SMTP_PASSWORD,
        from_email=EmailConfig.FROM_EMAIL
    )
    
    asyncio.create_task(start_background_tasks())