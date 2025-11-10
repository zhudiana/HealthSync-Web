from celery import Celery
from app.config import REDIS_URL

# Add SSL certificate requirements to Redis URL if using rediss://
if REDIS_URL and REDIS_URL.startswith('rediss://'):
    redis_url = f"{REDIS_URL}?ssl_cert_reqs=CERT_NONE"
else:
    redis_url = REDIS_URL

# Initialize Celery with Redis backend from Upstash
celery_app = Celery(
    'healthsync',
    broker=redis_url,
    backend=redis_url,
    broker_connection_retry_on_startup=True,
    include=['app.core.tasks']  # Tell Celery where to find tasks
)

# Configure Celery
celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
)