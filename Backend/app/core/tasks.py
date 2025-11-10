from datetime import datetime
from sqlalchemy.orm import Session
from app.db.models.user import User
from app.db.models.hr_notification import HeartRateNotification
from app.db.engine import SessionLocal
from app.core.email import EmailSender
from app.db.crud.metrics import get_heart_rate_daily
from app.core.celery_app import celery_app
import asyncio
import logging
import uuid

logger = logging.getLogger(__name__)

@celery_app.task(name="send_hr_threshold_alert")
def send_hr_threshold_alert_task(
    to_email: str,
    user_name: str,
    heart_rate: float,
    threshold_type: str,
    threshold_value: float,
    timestamp: str
) -> bool:
    """
    Celery task to send heart rate threshold alert emails asynchronously.
    """
    return EmailSender.send_hr_threshold_alert(
        to_email=to_email,
        user_name=user_name,
        heart_rate=heart_rate,
        threshold_type=threshold_type,
        threshold_value=threshold_value,
        timestamp=timestamp
    )

@celery_app.task(name="send_email")
def send_email_task(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: str = None
) -> bool:
    """
    Celery task to send generic emails asynchronously.
    """
    return EmailSender.send_email(
        to_email=to_email,
        subject=subject,
        html_content=html_content,
        text_content=text_content
    )

async def check_heart_rate_thresholds():
    """
    Background task to check heart rate thresholds and send email alerts.
    This should be run periodically (e.g., every 5 minutes).
    """
    try:
        db = SessionLocal()
        try:
            # Get all users who have set heart rate thresholds
            users = db.query(User).filter(
                (User.hr_threshold_low.isnot(None)) |
                (User.hr_threshold_high.isnot(None))
            ).all()

            for user in users:
                if not user.email:
                    continue  # Skip users without email addresses

                # Get the latest heart rate reading for this user
                # You'll need to implement this based on your data structure
                latest_hr = get_latest_heart_rate(db, user.id)
                
                if not latest_hr:
                    continue

                # Get or create notification record for this user
                notification = db.query(HeartRateNotification).filter_by(user_id=user.id).first()
                if not notification:
                    notification = HeartRateNotification(
                        id=str(uuid.uuid4()),
                        user_id=user.id,
                        last_notification_time=datetime.now()
                    )
                    db.add(notification)

                # Check max threshold
                if (user.hr_threshold_high and latest_hr["max"] and 
                    latest_hr["max"] > user.hr_threshold_high and
                    latest_hr["max"] != notification.last_max_notified):  # Only if value changed
                    try:
                        send_hr_threshold_alert_task.delay(
                            to_email=user.email,
                            user_name=user.display_name or "User",
                            heart_rate=latest_hr["max"],
                            threshold_type="high",
                            threshold_value=user.hr_threshold_high,
                            timestamp=latest_hr["timestamp"]
                        )
                        # Update notification record
                        notification.last_max_notified = latest_hr["max"]
                        notification.last_notification_time = datetime.now()
                        db.commit()
                        logger.info(f"Sent high HR alert to user {user.id}")
                    except Exception as e:
                        logger.error(f"Failed to send high HR alert to user {user.id}: {str(e)}")

                # Check min threshold
                if (user.hr_threshold_low and latest_hr["min"] and 
                    latest_hr["min"] < user.hr_threshold_low and
                    latest_hr["min"] != notification.last_min_notified):  # Only if value changed
                    try:
                        send_hr_threshold_alert_task.delay(
                            to_email=user.email,
                            user_name=user.display_name or "User",
                            heart_rate=latest_hr["min"],
                            threshold_type="low",
                            threshold_value=user.hr_threshold_low,
                            timestamp=latest_hr["timestamp"]
                        )
                        # Update notification record
                        notification.last_min_notified = latest_hr["min"]
                        notification.last_notification_time = datetime.now()
                        db.commit()
                        logger.info(f"Sent low HR alert to user {user.id}")
                    except Exception as e:
                        logger.error(f"Failed to send low HR alert to user {user.id}: {str(e)}")

        finally:
            db.close()

    except Exception as e:
        logger.error(f"Error in heart rate threshold check task: {str(e)}")

def get_latest_heart_rate(db: Session, user_id: str):
    """
    Get the latest heart rate reading for a user.
    Returns a dict with hr_average, hr_min, hr_max if found, None otherwise.
    """
    # Get today's date
    today = datetime.now().date()
    
    # Get heart rate data for today
    hr_data = get_heart_rate_daily(db, user_id, "withings", today)
    
    if hr_data:
        return {
            "value": hr_data["hr_average"],
            "min": hr_data["hr_min"],
            "max": hr_data["hr_max"],
            "timestamp": datetime.now(),
            "date": today.isoformat()
        }

async def start_background_tasks():
    """
    Start the background tasks that run periodically.
    Call this when your application starts.
    """
    while True:
        await check_heart_rate_thresholds()
        await asyncio.sleep(300)  # Wait 5 minutes between checks
