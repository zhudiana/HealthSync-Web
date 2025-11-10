# worker.py - UPDATED
from app.core.celery_app import celery_app
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

if __name__ == '__main__':
    logger.info("🚀 Starting Celery worker...")
    celery_app.start(argv=['worker', '--loglevel=info', '--concurrency=2'])