import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy.orm import Session

from app.api_keys import create_key, get_key, list_keys_with_buckets, revoke_key
from app.audit import APIKEY_CREATED, APIKEY_REVOKED, record_audit
from app.auth.dependencies import CurrentUser
from app.buckets import get_bucket
from app.db import get_db
from app.envelope import ApiError, Err, Ok
from app.models import ApiKey
from app.models.api_key import NAME_MAX_LENGTH
from app.models.bucket import NAME_PATTERN

# CurrentUser rather than CurrentCaller, deliberately. A key presented here
# is not rejected by a check that could be forgotten: it is never read,
# because this dependency does not look at the Authorization header. See ADR
# 002 A25.
router = APIRouter(prefix="/v1/keys", tags=["api keys"])

Db = Annotated[Session, Depends(get_db)]
BucketName = Annotated[str, Field(pattern=NAME_PATTERN)]


class ApiKeyData(BaseModel):
    """Metadata only. Never the token, never the stored hash."""

    id: uuid.UUID
    lookup_id: str
    name: str
    buckets: list[str]
    can_write: bool
    can_reveal: bool
    expires_at: datetime | None
    revoked_at: datetime | None
    last_used_at: datetime | None
    created_at: datetime


class CreatedApiKeyData(ApiKeyData):
    """The one response in this API that carries a live credential."""

    token: str


class CreateKeyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    buckets: list[BucketName] = Field(min_length=1, max_length=50)
    can_write: bool = False
    can_reveal: bool = False
    expires_at: AwareDatetime | None = None


class RevokedData(BaseModel):
    revoked: bool


def _to_data(key: ApiKey, buckets: list[str]) -> ApiKeyData:
    return ApiKeyData(
        id=key.id,
        lookup_id=key.lookup_id,
        name=key.name,
        buckets=buckets,
        can_write=key.can_write,
        can_reveal=key.can_reveal,
        expires_at=key.expires_at,
        revoked_at=key.revoked_at,
        last_used_at=key.last_used_at,
        created_at=key.created_at,
    )


@router.get("", response_model=Ok[list[ApiKeyData]], responses={401: {"model": Err}})
def list_endpoint(user: CurrentUser, session: Db) -> Ok[list[ApiKeyData]]:
    # Deliberately not audited, like the secret list. Reading which
    # credentials exist is not using one, and a row per page load would bury
    # the entries that matter.
    return Ok(
        data=[_to_data(key, buckets) for key, buckets in list_keys_with_buckets(session, user)]
    )


@router.post(
    "",
    response_model=Ok[CreatedApiKeyData],
    status_code=201,
    responses={401: {"model": Err}, 404: {"model": Err}, 422: {"model": Err}},
)
def create_endpoint(
    body: CreateKeyRequest, user: CurrentUser, session: Db
) -> Ok[CreatedApiKeyData]:
    if body.expires_at is not None and body.expires_at <= datetime.now(UTC):
        raise ApiError(
            "VALIDATION_ERROR",
            "expires_at is already in the past.",
            status_code=422,
        )
    buckets = []
    # A scope is a set, so a name repeated in the request means the same
    # thing once. dict.fromkeys deduplicates while keeping the caller's
    # order, which matters because the join table's composite primary key
    # would otherwise reject the second row and 500 the request.
    for name in dict.fromkeys(body.buckets):
        bucket = get_bucket(session, user, name)
        if bucket is None:
            # The same answer an unowned bucket gives everywhere else.
            raise ApiError("BUCKET_NOT_FOUND", f"No bucket named {name!r}.", status_code=404)
        buckets.append(bucket)

    key, token = create_key(
        session,
        user,
        name=body.name,
        buckets=buckets,
        can_write=body.can_write,
        can_reveal=body.can_reveal,
        expires_at=body.expires_at,
    )
    record_audit(session, user_id=user.id, action=APIKEY_CREATED, api_key_id=key.id)
    # Built before the commit: expire_on_commit would otherwise force a
    # refresh to read created_at afterwards.
    data = CreatedApiKeyData(
        **_to_data(key, sorted(bucket.name for bucket in buckets)).model_dump(),
        token=token,
    )
    session.commit()
    return Ok(data=data)


@router.delete(
    "/{key_id}",
    response_model=Ok[RevokedData],
    responses={401: {"model": Err}, 404: {"model": Err}, 422: {"model": Err}},
)
def revoke_endpoint(key_id: uuid.UUID, user: CurrentUser, session: Db) -> Ok[RevokedData]:
    key = get_key(session, user, key_id)
    if key is None:
        raise ApiError("API_KEY_NOT_FOUND", "No such API key.", status_code=404)
    if revoke_key(key):
        # Only the transition is audited. A repeated revoke changes nothing,
        # and a log full of no-ops buries the entry that mattered.
        record_audit(session, user_id=user.id, action=APIKEY_REVOKED, api_key_id=key.id)
    session.commit()
    return Ok(data=RevokedData(revoked=True))
