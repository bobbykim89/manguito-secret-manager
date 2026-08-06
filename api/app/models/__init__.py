"""Model package.

Every model must be imported here so Base.metadata is complete by the time
Alembic's env.py reads it. A model that is never imported is invisible to
autogenerate and silently missing from migrations.
"""

from app.models.session import UserSession
from app.models.user import User

__all__ = ["User", "UserSession"]
