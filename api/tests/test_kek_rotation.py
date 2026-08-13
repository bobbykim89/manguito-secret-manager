import base64
import uuid
from collections.abc import Iterator

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.config import Settings
from app.crypto.keys import EnvKeyProvider, KeyProvider, build_key_provider, wrap_aad
from app.kek_rotation import RotationResult, run_rotation
from app.models import Bucket, User


@pytest.fixture(autouse=True)
def _no_other_buckets(db_session: Session) -> Iterator[None]:
    """Give run_rotation's global, unscoped query a table it actually owns.

    Every other test file in this suite tolerates the shared Postgres never
    being truncated by scoping its own assertions to rows it created (see
    test_secrets_authz.py's comment on the same fixture). That convention
    does not work here: run_rotation's counts are deliberately global, by
    design, so a bucket left behind by an earlier test or an earlier file
    inflates already_current or gets rotated as a side effect. Clearing the
    table before each test, rather than scoping the query, is the only fix
    that leaves run_rotation's real signature and RotationResult's counting
    semantics untouched.
    """
    db_session.execute(delete(Bucket))
    db_session.commit()
    yield


def two_version_settings() -> Settings:
    """A Settings carrying both an old and a new KEK, version 1 and 2.

    Every field is passed explicitly and the dotenv source is disabled, the
    same reasoning test_auth_cookies.py's settings_for() gives: reading
    ../.env would let a developer's local file silently change which KEKs
    this test exercises.
    """
    old_kek = base64.b64encode(bytes(range(32))).decode()
    new_kek = base64.b64encode(bytes(range(1, 33))).decode()
    return Settings(
        _env_file=None,
        database_url="postgresql+psycopg://u:p@localhost:5433/db",
        cors_origins="",
        environment="test",
        google_client_id="id",
        google_client_secret="secret",
        google_redirect_uri="http://testserver/cb",
        app_url="http://testserver",
        session_cookie_domain="",
        secrets_keks=f"1:{old_kek},2:{new_kek}",
        secrets_kek_version=2,
    )


def make_bucket(session: Session, provider: KeyProvider, user: User, name: str) -> Bucket:
    """A bucket wrapped under whichever version provider.current_version names.

    Mirrors create_bucket in app/buckets.py, without the audit and commit
    concerns that function has: this test file wants a bucket already on
    disk, not the create endpoint's side effects.
    """
    from app.crypto.keys import generate_dek

    bucket_id = uuid.uuid4()
    bucket = Bucket(
        id=bucket_id,
        user_id=user.id,
        name=name,
        wrapped_dek=provider.wrap(generate_dek(), wrap_aad(bucket_id)),
        kek_version=provider.current_version,
    )
    session.add(bucket)
    session.flush()
    return bucket


def a_user(session: Session, sub: str) -> User:
    user = User(google_sub=sub, email=f"{sub}@example.com", name="Test")
    session.add(user)
    session.flush()
    return user


def test_rotates_a_bucket_on_the_old_version(db_session: Session) -> None:
    settings = two_version_settings()
    provider = build_key_provider(settings)
    # Wrapped under version 1 specifically, not whatever is current, so the
    # rotation actually has something to do.
    old_provider = EnvKeyProvider(provider._keks, current_version=1)  # type: ignore[attr-defined]
    user = a_user(db_session, "rotate-basic")
    bucket = make_bucket(db_session, old_provider, user, "rotate-basic")
    db_session.commit()

    result = run_rotation(db_session, provider, dry_run=False)

    assert result == RotationResult(rotated=1, already_current=0)
    db_session.refresh(bucket)
    assert bucket.kek_version == 2


def test_skips_a_bucket_already_on_the_current_version(db_session: Session) -> None:
    settings = two_version_settings()
    provider = build_key_provider(settings)
    user = a_user(db_session, "rotate-current")
    make_bucket(db_session, provider, user, "rotate-current")
    db_session.commit()

    result = run_rotation(db_session, provider, dry_run=False)

    assert result == RotationResult(rotated=0, already_current=1)


