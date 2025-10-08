from fastapi import FastAPI
from app.withings.routes import router as withings_router
from app.fitbit.routes import router as fitbit_router
from fastapi.middleware.cors import CORSMiddleware
import app.db.models
from app.db.models import User, WithingsAccount, MetricDaily, MetricIntraday
from app.db.base import Base
from app.db.engine import engine
from app.routes import users as users_routes


app = FastAPI()
app.include_router(withings_router)
app.include_router(fitbit_router)
app.include_router(users_routes.router)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[  
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def create_tables():
    Base.metadata.create_all(bind=engine)