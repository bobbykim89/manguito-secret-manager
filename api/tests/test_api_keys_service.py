from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.api_keys import (
    LOOKUP_ID_CHARS,
    PREFIX,
    create_key,
    generate_token,
    get_key,
    hash_token,
    list_keys_with_buckets,
    parse_token,
    revoke_key,
    touch_key,
    verify_token,
)
from app.buckets import create_bucket
from app.crypto.keys import EnvKeyProvider
from app.models import ApiKey, User

KEK_1 = bytes(range(32))


def provider() -> EnvKeyProvider:
    return EnvKeyProvider({1: KEK_1}, 1)


def seed_user(session: Session, sub: str) -> User:
    user = User(google_sub=sub, email=f"{sub}@example.com", name="Test")
    session.add(user)
    session.flush()
    return user


def test_a_token_has_the_documented_shape() -> None:
    token, lookup_id = generate_token()

    assert token.startswith(PREFIX)
    assert len(lookup_id) == LOOKUP_ID_CHARS
    assert token == f"{PREFIX}{lookup_id}_{token.split('_', 2)[2]}"
    # 32 random bytes, base64url, is 43 characters.
    assert len(token.split("_", 2)[2]) == 43


def test_tokens_do_not_repeat() -> None:
    first, first_id = generate_token()
    second, second_id = generate_token()

    assert first != second
    assert first_id != second_id


def test_the_lookup_id_contains_no_underscore() -> None:
    """Otherwise parsing the token at its first underscore would split it in
    the wrong place, and a token would fail to verify for a reason nothing
    in the code says out loud."""
    for _ in range(50):
        _, lookup_id = generate_token()
        assert "_" not in lookup_id


@pytest.mark.parametrize(
    ("label", "token"),
    [
        ("empty", ""),
        ("no prefix", "abc_deadbeef_secret"),
        ("prefix only", "msm_"),
        ("no secret", "msm_deadbeef_"),
        ("no separator", "msm_deadbeefsecret"),
        ("short id", "msm_dead_secret"),
        ("long id", "msm_deadbeefcafe_secret"),
    ],
)
def test_a_malformed_token_parses_to_nothing(label: str, token: str) -> None:
    assert parse_token(token) is None


def test_a_wellformed_token_parses_to_its_lookup_id() -> None:
    token, lookup_id = generate_token()

    assert parse_token(token) == lookup_id


def test_a_secret_containing_an_underscore_still_parses() -> None:
    """token_urlsafe emits underscores, so parsing must split once at the
    first separator rather than on every one."""
    assert parse_token("msm_deadbeef_aa_bb_cc") == "deadbeef"


def test_the_hash_covers_the_whole_token() -> None:
    """Not the secret segment alone.

    Two tokens sharing a secret but differing in lookup id must hash
    differently. An implementation that hashed only the secret would return
    the same digest for both, every time, rather than sometimes, which is
    what makes this a usable regression guard.
    """
    _, first_id = generate_token()
    second_id = first_id
    while second_id == first_id:
        _, second_id = generate_token()
    secret = generate_token()[0].split("_", 2)[2]

    assert hash_token(f"{PREFIX}{first_id}_{secret}") != hash_token(f"{PREFIX}{second_id}_{secret}")
    assert len(hash_token(f"{PREFIX}{first_id}_{secret}")) == 32


