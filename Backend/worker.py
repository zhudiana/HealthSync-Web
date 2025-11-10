from app.core.celery_app import celery_app

# This file is used by Render.com to run the Celery worker
if __name__ == '__main__':
    celery_app.worker_main(['worker', '--loglevel=info'])