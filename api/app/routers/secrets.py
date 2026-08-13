from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.audit import (
    REVEAL_DENIED,
    SECRET_CREATED,
    SECRET_DELETED,
    SECRET_READ,
    SECRET_UPDATED,
    record_audit,
)
from app.auth.caller import CurrentCaller
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


def deny_reveal(
    bucket: Annotated[str, Path(pattern=NAME_PATTERN)],
    caller: CurrentCaller,
    session: Db,
    reveal: bool = False,
) -> None:
    """Refuse bulk reveal on the credential, before any bucket is consulted.

    ADR 002 A4 makes reveal a property of the credential rather than of the
    endpoint, so this is decided without touching a bucket the caller may
    have no business knowing about. A session always fails it, whatever the
    user owns, which ADR 003 requires.

    Declared as a typed boolean rather than read from the query string, so a
    value that is neither true nor false is a 422 rather than a quiet falsy.
    """
    if not reveal or caller.may_reveal():
        return
    record_audit(
        session,
        user_id=caller.user.id,
        api_key_id=caller.api_key_id,
        action=REVEAL_DENIED,
        bucket_name=bucket,
    )
    session.commit()
    raise ApiError(
        "REVEAL_NOT_PERMITTED",
        "Bulk reveal requires an API key with the reveal scope.",
        status_code=403,
    )


def resolve_bucket(
    bucket: Annotated[str, Path(pattern=NAME_PATTERN)],
    caller: CurrentCaller,
    session: Db,
) -> Bucket:
    """The one place ownership and scope are checked for all four endpoints.

    get_bucket filters on user_id, so another user's bucket is
    indistinguishable from one that does not exist. A bucket the caller owns
    but the key was not scoped to gets the identical answer, so a leaked key
    probing names learns nothing. See ADR 002 A26.
    """
    found = get_bucket(session, caller.user, bucket)
    if found is None or not caller.may_access(found):
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
    response_model=Ok[list[SecretData]] | Ok[dict[str, str]],
    dependencies=[Depends(deny_reveal)],
    responses={
        401: {"model": Err},
        403: {"model": Err},
        404: {"model": Err},
        422: {"model": Err},
    },
)
def list_endpoint(
    bucket: ResolvedBucket,
    caller: CurrentCaller,
    session: Db,
    provider: Provider,
    # Declared again here rather than taken from deny_reveal's return,
    # because deny_reveal is a route level dependency, which is what makes
    # it resolve before ResolvedBucket. Both read the same query parameter.
    reveal: bool = False,
) -> Ok[list[SecretData]] | Ok[dict[str, str]]:
    secrets_in_bucket = list_secrets(session, bucket)
    if not reveal:
        # Deliberately not audited. Only a read of a value is a read, and
        # auditing every page load would bury the entries that matter.
        return Ok(data=[_to_data(secret) for secret in secrets_in_bucket])

    if reveal and not caller.may_reveal():
        # Belt and braces. deny_reveal already refused this as a route level
        # dependency, and that is what makes the refusal precede the bucket
        # lookup. This is here so the decision is also in the body, because a
        # decorator argument is the thing someone removes while refactoring.
        raise ApiError(
            "REVEAL_NOT_PERMITTED",
            "Bulk reveal requires an API key with the reveal scope.",
            status_code=403,
        )

    # Decrypt everything before auditing anything, so a bucket with one
    # unreadable row records no reads at all rather than a partial trail.
    values = {
        secret.key_name: read_secret(provider, bucket, secret) for secret in secrets_in_bucket
    }
    for key_name in values:
        record_audit(
            session,
            user_id=caller.user.id,
            api_key_id=caller.api_key_id,
            action=SECRET_READ,
            bucket_name=bucket.name,
            key_name=key_name,
        )
    session.commit()
    return Ok(data=values)


@router.get(
    "/{key}",
    response_model=Ok[SecretValueData],
    responses={401: {"model": Err}, 404: {"model": Err}, 422: {"model": Err}},
)
def get_endpoint(
    key: KeyName,
    bucket: ResolvedBucket,
    caller: CurrentCaller,
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
        session,
        user_id=caller.user.id,
        action=SECRET_READ,
        bucket_name=bucket.name,
        key_name=key,
        api_key_id=caller.api_key_id,
    )
    # Built before the commit: expire_on_commit would force a refresh SELECT
    # to read created_at/updated_at afterwards, and a failure on that refresh
    # would report a 500 for a read that already committed its audit row.
    data = SecretValueData(
        key_name=secret.key_name,
        created_at=secret.created_at,
        updated_at=secret.updated_at,
        value=value,
    )
    session.commit()
    return Ok(data=data)


@router.put(
    "/{key}",
    response_model=Ok[SecretData],
    responses={
        201: {"model": Ok[SecretData]},
        401: {"model": Err},
        403: {"model": Err},
        404: {"model": Err},
        422: {"model": Err},
    },
)
def put_endpoint(
    key: KeyName,
    body: PutSecretRequest,
    bucket: ResolvedBucket,
    caller: CurrentCaller,
    session: Db,
    provider: Provider,
    response: Response,
) -> Ok[SecretData]:
    if not caller.may_write():
        raise ApiError(
            "WRITE_NOT_PERMITTED",
            "This API key may not write secrets.",
            status_code=403,
        )
    try:
        secret, created = put_secret(session, provider, bucket, key, body.value)
    except SecretTooLargeError as error:
        # The request model's max_length counts characters, so a multi-byte
        # value under that count still reaches the service's byte check.
        # Reporting it as anything but a validation failure would be wrong.
        raise ApiError("VALIDATION_ERROR", str(error), status_code=422) from None
    record_audit(
        session,
        user_id=caller.user.id,
        action=SECRET_CREATED if created else SECRET_UPDATED,
        bucket_name=bucket.name,
        key_name=key,
        api_key_id=caller.api_key_id,
    )
    # Built before the commit, for the same reason as get_endpoint: reading
    # these after expire_on_commit refreshes them in a fresh transaction the
    # response has no business needing.
    data = _to_data(secret)
    session.commit()
    response.status_code = 201 if created else 200
    return Ok(data=data)


@router.delete(
    "/{key}",
    response_model=Ok[SecretData],
    responses={401: {"model": Err}, 403: {"model": Err}, 404: {"model": Err}, 422: {"model": Err}},
)
def delete_endpoint(
    key: KeyName, bucket: ResolvedBucket, caller: CurrentCaller, session: Db
) -> Ok[SecretData]:
    if not caller.may_write():
        raise ApiError(
            "WRITE_NOT_PERMITTED",
            "This API key may not write secrets.",
            status_code=403,
        )
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
        session,
        user_id=caller.user.id,
        action=SECRET_DELETED,
        bucket_name=bucket.name,
        key_name=key,
        api_key_id=caller.api_key_id,
    )
    session.commit()
    return Ok(data=data)
