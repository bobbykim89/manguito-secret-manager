import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import BUCKET_CREATED, BUCKET_DELETED, record_audit
from app.auth.dependencies import CurrentUser
from app.buckets import bucket_has_secrets, create_bucket, get_bucket, list_buckets_with_counts
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
    secret_count: int


class CreateBucketRequest(BaseModel):
    name: str = Field(pattern=NAME_PATTERN)


class DeletedData(BaseModel):
    deleted: bool


def _to_data(bucket: Bucket, secret_count: int) -> BucketData:
    return BucketData(
        id=bucket.id,
        name=bucket.name,
        created_at=bucket.created_at,
        secret_count=secret_count,
    )


@router.get("", response_model=Ok[list[BucketData]], responses={401: {"model": Err}})
def list_endpoint(user: CurrentUser, session: Db) -> Ok[list[BucketData]]:
    return Ok(
        data=[_to_data(bucket, count) for bucket, count in list_buckets_with_counts(session, user)]
    )


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
    except IntegrityError as error:
        # The unique constraint decides, not a prior SELECT. Check then
        # insert has a race between the two statements that the constraint
        # does not.
        session.rollback()
        constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
        if constraint != "uq_buckets_user_id_name":
            # Some other violation. Reporting it as a duplicate name would
            # send the caller after a problem they do not have.
            raise
        raise ApiError(
            "BUCKET_EXISTS",
            f"A bucket named {body.name!r} already exists.",
            status_code=409,
        ) from None
    return Ok(data=_to_data(bucket, 0))


@router.delete(
    "/{name}",
    response_model=Ok[DeletedData],
    responses={401: {"model": Err}, 404: {"model": Err}, 409: {"model": Err}, 422: {"model": Err}},
)
def delete_endpoint(
    name: Annotated[str, Path(pattern=NAME_PATTERN)], user: CurrentUser, session: Db
) -> Ok[DeletedData]:
    bucket = get_bucket(session, user, name)
    if bucket is None:
        # An invalid name cannot name an existing bucket, so rejecting it
        # discloses nothing. A 403 would confirm the name is taken, which is
        # an existence disclosure the ADR 002 test plan specifically rules
        # out.
        raise ApiError("BUCKET_NOT_FOUND", f"No bucket named {name!r}.", status_code=404)
    if bucket_has_secrets(session, bucket):
        raise ApiError(
            "BUCKET_NOT_EMPTY",
            f"Bucket {name!r} still holds secrets. Delete them first.",
            status_code=409,
        )
    session.delete(bucket)
    record_audit(session, user_id=user.id, action=BUCKET_DELETED, bucket_name=name)
    session.commit()
    return Ok(data=DeletedData(deleted=True))
