from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.envelope import ApiError, Err, Ok

router = APIRouter(prefix="/v1", tags=["health"])


class HealthData(BaseModel):
    db: str


@router.get("/health", response_model=Ok[HealthData], responses={503: {"model": Err}})
def health(session: Annotated[Session, Depends(get_db)]) -> Ok[HealthData]:
    """Prove the process is up and the database is reachable.

    Uses SELECT 1 rather than querying a table, because SP1 deliberately
    creates no tables.
    """
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise ApiError(
            "DB_UNAVAILABLE",
            "Database is not reachable.",
            status_code=503,
        ) from exc
    return Ok(data=HealthData(db="ok"))
