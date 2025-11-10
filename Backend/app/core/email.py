from typing import Optional
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from fastapi import HTTPException
from app.config import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, FROM_EMAIL

class EmailConfig:
    SMTP_HOST: str = SMTP_HOST
    SMTP_PORT: int = SMTP_PORT
    SMTP_USER: str = SMTP_USER
    SMTP_PASSWORD: str = SMTP_PASSWORD
    FROM_EMAIL: str = FROM_EMAIL

    @classmethod
    def initialize(cls, smtp_user: str, smtp_password: str, from_email: Optional[str] = None):
        cls.SMTP_USER = smtp_user
        cls.SMTP_PASSWORD = smtp_password
        cls.FROM_EMAIL = from_email or smtp_user

class EmailSender:
    @staticmethod
    def send_email(
        to_email: str,
        subject: str,
        html_content: str,
        text_content: Optional[str] = None
    ) -> bool:
        """
        Send an email using SMTP.
        
        Args:
            to_email: Recipient's email address
            subject: Email subject
            html_content: HTML content of the email
            text_content: Plain text content (optional)
            
        Returns:
            bool: True if email was sent successfully
            
        Raises:
            HTTPException: If email configuration is not set or if sending fails
        """
        logger = logging.getLogger(__name__)
        logger.info(f"=" * 80)
        logger.info(f"📧 EMAIL SEND REQUEST")
        logger.info(f"To: {to_email}")
        logger.info(f"Subject: {subject}")
        logger.info(f"SMTP Config:")
        logger.info(f"  Host: {EmailConfig.SMTP_HOST}")
        logger.info(f"  Port: {EmailConfig.SMTP_PORT}")
        logger.info(f"  User: {EmailConfig.SMTP_USER}")
        logger.info(f"  From: {EmailConfig.FROM_EMAIL}")
        logger.info(f"  Password set: {'Yes' if EmailConfig.SMTP_PASSWORD else 'No'}")
        logger.info(f"=" * 80)
        
        # Validate configuration
        if not EmailConfig.SMTP_USER:
            error_msg = "SMTP_USER is not set"
            logger.error(f"❌ {error_msg}")
            raise HTTPException(status_code=500, detail=error_msg)
            
        if not EmailConfig.SMTP_PASSWORD:
            error_msg = "SMTP_PASSWORD is not set"
            logger.error(f"❌ {error_msg}")
            raise HTTPException(status_code=500, detail=error_msg)
            
        if not EmailConfig.SMTP_HOST:
            error_msg = "SMTP_HOST is not set"
            logger.error(f"❌ {error_msg}")
            raise HTTPException(status_code=500, detail=error_msg)

        # Create message
        logger.info("📝 Creating email message...")
        message = MIMEMultipart("alternative")
        message["Subject"] = subject
        message["From"] = EmailConfig.FROM_EMAIL
        message["To"] = to_email

        # Add plain text version (if provided)
        if text_content:
            message.attach(MIMEText(text_content, "plain"))
            logger.info("✅ Added plain text content")

        # Add HTML version
        message.attach(MIMEText(html_content, "html"))
        logger.info("✅ Added HTML content")

        try:
            logger.info(f"🔌 Connecting to SMTP server {EmailConfig.SMTP_HOST}:{EmailConfig.SMTP_PORT}...")
            
            # Create SMTP connection with timeout
            server = smtplib.SMTP(EmailConfig.SMTP_HOST, EmailConfig.SMTP_PORT, timeout=30)
            logger.info("✅ Connected to SMTP server")
            
            # Enable debug output
            server.set_debuglevel(1)
            
            logger.info("🔒 Starting TLS...")
            server.starttls()
            logger.info("✅ TLS enabled")
            
            logger.info(f"🔑 Logging in as {EmailConfig.SMTP_USER}...")
            server.login(EmailConfig.SMTP_USER, EmailConfig.SMTP_PASSWORD)
            logger.info("✅ Login successful")
            
            logger.info(f"📤 Sending message from {EmailConfig.FROM_EMAIL} to {to_email}...")
            server.send_message(message)
            logger.info("✅ Message sent successfully")
            
            server.quit()
            logger.info("✅ Connection closed")
            logger.info("🎉 EMAIL SENT SUCCESSFULLY!")
            logger.info("=" * 80)
            
            return True

        except smtplib.SMTPAuthenticationError as e:
            error_msg = f"SMTP Authentication failed: {str(e)}"
            logger.error(f"❌ {error_msg}")
            raise HTTPException(status_code=500, detail=error_msg)
            
        except smtplib.SMTPException as e:
            error_msg = f"SMTP error occurred: {str(e)}"
            logger.error(f"❌ {error_msg}")
            raise HTTPException(status_code=500, detail=error_msg)
            
        except Exception as e:
            error_msg = f"Unexpected error sending email: {str(e)}"
            logger.error(f"❌ {error_msg}", exc_info=True)
            raise HTTPException(status_code=500, detail=error_msg)

    @staticmethod
    def send_hr_threshold_alert(
        to_email: str,
        user_name: str,
        heart_rate: float,
        threshold_type: str,
        threshold_value: float,
        timestamp: str
    ) -> bool:
        """
        Send a heart rate threshold alert email.
        
        Args:
            to_email: Recipient's email address
            user_name: Name of the user
            heart_rate: Current heart rate value
            threshold_type: Either "high" or "low"
            threshold_value: The threshold that was exceeded
            timestamp: When the threshold was exceeded
            
        Returns:
            bool: True if email was sent successfully
        """
        logger = logging.getLogger(__name__)
        logger.info(f"🏥 Preparing HR threshold alert email")
        logger.info(f"  User: {user_name}")
        logger.info(f"  Type: {threshold_type}")
        logger.info(f"  HR: {heart_rate} vs Threshold: {threshold_value}")
        
        subject = f"HealthSync Heart Rate Alert - {threshold_type.title()} Heart Rate Detected"
        
        html_content = f"""
        <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #e11d48;">HealthSync Heart Rate Alert</h2>
                    <p>Dear {user_name},</p>
                    <p>We detected that your heart rate has {
                        'exceeded' if threshold_type == 'high' else 'fallen below'
                    } your set threshold.</p>
                    
                    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p style="margin: 5px 0;"><strong>Current Heart Rate:</strong> {heart_rate} BPM</p>
                        <p style="margin: 5px 0;"><strong>{threshold_type.title()} Threshold:</strong> {threshold_value} BPM</p>
                        <p style="margin: 5px 0;"><strong>Time:</strong> {timestamp}</p>
                    </div>
                    
                    <p>If this reading concerns you, please consider:</p>
                    <ul>
                        <li>Checking your heart rate again</li>
                        <li>Taking a rest if you're active</li>
                        <li>Contacting your healthcare provider if readings persist</li>
                    </ul>
                    
                    <p style="color: #666; font-size: 0.9em;">
                        This is an automated alert from HealthSync. You can adjust your heart rate 
                        thresholds in your HealthSync dashboard settings.
                    </p>
                </div>
            </body>
        </html>
        """
        
        text_content = f"""
        HealthSync Heart Rate Alert

        Dear {user_name},

        We detected that your heart rate has {'exceeded' if threshold_type == 'high' else 'fallen below'} your set threshold.

        Current Heart Rate: {heart_rate} BPM
        {threshold_type.title()} Threshold: {threshold_value} BPM
        Time: {timestamp}

        If this reading concerns you, please consider:
        - Checking your heart rate again
        - Taking a rest if you're active
        - Contacting your healthcare provider if readings persist

        This is an automated alert from HealthSync. You can adjust your heart rate thresholds in your HealthSync dashboard settings.
        """
        
        return EmailSender.send_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content
        )