def test_dry_run_touches_no_row(db_session: Session) -> None:
    settings = two_version_settings()
    provider = build_key_provider(settings)
    old_provider = EnvKeyProvider(provider._keks, current_version=1)  # type: ignore[attr-defined]
    user = a_user(db_session, "rotate-dry")
    bucket = make_bucket(db_session, old_provider, user, "rotate-dry")
    before = bucket.wrapped_dek
    db_session.commit()

    result = run_rotation(db_session, provider, dry_run=True)

    assert result == RotationResult(rotated=1, already_current=0)
    db_session.refresh(bucket)
    assert bucket.kek_version == 1
    assert bucket.wrapped_dek == before


def test_running_twice_rotates_nothing_the_second_time(db_session: Session) -> None:
    settings = two_version_settings()
    provider = build_key_provider(settings)
    old_provider = EnvKeyProvider(provider._keks, current_version=1)  # type: ignore[attr-defined]
    user = a_user(db_session, "rotate-idempotent")
    make_bucket(db_session, old_provider, user, "rotate-idempotent")
    db_session.commit()

    first = run_rotation(db_session, provider, dry_run=False)
    second = run_rotation(db_session, provider, dry_run=False)

    assert first == RotationResult(rotated=1, already_current=0)
    assert second == RotationResult(rotated=0, already_current=1)


def test_an_unwrap_failure_aborts_rather_than_skipping(db_session: Session) -> None:
    """A bucket naming a KEK version this deployment does not hold.

    Simulates the failure by pointing the provider at a settings object
    where secrets_keks never had version 1, the version the stored bucket
    still names. run_rotation must raise rather than continue past it.
    """
    from app.crypto.keys import UnknownKekVersion

    settings = two_version_settings()
    full_provider = build_key_provider(settings)
    old_provider = EnvKeyProvider(full_provider._keks, current_version=1)  # type: ignore[attr-defined]
    user = a_user(db_session, "rotate-broken")
    make_bucket(db_session, old_provider, user, "rotate-broken")
    db_session.commit()

    # A provider that only knows version 2. Version 1, which the bucket
    # above is wrapped under, is unconfigured from this provider's view.
    new_kek = base64.b64encode(bytes(range(1, 33))).decode()
    partial_settings = Settings(
        _env_file=None,
        database_url=settings.database_url,
        cors_origins="",
        environment="test",
        google_client_id="id",
        google_client_secret="secret",
        google_redirect_uri="http://testserver/cb",
        app_url="http://testserver",
        session_cookie_domain="",
        secrets_keks=f"2:{new_kek}",
        secrets_kek_version=2,
    )
    partial_provider = build_key_provider(partial_settings)

    with pytest.raises(UnknownKekVersion):
        run_rotation(db_session, partial_provider, dry_run=False)


def test_a_secret_reads_back_unchanged_after_rotation(db_session: Session) -> None:
    """The property ADR 002's test plan names: rewrap does not touch the value.

    Goes through the same functions the API's own read path uses, not just
    the DEK, so this proves the rewrap is transparent through the whole
    encryption tier rather than that a DEK round trips in isolation.
    """
    from app.secrets_service import put_secret, read_secret

    settings = two_version_settings()
    provider = build_key_provider(settings)
    old_provider = EnvKeyProvider(provider._keks, current_version=1)  # type: ignore[attr-defined]
    user = a_user(db_session, "rotate-secret")
    bucket = make_bucket(db_session, old_provider, user, "rotate-secret")
    secret, _created = put_secret(db_session, old_provider, bucket, "DATABASE_URL", "postgres://x")
    db_session.commit()

    run_rotation(db_session, provider, dry_run=False)
    db_session.commit()

    db_session.refresh(bucket)
    db_session.refresh(secret)
    assert read_secret(provider, bucket, secret) == "postgres://x"