def test_verification_resolves_only_the_key_its_lookup_id_names(
    db_session: Session,
) -> None:
    """A valid secret under someone else's lookup id resolves to nothing.

    The refusal comes from the lookup rather than from the hash: the row is
    fetched by the id inside the presented token and compared only against
    that row, so a secret belonging to a different key cannot match. This
    would go red if verification were ever changed to search for a matching
    hash instead of resolving one row, which would let a valid secret
    authenticate as whichever key it really belongs to while the caller
    named another.

    It is deliberately not the guard for whole-token hashing.
    test_the_hash_covers_the_whole_token is, and this test passes under a
    secret-only hash, which is how we know the two are testing different
    things.
    """
    user = seed_user(db_session, "key-forge")
    bucket = create_bucket(db_session, provider(), user, "forging")
    victim, _ = create_key(
        db_session,
        user,
        name="victim",
        buckets=[bucket],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    _, attacker_token = create_key(
        db_session,
        user,
        name="attacker",
        buckets=[bucket],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    db_session.commit()

    forged = f"{PREFIX}{victim.lookup_id}_{attacker_token.split('_', 2)[2]}"

    assert verify_token(db_session, forged) is None


def test_a_created_key_verifies(db_session: Session) -> None:
    user = seed_user(db_session, "key-verify")
    bucket = create_bucket(db_session, provider(), user, "prod")
    key, token = create_key(
        db_session,
        user,
        name="ci",
        buckets=[bucket],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    db_session.commit()

    verified = verify_token(db_session, token)

    assert verified is not None
    assert verified.id == key.id


def test_the_plaintext_is_never_stored(db_session: Session) -> None:
    user = seed_user(db_session, "key-not-stored")
    bucket = create_bucket(db_session, provider(), user, "notstored")
    key, token = create_key(
        db_session,
        user,
        name="ci",
        buckets=[bucket],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    db_session.commit()

    assert key.token_hash != token.encode()
    assert token not in repr(key)
    assert key.token_hash.hex() not in repr(key)


@pytest.mark.parametrize("label", ["unknown", "wrong secret", "revoked", "expired"])
def test_every_verification_failure_returns_none(db_session: Session, label: str) -> None:
    """One return value for every failure, so the caller cannot accidentally
    tell them apart in its response."""
    user = seed_user(db_session, f"key-fail-{label.replace(' ', '-')}")
    bucket = create_bucket(db_session, provider(), user, f"fail{label.replace(' ', '')}")
    key, token = create_key(
        db_session,
        user,
        name="ci",
        buckets=[bucket],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    db_session.commit()

    if label == "unknown":
        presented = generate_token()[0]
    elif label == "wrong secret":
        presented = f"{PREFIX}{key.lookup_id}_{generate_token()[0].split('_', 2)[2]}"
    else:
        presented = token
        if label == "revoked":
            key.revoked_at = datetime.now(UTC)
        else:
            key.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db_session.commit()

    assert verify_token(db_session, presented) is None


def test_a_key_expiring_in_the_future_still_verifies(db_session: Session) -> None:
    user = seed_user(db_session, "key-future")
    bucket = create_bucket(db_session, provider(), user, "future")
    key, token = create_key(
        db_session,
        user,
        name="ci",
        buckets=[bucket],
        can_write=False,
        can_reveal=False,
        expires_at=datetime.now(UTC) + timedelta(days=1),
    )
    db_session.commit()

    assert verify_token(db_session, token) is not None


def test_create_records_the_scope(db_session: Session) -> None:
    user = seed_user(db_session, "key-scope")
    one = create_bucket(db_session, provider(), user, "scopeone")
    two = create_bucket(db_session, provider(), user, "scopetwo")
    key, _ = create_key(
        db_session,
        user,
        name="ci",
        buckets=[one, two],
        can_write=True,
        can_reveal=True,
        expires_at=None,
    )
    db_session.commit()

    assert {row.bucket_id for row in key.buckets} == {one.id, two.id}
    assert key.can_write is True
    assert key.can_reveal is True


def test_deleting_a_bucket_prunes_only_its_scope_row(db_session: Session) -> None:
    """The key survives and keeps working on its other buckets.

    Deleting a bucket is a decision about the bucket, not about every
    credential that ever mentioned it. See ADR 002 A25.
    """
    user = seed_user(db_session, "key-prune")
    doomed = create_bucket(db_session, provider(), user, "doomed")
    surviving = create_bucket(db_session, provider(), user, "surviving")
    key, token = create_key(
        db_session,
        user,
        name="ci",
        buckets=[doomed, surviving],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    db_session.commit()

    db_session.delete(doomed)
    db_session.commit()
    db_session.expire(key)

    assert {row.bucket_id for row in key.buckets} == {surviving.id}
    assert verify_token(db_session, token) is not None


def test_get_key_is_scoped_to_its_owner(db_session: Session) -> None:
    mine = seed_user(db_session, "key-owner-mine")
    theirs = seed_user(db_session, "key-owner-theirs")
    bucket = create_bucket(db_session, provider(), theirs, "theirbucket")
    key, _ = create_key(
        db_session,
        theirs,
        name="ci",
        buckets=[bucket],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    db_session.commit()

    assert get_key(db_session, theirs, key.id) is not None
    assert get_key(db_session, mine, key.id) is None


def test_list_returns_only_your_keys_with_their_bucket_names(db_session: Session) -> None:
    mine = seed_user(db_session, "key-list-mine")
    theirs = seed_user(db_session, "key-list-theirs")
    one = create_bucket(db_session, provider(), mine, "listone")
    two = create_bucket(db_session, provider(), mine, "listtwo")
    hidden = create_bucket(db_session, provider(), theirs, "listhidden")
    create_key(
        db_session,
        mine,
        name="ci",
        buckets=[two, one],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    create_key(
        db_session,
        theirs,
        name="theirs",
        buckets=[hidden],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    db_session.commit()

    rows = list_keys_with_buckets(db_session, mine)

    assert [(key.name, names) for key, names in rows] == [("ci", ["listone", "listtwo"])]


def test_a_key_whose_buckets_were_all_deleted_lists_with_none(db_session: Session) -> None:
    """It still exists and must still be visible, or you cannot revoke it."""
    user = seed_user(db_session, "key-list-orphan")
    bucket = create_bucket(db_session, provider(), user, "orphaned")
    create_key(
        db_session,
        user,
        name="orphan",
        buckets=[bucket],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    db_session.commit()
    db_session.delete(bucket)
    db_session.commit()

    rows = list_keys_with_buckets(db_session, user)

    assert [(key.name, names) for key, names in rows] == [("orphan", [])]


def test_revoking_twice_keeps_the_first_timestamp(db_session: Session) -> None:
    """The moment a credential stopped being trusted is the fact worth
    preserving."""
    user = seed_user(db_session, "key-revoke")
    bucket = create_bucket(db_session, provider(), user, "revoking")
    key, _ = create_key(
        db_session,
        user,
        name="ci",
        buckets=[bucket],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    db_session.commit()

    assert revoke_key(key) is True
    first = key.revoked_at
    db_session.commit()

    assert revoke_key(key) is False
    assert key.revoked_at == first


def test_touch_key_commits_on_its_own(db_session: Session) -> None:
    """A request that authenticates and then fails still records the use.

    That is what matters when reviewing a suspected leak, so the timestamp
    must not ride on the endpoint's transaction.
    """
    user = seed_user(db_session, "key-touch")
    bucket = create_bucket(db_session, provider(), user, "touching")
    key, _ = create_key(
        db_session,
        user,
        name="ci",
        buckets=[bucket],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    db_session.commit()
    assert key.last_used_at is None

    touch_key(db_session, key)
    db_session.rollback()

    reloaded = db_session.get(ApiKey, key.id)
    assert reloaded is not None
    assert reloaded.last_used_at is not None
