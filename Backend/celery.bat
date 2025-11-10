@echo off
cd /d %~dp0
celery -A app.core.celery_app:celery_app worker --loglevel=info