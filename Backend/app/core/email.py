from typing import Optional
import smtplib
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
        if not all([EmailConfig.SMTP_USER, EmailConfig.SMTP_PASSWORD]):
            raise HTTPException(
                status_code=500,
                detail="Email configuration not initialized"
            )

        # Create message
        message = MIMEMultipart("alternative")
        message["Subject"] = subject
        message["From"] = EmailConfig.FROM_EMAIL
        message["To"] = to_email

        # Add plain text version (if provided)
        if text_content:
            message.attach(MIMEText(text_content, "plain"))

        # Add HTML version
        message.attach(MIMEText(html_content, "html"))

        try:
            # Create SMTP connection
            with smtplib.SMTP(EmailConfig.SMTP_HOST, EmailConfig.SMTP_PORT) as server:
                server.starttls()  # Enable TLS
                server.login(EmailConfig.SMTP_USER, EmailConfig.SMTP_PASSWORD)
                
                # Send email
                server.send_message(message)
                return True

        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to send email: {str(e)}"
            )

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
