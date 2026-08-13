import base64
import uuid
from collections.abc import Iterator

import pytest
from sqlalchemy import Engine, delete
from sqlalchemy.orm import Session

from app.config import Settings
from app.crypto.keys import build_key_provider, generate_dek, wrap_aad
from app.kek_rotation import RotationResult
from app.models import Bucket, User
from scripts.rotate_kek import format_dry_run_summary, format_summary


@pytest.fixture(autouse=True)
def _no_other_buckets(db_session: Session) -> Iterator[None]:
    """Give run_rotation's global, unscoped query a table it actually owns.

    Same reasoning as test_kek_rotation.py's fixture of the same name:
    run_rotation counts and rotates across the whole buckets table, and this
    file's smoke test drives that query for real through main(), so a
    bucket left behind by another test in the shared, never-truncated
    Postgres container would make its exact-count assertion flaky.
    """
    db_session.execute(delete(Bucket))
    db_session.commit()
    yield


def test_summary_names_the_target_version_and_that_it_is_safe_to_remove_the_old_key() -> None:
    """Reaching format_summary at all is the proof.

    run_rotation either finishes every bucket in its snapshot or raises, so
    by the time main() has a RotationResult to format, 0 remaining is
    already true. format_summary states it without a further query.
    """
    result = RotationResult(rotated=4812, already_current=0)

    text = format_summary(result, target_version=2)

    assert "Rotated 4812 buckets to version 2." in text
    assert "0 buckets remain on another version." in text
    assert "Safe to remove" in text


def test_dry_run_summary_says_would_rotate() -> None:
    result = RotationResult(rotated=4812, already_current=188)

    text = format_dry_run_summary(result, target_version=2)

    assert "Would rotate 4812 buckets to version 2." in text
    assert "188 already on version 2." in text
    assert "Rotated" not in text


def test_main_runs_end_to_end_against_a_real_database(
    db_session: Session, migrated_engine: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    """Not a unit test of run_rotation, which Task 1 already covers.

    This proves main() itself wires argument parsing, settings, the engine
    and the summary together correctly, the seam Task 1's tests do not
    reach because they call run_rotation directly.
    """
    import os

    from scripts.rotate_kek import main

    user = User(google_sub="cli-smoke", email="cli-smoke@example.com", name="Test")
    db_session.add(user)
    db_session.flush()

    old_kek = base64.b64encode(bytes(range(32))).decode()
    new_kek = base64.b64encode(bytes(range(1, 33))).decode()
    old_settings = Settings(
        _env_file=None,
        database_url=os.environ["DATABASE_URL"],
        cors_origins="",
        environment="test",
        google_client_id="id",
        google_client_secret="secret",
        google_redirect_uri="http://testserver/cb",
        app_url="http://testserver",
        session_cookie_domain="",
        secrets_keks=f"1:{old_kek}",
        secrets_kek_version=1,
    )
    old_provider = build_key_provider(old_settings)
    bucket_id = uuid.uuid4()
    bucket = Bucket(
        id=bucket_id,
        user_id=user.id,
        name="cli-smoke",
        wrapped_dek=old_provider.wrap(generate_dek(), wrap_aad(bucket_id)),
        kek_version=1,
    )
    db_session.add(bucket)
    db_session.commit()

    os.environ["SECRETS_KEKS"] = f"1:{old_kek},2:{new_kek}"
    os.environ["SECRETS_KEK_VERSION"] = "2"
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        main([])
    finally:
        get_settings.cache_clear()
        os.environ["SECRETS_KEKS"] = f"1:{old_kek}"
        os.environ["SECRETS_KEK_VERSION"] = "1"
        get_settings.cache_clear()

    captured = capsys.readouterr()
    assert "Rotated 1 buckets to version 2." in captured.out

    db_session.expire_all()
    refreshed = db_session.get(Bucket, bucket_id)
    assert refreshed is not None
    assert refreshed.kek_version == 2
