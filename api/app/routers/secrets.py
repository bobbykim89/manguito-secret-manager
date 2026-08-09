from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.audit import (
    SECRET_CREATED,
    SECRET_DELETED,
    SECRET_READ,
    SECRET_UPDATED,
    record_audit,
)
from app.auth.dependencies import CurrentUser
from app.buckets import get_bucket
from app.crypto.keys import KeyProvider, get_key_provider
from app.db import get_db
from app.envelope import ApiError, Err, Ok
from app.models import Bucket, Secret
from app.models.bucket import NAME_PATTERN
from app.models.secret import KEY_NAME_PATTERN, MAX_VALUE_BYTES
from app.secrets_service import (
    SecretTooLargeError,
    get_secret,
    list_secrets,
    put_secret,
    read_secret,
)

router = APIRouter(prefix="/v1/buckets/{bucket}/secrets", tags=["secrets"])

Db = Annotated[Session, Depends(get_db)]
Provider = Annotated[KeyProvider, Depends(get_key_provider)]
KeyName = Annotated[str, Path(pattern=KEY_NAME_PATTERN)]


def deny_reveal(reveal: bool = False) -> None:
    """Refuse bulk reveal on the credential, before any bucket is consulted.

    ADR 002 A4 makes reveal a property of the credential rather than of the
    endpoint. A session can never carry the scope, so in SP4 this always
    refuses; SP5's API keys are what will be able to pass it. Refusing here
    rather than after the lookup keeps the refusal independent of a resource
    the caller was never entitled to ask about.

    Declared as a typed boolean rather than read from the query string, so a
    value that is neither true nor false is a 422 rather than a quiet falsy.
    """
    if reveal:
        raise ApiError(
            "REVEAL_NOT_PERMITTED",
            "Bulk reveal requires an API key with the reveal scope.",
            status_code=403,
        )


def resolve_bucket(
    bucket: Annotated[str, Path(pattern=NAME_PATTERN)],
    user: CurrentUser,
    session: Db,
) -> Bucket:
    """The one place ownership is checked for all four endpoints.

    get_bucket filters on user_id, so another user's bucket is
    indistinguishable from one that does not exist and the answer is 404
    rather than 403 without any endpoint repeating the check.
    """
    found = get_bucket(session, user, bucket)
    if found is None:
        raise ApiError("BUCKET_NOT_FOUND", f"No bucket named {bucket!r}.", status_code=404)
    return found


ResolvedBucket = Annotated[Bucket, Depends(resolve_bucket)]


class SecretData(BaseModel):
    """Metadata only.

    No value and no length: a length narrows the search space for a password
    or a token, and invariant 7 says metadata only.
    """

    key_name: str
    created_at: datetime
    updated_at: datetime


class SecretValueData(SecretData):
    value: str


class PutSecretRequest(BaseModel):
    value: str = Field(max_length=MAX_VALUE_BYTES)


def _to_data(secret: Secret) -> SecretData:
    return SecretData(
        key_name=secret.key_name,
        created_at=secret.created_at,
        updated_at=secret.updated_at,
    )


@router.get(
    "",
    response_model=Ok[list[SecretData]],
    dependencies=[Depends(deny_reveal)],
    responses={
        401: {"model": Err},
        403: {"model": Err},
        404: {"model": Err},
        422: {"model": Err},
    },
)
def list_endpoint(bucket: ResolvedBucket, session: Db) -> Ok[list[SecretData]]:
    # Deliberately not audited. Only a read of a value is a read, and
    # auditing every page load would bury the entries that matter.
    return Ok(data=[_to_data(secret) for secret in list_secrets(session, bucket)])


@router.get(
    "/{key}",
    response_model=Ok[SecretValueData],
    responses={401: {"model": Err}, 404: {"model": Err}, 422: {"model": Err}},
)
def get_endpoint(
    key: KeyName,
    bucket: ResolvedBucket,
    user: CurrentUser,
    session: Db,
    provider: Provider,
) -> Ok[SecretValueData]:
    secret = get_secret(session, bucket, key)
    if secret is None:
        raise ApiError(
            "SECRET_NOT_FOUND",
            f"No secret named {key!r} in bucket {bucket.name!r}.",
            status_code=404,
        )
    # Decrypt before auditing, so a failed decrypt is never recorded as a
    # successful read.
    value = read_secret(provider, bucket, secret)
    record_audit(
        session, user_id=user.id, action=SECRET_READ, bucket_name=bucket.name, key_name=key
    )
    session.commit()
    return Ok(
        data=SecretValueData(
            key_name=secret.key_name,
            created_at=secret.created_at,
            updated_at=secret.updated_at,
            value=value,
        )
    )


@router.put(
    "/{key}",
    response_model=Ok[SecretData],
    responses={401: {"model": Err}, 404: {"model": Err}, 422: {"model": Err}},
)
def put_endpoint(
    key: KeyName,
    body: PutSecretRequest,
    bucket: ResolvedBucket,
    user: CurrentUser,
    session: Db,
    provider: Provider,
    response: Response,
) -> Ok[SecretData]:
    try:
        secret, created = put_secret(session, provider, bucket, key, body.value)
    except SecretTooLargeError as error:
        # The request model's max_length counts characters, so a multi-byte
        # value under that count still reaches the service's byte check.
        # Reporting it as anything but a validation failure would be wrong.
        raise ApiError("VALIDATION_ERROR", str(error), status_code=422) from None
    record_audit(
        session,
        user_id=user.id,
        action=SECRET_CREATED if created else SECRET_UPDATED,
        bucket_name=bucket.name,
        key_name=key,
    )
    session.commit()
    response.status_code = 201 if created else 200
    return Ok(data=_to_data(secret))


@router.delete(
    "/{key}",
    response_model=Ok[SecretData],
    responses={401: {"model": Err}, 404: {"model": Err}, 422: {"model": Err}},
)
def delete_endpoint(
    key: KeyName, bucket: ResolvedBucket, user: CurrentUser, session: Db
) -> Ok[SecretData]:
    secret = get_secret(session, bucket, key)
    if secret is None:
        raise ApiError(
            "SECRET_NOT_FOUND",
            f"No secret named {key!r} in bucket {bucket.name!r}.",
            status_code=404,
        )
    data = _to_data(secret)
    session.delete(secret)
    record_audit(
        session, user_id=user.id, action=SECRET_DELETED, bucket_name=bucket.name, key_name=key
    )
    session.commit()
    return Ok(data=data)
