from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.db.models.user import User
from app.db.models.hr_notification import HeartRateNotification
from app.db.engine import SessionLocal
from app.core.email import EmailSender
from app.db.crud.metrics import get_heart_rate_daily
from app.db.crud import fitbit_current_hr as fitbit_current_hr_crud
import asyncio
import uuid

def send_hr_threshold_alert_task(
    to_email: str,
    user_name: str,
    heart_rate: float,
    threshold_type: str,
    threshold_value: float,
    timestamp: str
) -> bool:
    """
    Send heart rate threshold alert emails synchronously.
    """
    return EmailSender.send_hr_threshold_alert(
        to_email=to_email,
        user_name=user_name,
        heart_rate=heart_rate,
        threshold_type=threshold_type,
        threshold_value=threshold_value,
        timestamp=timestamp
    )

def send_email_task(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: str = None
) -> bool:
    """
    Send generic emails synchronously.
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
    
    For Withings: Uses daily aggregated data (min/max/avg)
    For Fitbit: Uses real-time current HR readings
    """
    try:
        db = SessionLocal()
        try:
            users = db.query(User).filter(
                (User.hr_threshold_low.isnot(None)) |
                (User.hr_threshold_high.isnot(None))
            ).all()

            for user in users:
                if not user.email:
                    continue

                # Try to get Fitbit current HR first (real-time)
                fitbit_hr = get_latest_fitbit_heart_rate(db, user.id)
                
                # If no Fitbit data, try Withings daily data
                withings_hr = None
                if not fitbit_hr:
                    withings_hr = get_latest_withings_heart_rate(db, user.id)
                
                # Use whichever provider has data
                latest_hr = fitbit_hr or withings_hr
                
                if not latest_hr:
                    continue

                notification = db.query(HeartRateNotification).filter_by(user_id=user.id).first()
                if not notification:
                    notification = HeartRateNotification(
                        id=str(uuid.uuid4()),
                        user_id=user.id,
                        last_notification_time=datetime.now()
                    )
                    db.add(notification)
                    db.commit()
                    db.refresh(notification)

                min_notification_interval = timedelta(hours=1)
                should_check = (
                    not notification.last_notification_time or
                    datetime.now() - notification.last_notification_time > min_notification_interval
                )

                # Check max threshold (or just current for Fitbit)
                check_hr_high = latest_hr.get("max") or latest_hr.get("current")
                if user.hr_threshold_high and check_hr_high:
                    if check_hr_high > user.hr_threshold_high:
                        is_new_violation = (
                            notification.last_max_notified is None or
                            abs(check_hr_high - notification.last_max_notified) >= 5 or
                            should_check
                        )
                        
                        if is_new_violation:
                            try:
                                send_hr_threshold_alert_task(
                                    to_email=user.email,
                                    user_name=user.display_name or "User",
                                    heart_rate=float(check_hr_high),
                                    threshold_type="high",
                                    threshold_value=float(user.hr_threshold_high),
                                    timestamp=latest_hr["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
                                )
                                
                                notification.last_max_notified = check_hr_high
                                notification.last_notification_time = datetime.now()
                                db.commit()
                            except Exception:
                                db.rollback()

                # Check min threshold (or just current for Fitbit)
                check_hr_low = latest_hr.get("min") or latest_hr.get("current")
                if user.hr_threshold_low and check_hr_low:
                    if check_hr_low < user.hr_threshold_low:
                        is_new_violation = (
                            notification.last_min_notified is None or
                            abs(check_hr_low - notification.last_min_notified) >= 5 or
                            should_check
                        )
                        
                        if is_new_violation:
                            try:
                                send_hr_threshold_alert_task(
                                    to_email=user.email,
                                    user_name=user.display_name or "User",
                                    heart_rate=float(check_hr_low),
                                    threshold_type="low",
                                    threshold_value=float(user.hr_threshold_low),
                                    timestamp=latest_hr["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
                                )
                                
                                notification.last_min_notified = check_hr_low
                                notification.last_notification_time = datetime.now()
                                db.commit()
                            except Exception:
                                db.rollback()

        finally:
            db.close()

    except Exception:
        pass

def get_latest_fitbit_heart_rate(db: Session, user_id: str):
    """
    Get the latest real-time heart rate reading for a Fitbit user.
    Returns dict with current HR value or None if not found.
    """
    try:
        fitbit_hr = fitbit_current_hr_crud.get_current_heart_rate(db, user_id=user_id)
        
        if fitbit_hr and fitbit_hr.current_bpm is not None:
            return {
                "current": fitbit_hr.current_bpm,
                "timestamp": fitbit_hr.measured_at_utc,
                "provider": "fitbit"
            }
    except Exception:
        pass
    
    return None

def get_latest_withings_heart_rate(db: Session, user_id: str):
    """
    Get the latest heart rate reading for a Withings user.
    Checks today first, then looks back up to 7 days.
    Returns dict with min/max/avg HR values or None if not found.
    """
    today = datetime.now().date()
    
    for days_ago in range(8):
        check_date = today - timedelta(days=days_ago)
        hr_data = get_heart_rate_daily(db, user_id, "withings", check_date)
        
        if hr_data and hr_data.get("hr_max") and hr_data.get("hr_min"):
            return {
                "value": hr_data["hr_average"],
                "min": hr_data["hr_min"],
                "max": hr_data["hr_max"],
                "timestamp": datetime.combine(check_date, datetime.min.time()),
                "date": check_date.isoformat(),
                "provider": "withings"
            }
    
    return None

async def start_background_tasks():
    """
    Start the background tasks that run periodically.
    """
    while True:
        try:
            await asyncio.to_thread(check_heart_rate_thresholds)
        except Exception:
            pass
        
        await asyncio.sleep(300)  # Wait 5 minutes between checks
