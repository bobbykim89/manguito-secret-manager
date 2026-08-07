import uuid

import pytest
from cryptography.exceptions import InvalidTag

from app.crypto.aead import build_aad
from app.crypto.keys import (
    DEK_BYTES,
    EnvKeyProvider,
    UnknownKekVersion,
    generate_dek,
    wrap_aad,
)

KEK_1 = bytes(range(32))
KEK_2 = bytes(range(32, 64))
BUCKET = uuid.uuid4()


def provider(current: int = 1) -> EnvKeyProvider:
    return EnvKeyProvider({1: KEK_1, 2: KEK_2}, current)


def test_generate_dek_returns_fresh_keys_of_the_right_size() -> None:
    first, second = generate_dek(), generate_dek()

    assert len(first) == DEK_BYTES == 32
    assert first != second


def test_wrap_and_unwrap_roundtrip() -> None:
    dek = generate_dek()
    aad = wrap_aad(BUCKET)

    wrapped = provider().wrap(dek, aad)

    assert wrapped != dek
    assert provider().unwrap(wrapped, 1, aad) == dek


def test_wrapping_uses_the_current_version_only() -> None:
    dek = generate_dek()
    aad = wrap_aad(BUCKET)

    wrapped = provider(current=2).wrap(dek, aad)

    assert provider().unwrap(wrapped, 2, aad) == dek
    with pytest.raises(InvalidTag):
        provider().unwrap(wrapped, 1, aad)


def test_a_dek_does_not_unwrap_under_another_buckets_aad() -> None:
    """The A2 binding applied one tier up: a wrapped DEK cannot be relocated."""
    wrapped = provider().wrap(generate_dek(), wrap_aad(BUCKET))

    with pytest.raises(InvalidTag):
        provider().unwrap(wrapped, 1, wrap_aad(uuid.uuid4()))


def test_an_unconfigured_version_is_named_rather_than_guessed() -> None:
    wrapped = provider().wrap(generate_dek(), wrap_aad(BUCKET))

    with pytest.raises(UnknownKekVersion):
        provider().unwrap(wrapped, 99, wrap_aad(BUCKET))


def test_rotation_leaves_existing_wrappings_readable() -> None:
    """ADR 002's rotation test: rewrap under a new KEK, stay recoverable."""
    dek = generate_dek()
    aad = wrap_aad(BUCKET)
    old = provider(current=1).wrap(dek, aad)

    rotated = provider(current=2)
    recovered = rotated.unwrap(old, 1, aad)
    rewrapped = rotated.wrap(recovered, aad)

    assert recovered == dek
    assert rotated.unwrap(rewrapped, 2, aad) == dek


def test_a_current_version_outside_the_map_is_rejected_at_construction() -> None:
    with pytest.raises(ValueError):
        EnvKeyProvider({1: KEK_1}, 2)


def test_a_wrong_sized_dek_is_rejected() -> None:
    with pytest.raises(ValueError):
        provider().wrap(b"short", wrap_aad(BUCKET))


def test_the_two_aad_constructions_can_never_collide() -> None:
    """Domain separation: a wrapped DEK and a secret must not share an AAD."""
    assert wrap_aad(BUCKET) != build_aad(BUCKET, "")
    assert wrap_aad(BUCKET) != build_aad(BUCKET, "DATABASE_URL")
