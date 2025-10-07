from app.db.engine import engine
from app.db.base import Base
from app.db.models import *

Base.metadata.create_all(bind=engine)