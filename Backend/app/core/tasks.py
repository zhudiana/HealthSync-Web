from datetime import datetime, timedelta
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
    try:
        result = EmailSender.send_hr_threshold_alert(
            to_email=to_email,
            user_name=user_name,
            heart_rate=heart_rate,
            threshold_type=threshold_type,
            threshold_value=threshold_value,
            timestamp=timestamp
        )
        logger.info(f"Email sent successfully to {to_email}")
        return result
    except Exception as e:
        logger.error(f"Error sending email to {to_email}: {str(e)}")
        raise

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

def check_heart_rate_thresholds():
    """
    Background task to check heart rate thresholds and send email alerts.
    This should be run periodically (e.g., every 5 minutes).
    
    NOTE: Changed to sync function since we're doing blocking DB operations.
    """
    logger.info("Starting heart rate threshold check...")
    
    try:
        db = SessionLocal()
        try:
            # Get all users who have set heart rate thresholds
            users = db.query(User).filter(
                (User.hr_threshold_low.isnot(None)) |
                (User.hr_threshold_high.isnot(None))
            ).all()
            
            logger.info(f"Found {len(users)} users with heart rate thresholds set")

            for user in users:
                logger.info(f"Checking user {user.id} - Email: {user.email}")
                
                if not user.email:
                    logger.warning(f"User {user.id} has no email address")
                    continue

                # Get the latest heart rate reading for this user
                latest_hr = get_latest_heart_rate(db, user.id)
                
                if not latest_hr:
                    logger.info(f"No heart rate data found for user {user.id}")
                    continue
                
                logger.info(f"User {user.id} - Latest HR: max={latest_hr.get('max')}, min={latest_hr.get('min')}, "
                          f"thresholds: high={user.hr_threshold_high}, low={user.hr_threshold_low}")

                # Get or create notification record for this user
                notification = db.query(HeartRateNotification).filter_by(user_id=user.id).first()
                if not notification:
                    logger.info(f"Creating new notification record for user {user.id}")
                    notification = HeartRateNotification(
                        id=str(uuid.uuid4()),
                        user_id=user.id,
                        last_notification_time=datetime.now()
                    )
                    db.add(notification)
                    db.commit()
                    db.refresh(notification)

                # Check if enough time has passed since last notification (avoid spam)
                min_notification_interval = timedelta(hours=1)
                should_check = (
                    not notification.last_notification_time or
                    datetime.now() - notification.last_notification_time > min_notification_interval
                )

                # Check max threshold
                if user.hr_threshold_high and latest_hr["max"]:
                    logger.info(f"Checking high threshold: {latest_hr['max']} vs {user.hr_threshold_high}")
                    
                    if latest_hr["max"] > user.hr_threshold_high:
                        # Check if this is a new violation (value changed significantly or enough time passed)
                        is_new_violation = (
                            notification.last_max_notified is None or
                            abs(latest_hr["max"] - notification.last_max_notified) >= 5 or  # 5 BPM change
                            should_check
                        )
                        
                        if is_new_violation:
                            try:
                                logger.info(f"🚨 Triggering high HR alert for user {user.id} - HR: {latest_hr['max']} > threshold: {user.hr_threshold_high}")
                                
                                # Send email via Celery
                                send_hr_threshold_alert_task.delay(
                                    to_email=user.email,
                                    user_name=user.display_name or "User",
                                    heart_rate=float(latest_hr["max"]),
                                    threshold_type="high",
                                    threshold_value=float(user.hr_threshold_high),
                                    timestamp=latest_hr["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
                                )
                                
                                # Update notification record
                                notification.last_max_notified = latest_hr["max"]
                                notification.last_notification_time = datetime.now()
                                db.commit()
                                logger.info(f"✅ Successfully queued high HR alert for user {user.id}")
                            except Exception as e:
                                logger.error(f"❌ Failed to send high HR alert to user {user.id}: {str(e)}", exc_info=True)
                                db.rollback()
                        else:
                            logger.info(f"Skipping high HR alert for user {user.id} - already notified recently")

                # Check min threshold
                if user.hr_threshold_low and latest_hr["min"]:
                    logger.info(f"Checking low threshold: {latest_hr['min']} vs {user.hr_threshold_low}")
                    
                    if latest_hr["min"] < user.hr_threshold_low:
                        is_new_violation = (
                            notification.last_min_notified is None or
                            abs(latest_hr["min"] - notification.last_min_notified) >= 5 or
                            should_check
                        )
                        
                        if is_new_violation:
                            try:
                                logger.info(f"🚨 Triggering low HR alert for user {user.id} - HR: {latest_hr['min']} < threshold: {user.hr_threshold_low}")
                                
                                send_hr_threshold_alert_task.delay(
                                    to_email=user.email,
                                    user_name=user.display_name or "User",
                                    heart_rate=float(latest_hr["min"]),
                                    threshold_type="low",
                                    threshold_value=float(user.hr_threshold_low),
                                    timestamp=latest_hr["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
                                )
                                
                                notification.last_min_notified = latest_hr["min"]
                                notification.last_notification_time = datetime.now()
                                db.commit()
                                logger.info(f"✅ Successfully queued low HR alert for user {user.id}")
                            except Exception as e:
                                logger.error(f"❌ Failed to send low HR alert to user {user.id}: {str(e)}", exc_info=True)
                                db.rollback()
                        else:
                            logger.info(f"Skipping low HR alert for user {user.id} - already notified recently")

        finally:
            db.close()

    except Exception as e:
        logger.error(f"❌ Error in heart rate threshold check task: {str(e)}", exc_info=True)

def get_latest_heart_rate(db: Session, user_id: str):
    """
    Get the latest heart rate reading for a user.
    Checks today first, then looks back up to 7 days.
    Returns a dict with hr_average, hr_min, hr_max if found, None otherwise.
    """
    today = datetime.now().date()
    
    # Try to get data from the last 7 days
    for days_ago in range(8):
        check_date = today - timedelta(days=days_ago)
        hr_data = get_heart_rate_daily(db, user_id, "withings", check_date)
        
        if hr_data and hr_data.get("hr_max") and hr_data.get("hr_min"):
            logger.info(f"Found HR data for user {user_id} from {check_date}: {hr_data}")
            return {
                "value": hr_data["hr_average"],
                "min": hr_data["hr_min"],
                "max": hr_data["hr_max"],
                "timestamp": datetime.combine(check_date, datetime.min.time()),
                "date": check_date.isoformat()
            }
    
    logger.warning(f"No HR data found for user {user_id} in the last 7 days")
    return None

async def start_background_tasks():
    """
    Start the background tasks that run periodically.
    Call this when your application starts.
    """
    logger.info("🚀 Starting background tasks...")
    
    while True:
        try:
            # Run the check in a thread pool to avoid blocking
            await asyncio.to_thread(check_heart_rate_thresholds)
        except Exception as e:
            logger.error(f"Error in background task loop: {str(e)}", exc_info=True)
        
        logger.info("⏳ Waiting 5 minutes before next check...")
        await asyncio.sleep(300)  # Wait 5 minutes between checks