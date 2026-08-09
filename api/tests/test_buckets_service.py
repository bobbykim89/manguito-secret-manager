import pytest
from cryptography.exceptions import InvalidTag
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.buckets import (
    bucket_has_secrets,
    create_bucket,
    get_bucket,
    list_buckets_with_counts,
    unwrap_dek,
)
from app.crypto.keys import DEK_BYTES, EnvKeyProvider
from app.models import User
from app.secrets_service import put_secret

KEK_1 = bytes(range(32))
KEK_2 = bytes(range(32, 64))


def provider(current: int = 1) -> EnvKeyProvider:
    return EnvKeyProvider({1: KEK_1, 2: KEK_2}, current)


def seed_user(session: Session, sub: str) -> User:
    user = User(google_sub=sub, email=f"{sub}@example.com", name="Test")
    session.add(user)
    session.flush()
    return user


def test_create_stores_a_dek_that_unwraps(db_session: Session) -> None:
    user = seed_user(db_session, "svc-create")

    bucket = create_bucket(db_session, provider(), user, "prod")
    db_session.commit()

    assert bucket.kek_version == 1
    assert bucket.wrapped_dek != b""
    assert len(unwrap_dek(provider(), bucket)) == DEK_BYTES


def test_each_bucket_gets_its_own_dek(db_session: Session) -> None:
    user = seed_user(db_session, "svc-distinct")

    first = create_bucket(db_session, provider(), user, "one")
    second = create_bucket(db_session, provider(), user, "two")
    db_session.commit()

    assert first.wrapped_dek != second.wrapped_dek
    assert unwrap_dek(provider(), first) != unwrap_dek(provider(), second)


def test_a_dek_does_not_unwrap_under_another_buckets_identity(db_session: Session) -> None:
    """Row binding at the key tier, proven against real rows.

    Swapping the two wrapped values is what an attacker with database write
    access would try. Both must fail rather than silently succeed.
    """
    user = seed_user(db_session, "svc-swap")
    first = create_bucket(db_session, provider(), user, "alpha")
    second = create_bucket(db_session, provider(), user, "beta")
    db_session.commit()

    first.wrapped_dek, second.wrapped_dek = second.wrapped_dek, first.wrapped_dek

    with pytest.raises(InvalidTag):
        unwrap_dek(provider(), first)
    with pytest.raises(InvalidTag):
        unwrap_dek(provider(), second)


def test_create_records_the_current_kek_version(db_session: Session) -> None:
    user = seed_user(db_session, "svc-version")

    bucket = create_bucket(db_session, provider(current=2), user, "rotated")
    db_session.commit()

    assert bucket.kek_version == 2
    assert len(unwrap_dek(provider(current=1), bucket)) == DEK_BYTES


def test_a_duplicate_name_for_one_user_violates_the_constraint(db_session: Session) -> None:
    user = seed_user(db_session, "svc-dupe")
    create_bucket(db_session, provider(), user, "same")
    db_session.commit()

    with pytest.raises(IntegrityError):
        create_bucket(db_session, provider(), user, "same")
        db_session.commit()
    db_session.rollback()


def test_two_users_can_own_the_same_name(db_session: Session) -> None:
    mine = seed_user(db_session, "svc-mine")
    theirs = seed_user(db_session, "svc-theirs")

    create_bucket(db_session, provider(), mine, "prod")
    create_bucket(db_session, provider(), theirs, "prod")
    db_session.commit()

    assert get_bucket(db_session, mine, "prod") is not None
    assert get_bucket(db_session, theirs, "prod") is not None


def test_get_bucket_is_scoped_to_its_owner(db_session: Session) -> None:
    """The single line that makes cross-user access a 404 rather than a 403."""
    mine = seed_user(db_session, "svc-scope-mine")
    theirs = seed_user(db_session, "svc-scope-theirs")
    create_bucket(db_session, provider(), theirs, "private")
    db_session.commit()

    assert get_bucket(db_session, mine, "private") is None
    assert get_bucket(db_session, theirs, "private") is not None


def test_list_with_counts_returns_only_your_buckets_in_name_order(
    db_session: Session,
) -> None:
    mine = seed_user(db_session, "svc-list-mine")
    theirs = seed_user(db_session, "svc-list-theirs")
    create_bucket(db_session, provider(), mine, "zulu")
    create_bucket(db_session, provider(), mine, "alpha")
    create_bucket(db_session, provider(), theirs, "hidden")
    db_session.commit()

    rows = list_buckets_with_counts(db_session, mine)

    assert [bucket.name for bucket, _ in rows] == ["alpha", "zulu"]


def test_an_empty_bucket_counts_zero_rather_than_disappearing(db_session: Session) -> None:
    """An inner join would drop it entirely, which is the classic version of this bug."""
    user = seed_user(db_session, "svc-count-empty")
    bucket = create_bucket(db_session, provider(), user, "empty")
    db_session.commit()

    rows = list_buckets_with_counts(db_session, user)

    assert [(b.name, count) for b, count in rows] == [(bucket.name, 0)]


def test_counts_are_per_bucket_and_not_shared(db_session: Session) -> None:
    user = seed_user(db_session, "svc-count-split")
    one = create_bucket(db_session, provider(), user, "aone")
    two = create_bucket(db_session, provider(), user, "btwo")
    put_secret(db_session, provider(), one, "A", "a")
    put_secret(db_session, provider(), one, "B", "b")
    put_secret(db_session, provider(), two, "C", "c")
    db_session.commit()

    rows = list_buckets_with_counts(db_session, user)

    assert [(b.name, count) for b, count in rows] == [("aone", 2), ("btwo", 1)]


def test_bucket_has_secrets_reports_emptiness(db_session: Session) -> None:
    user = seed_user(db_session, "svc-has-secrets")
    bucket = create_bucket(db_session, provider(), user, "hassecrets")
    db_session.commit()

    assert bucket_has_secrets(db_session, bucket) is False

    put_secret(db_session, provider(), bucket, "KEY", "value")
    db_session.commit()

    assert bucket_has_secrets(db_session, bucket) is True


def test_repr_does_not_leak_the_wrapped_dek(db_session: Session) -> None:
    """Real because Bucket defines __repr__.

    SP2 shipped a version of this assertion against a model with no
    __repr__ override, where it passed without proving anything.
    """
    user = seed_user(db_session, "svc-repr")
    bucket = create_bucket(db_session, provider(), user, "quiet")
    db_session.commit()

    rendered = repr(bucket)

    assert bucket.wrapped_dek.hex() not in rendered
    assert str(bucket.wrapped_dek) not in rendered
    assert "quiet" in rendered
