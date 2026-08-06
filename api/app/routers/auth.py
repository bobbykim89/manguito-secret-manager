import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from app.auth.dependencies import CurrentUser
from app.envelope import Err, Ok

# Endpoints a browser navigates to redirect on failure; endpoints JavaScript
# calls return the ADR 002 envelope. /me and /logout are the second kind.
# Tasks that add /google/start and /google/callback add the first kind.
router = APIRouter(prefix="/v1/auth", tags=["auth"])


class MeData(BaseModel):
    id: uuid.UUID
    email: str
    name: str | None


@router.get("/me", response_model=Ok[MeData], responses={401: {"model": Err}})
def me(user: CurrentUser) -> Ok[MeData]:
    return Ok(data=MeData(id=user.id, email=user.email, name=user.name))
