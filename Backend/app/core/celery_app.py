from celery import Celery
from app.config import REDIS_URL

# Initialize Celery with Redis backend from Upstash
celery_app = Celery(
    'healthsync',
    broker=REDIS_URL,
    backend=REDIS_URL,
    broker_connection_retry_on_startup=True
)

# Configure Celery
celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
)