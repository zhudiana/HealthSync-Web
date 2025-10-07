import base64 
import hashlib
from cryptography.fernet import Fernet
from app.config import APP_SECRET_KEY

def _fernet() -> Fernet:
    raw = APP_SECRET_KEY.encode("utf-8")
    key32 = hashlib.sha256(raw).digest()
    return Fernet(base64.urlsafe_b64encode(key32))

def encrypt_text(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")

def decrypt_text(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
