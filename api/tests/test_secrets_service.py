import logging

import pytest
from cryptography.exceptions import InvalidTag
from sqlalchemy.orm import Session

from app.buckets import create_bucket
from app.crypto.aead import NONCE_BYTES
from app.crypto.keys import EnvKeyProvider
from app.models import User
from app.models.secret import MAX_VALUE_BYTES
from app.secrets_service import (
    SecretTooLargeError,
    encode_value,
    get_secret,
    list_secrets,
    put_secret,
    read_secret,
)

KEK_1 = bytes(range(32))


def provider() -> EnvKeyProvider:
    return EnvKeyProvider({1: KEK_1}, 1)


def seed_user(session: Session, sub: str) -> User:
    user = User(google_sub=sub, email=f"{sub}@example.com", name="Test")
    session.add(user)
    session.flush()
    return user


# Paired rather than hashed. google_sub is unique and the database is session
# scoped and never rolled back, so a collision would surface as a raw
# IntegrityError far from the failing assertion.
ROUND_TRIP_CASES = [
    ("plain", "plain"),
    ("empty", ""),
    ("unicode", "unicode é中\U0001f600"),
    ("newline", "line\nbreak"),
    ("spaces", " leading and trailing "),
]


@pytest.mark.parametrize(("label", "value"), ROUND_TRIP_CASES)
def test_a_value_round_trips_exactly(db_session: Session, label: str, value: str) -> None:
    user = seed_user(db_session, f"svc-round-{label}")
    bucket = create_bucket(db_session, provider(), user, "round")

    secret, created = put_secret(db_session, provider(), bucket, "KEY", value)
    db_session.commit()

    assert created is True
    assert read_secret(provider(), bucket, secret) == value


def test_a_64_kib_value_is_accepted(db_session: Session) -> None:
    user = seed_user(db_session, "svc-max")
    bucket = create_bucket(db_session, provider(), user, "max")
    value = "a" * MAX_VALUE_BYTES

    secret, _ = put_secret(db_session, provider(), bucket, "BIG", value)
    db_session.commit()

    assert read_secret(provider(), bucket, secret) == value


def test_one_byte_over_the_limit_is_rejected() -> None:
    with pytest.raises(SecretTooLargeError):
        encode_value("a" * (MAX_VALUE_BYTES + 1))


