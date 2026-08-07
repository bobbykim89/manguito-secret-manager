import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import BUCKET_CREATED, BUCKET_DELETED, record_audit
from app.auth.dependencies import CurrentUser
from app.buckets import create_bucket, get_bucket, list_buckets
from app.crypto.keys import KeyProvider, get_key_provider
from app.db import get_db
from app.envelope import ApiError, Err, Ok
from app.models import Bucket
from app.models.bucket import NAME_PATTERN

router = APIRouter(prefix="/v1/buckets", tags=["buckets"])

Db = Annotated[Session, Depends(get_db)]
Provider = Annotated[KeyProvider, Depends(get_key_provider)]


class BucketData(BaseModel):
    """What a bucket looks like from outside.

    Carries no wrapped_dek and no kek_version. The key tier is not a user
    facing concept and nothing about it leaves the server.
    """

    id: uuid.UUID
    name: str
    created_at: datetime


class CreateBucketRequest(BaseModel):
    name: str = Field(pattern=NAME_PATTERN)


class DeletedData(BaseModel):
    deleted: bool


def _to_data(bucket: Bucket) -> BucketData:
    return BucketData(id=bucket.id, name=bucket.name, created_at=bucket.created_at)


@router.get("", response_model=Ok[list[BucketData]], responses={401: {"model": Err}})
def list_endpoint(user: CurrentUser, session: Db) -> Ok[list[BucketData]]:
    return Ok(data=[_to_data(bucket) for bucket in list_buckets(session, user)])


@router.post(
    "",
    response_model=Ok[BucketData],
    status_code=201,
    responses={401: {"model": Err}, 409: {"model": Err}, 422: {"model": Err}},
)
def create_endpoint(
    body: CreateBucketRequest, user: CurrentUser, session: Db, provider: Provider
) -> Ok[BucketData]:
    try:
        bucket = create_bucket(session, provider, user, body.name)
        record_audit(session, user_id=user.id, action=BUCKET_CREATED, bucket_name=bucket.name)
        session.commit()
    except IntegrityError:
        # The unique constraint decides, not a prior SELECT. Check then
        # insert has a race between the two statements that the constraint
        # does not.
        session.rollback()
        raise ApiError(
            "BUCKET_EXISTS",
            f"A bucket named {body.name!r} already exists.",
            status_code=409,
        ) from None
    return Ok(data=_to_data(bucket))


@router.delete(
    "/{name}",
    response_model=Ok[DeletedData],
    responses={401: {"model": Err}, 404: {"model": Err}},
)
def delete_endpoint(name: str, user: CurrentUser, session: Db) -> Ok[DeletedData]:
    bucket = get_bucket(session, user, name)
    if bucket is None:
        # 404 even when the bucket exists under another user. A 403 would
        # confirm the name is taken, which is an existence disclosure the
        # ADR 002 test plan specifically rules out.
        raise ApiError("BUCKET_NOT_FOUND", f"No bucket named {name!r}.", status_code=404)
    # SP4 adds the BUCKET_NOT_EMPTY guard here, once there is a secrets
    # table to count. See ADR 002 A18.
    session.delete(bucket)
    record_audit(session, user_id=user.id, action=BUCKET_DELETED, bucket_name=name)
    session.commit()
    return Ok(data=DeletedData(deleted=True))