def test_the_limit_counts_bytes_and_not_characters() -> None:
    """A multi-byte string under the character count is still over the limit.

    This is the case a Pydantic max_length would wave through, since it
    counts characters.
    """
    value = "é" * (MAX_VALUE_BYTES // 2 + 1)

    assert len(value) < MAX_VALUE_BYTES
    with pytest.raises(SecretTooLargeError):
        encode_value(value)


def test_writing_the_same_key_twice_updates_rather_than_duplicates(
    db_session: Session,
) -> None:
    user = seed_user(db_session, "svc-update")
    bucket = create_bucket(db_session, provider(), user, "update")
    put_secret(db_session, provider(), bucket, "KEY", "first")
    db_session.commit()

    secret, created = put_secret(db_session, provider(), bucket, "KEY", "second")
    db_session.commit()

    assert created is False
    assert read_secret(provider(), bucket, secret) == "second"
    assert [row.key_name for row in list_secrets(db_session, bucket)] == ["KEY"]


def test_the_same_value_encrypts_differently_each_time(db_session: Session) -> None:
    """Same key name, so the AAD is identical and only the nonce can differ.

    Two different key names would not prove this. In GCM the tag depends on
    the AAD, so a reused nonce would still yield a different blob and the
    assertion would pass while proving nothing.
    """
    user = seed_user(db_session, "svc-nonce")
    bucket = create_bucket(db_session, provider(), user, "nonce")
    first, _ = put_secret(db_session, provider(), bucket, "SAME", "same")
    db_session.commit()
    before = first.ciphertext

    second, _ = put_secret(db_session, provider(), bucket, "SAME", "same")
    db_session.commit()

    assert second.ciphertext != before
    assert second.ciphertext[:NONCE_BYTES] != before[:NONCE_BYTES]


def test_a_ciphertext_does_not_decrypt_under_another_key_name(db_session: Session) -> None:
    """Relocation within one bucket, which shares a DEK, so only the AAD stops it."""
    user = seed_user(db_session, "svc-relocate-key")
    bucket = create_bucket(db_session, provider(), user, "relocatekey")
    first, _ = put_secret(db_session, provider(), bucket, "ALPHA", "one")
    second, _ = put_secret(db_session, provider(), bucket, "BETA", "two")
    db_session.commit()

    first.ciphertext, second.ciphertext = second.ciphertext, first.ciphertext

    with pytest.raises(InvalidTag):
        read_secret(provider(), bucket, first)
    with pytest.raises(InvalidTag):
        read_secret(provider(), bucket, second)


def test_a_ciphertext_does_not_decrypt_in_another_bucket(db_session: Session) -> None:
    """Relocation across buckets fails twice over: wrong AAD and wrong DEK."""
    user = seed_user(db_session, "svc-relocate-bucket")
    left = create_bucket(db_session, provider(), user, "leftbucket")
    right = create_bucket(db_session, provider(), user, "rightbucket")
    mine, _ = put_secret(db_session, provider(), left, "KEY", "mine")
    theirs, _ = put_secret(db_session, provider(), right, "KEY", "theirs")
    db_session.commit()

    mine.ciphertext = theirs.ciphertext

    with pytest.raises(InvalidTag):
        read_secret(provider(), left, mine)


def test_get_secret_is_scoped_to_its_bucket(db_session: Session) -> None:
    user = seed_user(db_session, "svc-scope")
    left = create_bucket(db_session, provider(), user, "scopeleft")
    right = create_bucket(db_session, provider(), user, "scoperight")
    put_secret(db_session, provider(), left, "ONLY_IN_LEFT", "x")
    db_session.commit()

    assert get_secret(db_session, left, "ONLY_IN_LEFT") is not None
    assert get_secret(db_session, right, "ONLY_IN_LEFT") is None


def test_list_secrets_is_ordered_by_key_name(db_session: Session) -> None:
    user = seed_user(db_session, "svc-order")
    bucket = create_bucket(db_session, provider(), user, "order")
    put_secret(db_session, provider(), bucket, "ZULU", "z")
    put_secret(db_session, provider(), bucket, "ALPHA", "a")
    db_session.commit()

    assert [row.key_name for row in list_secrets(db_session, bucket)] == ["ALPHA", "ZULU"]


def test_a_failed_decrypt_logs_the_row_but_never_the_value(
    db_session: Session, caplog: pytest.LogCaptureFixture
) -> None:
    """Invariant 1 on the one path that handles plaintext.

    The operator needs to know which row failed. They must not learn what it
    contained, and the ciphertext has no business in a log either.
    """
    user = seed_user(db_session, "svc-corrupt")
    bucket = create_bucket(db_session, provider(), user, "corrupt")
    secret, _ = put_secret(db_session, provider(), bucket, "CORRUPTED", "the-real-value")
    db_session.commit()
    tampered = bytearray(secret.ciphertext)
    tampered[-1] ^= 0xFF
    secret.ciphertext = bytes(tampered)

    with caplog.at_level(logging.ERROR, logger="app.secrets_service"), pytest.raises(InvalidTag):
        read_secret(provider(), bucket, secret)

    output = caplog.text
    assert "CORRUPTED" in output
    assert str(bucket.id) in output
    assert "the-real-value" not in output
    assert secret.ciphertext.hex() not in output


def test_an_unknown_kek_version_is_logged_as_its_own_cause(
    db_session: Session, caplog: pytest.LogCaptureFixture
) -> None:
    """A dropped KEK and a tampered row are one 500 to the caller.

    They are not the same thing to whoever has to fix it: one is a
    configuration mistake that restoring the key undoes, the other is an
    incident.
    """
    from app.crypto.keys import UnknownKekVersion

    user = seed_user(db_session, "svc-unknown-kek")
    bucket = create_bucket(db_session, provider(), user, "unknownkek")
    secret, _ = put_secret(db_session, provider(), bucket, "KEY", "the-real-value")
    db_session.commit()
    bucket.kek_version = 99

    with (
        caplog.at_level(logging.ERROR, logger="app.secrets_service"),
        pytest.raises(UnknownKekVersion),
    ):
        read_secret(provider(), bucket, secret)

    assert "99" in caplog.text
    assert "the-real-value" not in caplog.text
