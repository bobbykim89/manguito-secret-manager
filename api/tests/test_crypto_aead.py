import uuid

import pytest
from cryptography.exceptions import InvalidTag
from hypothesis import given
from hypothesis import strategies as st

from app.crypto.aead import NONCE_BYTES, build_aad, decrypt, encrypt

KEY = bytes(range(32))
BUCKET = uuid.UUID("11111111-1111-1111-1111-111111111111")
AAD = build_aad(BUCKET, "DATABASE_URL")

# Excludes surrogates, which are valid str but cannot be utf-8 encoded.
utf8_text = st.text(alphabet=st.characters(codec="utf-8"), max_size=256)


@given(plaintext=st.binary(max_size=2048))
def test_roundtrip(plaintext: bytes) -> None:
    assert decrypt(KEY, encrypt(KEY, plaintext, AAD), AAD) == plaintext


@given(text=utf8_text)
def test_roundtrip_survives_unicode(text: str) -> None:
    raw = text.encode("utf-8")
    assert decrypt(KEY, encrypt(KEY, raw, AAD), AAD) == raw


def test_the_same_plaintext_encrypts_differently_each_time() -> None:
    """Proves the nonce is fresh. Identical output would mean reuse."""
    first = encrypt(KEY, b"same", AAD)
    second = encrypt(KEY, b"same", AAD)

    assert first != second
    assert first[:NONCE_BYTES] != second[:NONCE_BYTES]


@given(
    plaintext=st.binary(min_size=1, max_size=256),
    index=st.integers(min_value=0),
    flip=st.integers(min_value=1, max_value=255),
)
def test_flipping_any_byte_fails_rather_than_returning_plaintext(
    plaintext: bytes, index: int, flip: int
) -> None:
    """Covers the nonce, the ciphertext and the tag, since index walks the whole blob."""
    blob = bytearray(encrypt(KEY, plaintext, AAD))
    blob[index % len(blob)] ^= flip

    with pytest.raises(InvalidTag):
        decrypt(KEY, bytes(blob), AAD)


def test_a_different_aad_fails() -> None:
    """Row binding: a ciphertext must not decrypt under another row's AAD."""
    other = build_aad(uuid.UUID("22222222-2222-2222-2222-222222222222"), "DATABASE_URL")
    blob = encrypt(KEY, b"value", AAD)

    with pytest.raises(InvalidTag):
        decrypt(KEY, blob, other)


def test_a_different_key_name_fails() -> None:
    """The same bucket, a different key. Relocation within a bucket is also blocked."""
    blob = encrypt(KEY, b"value", AAD)

    with pytest.raises(InvalidTag):
        decrypt(KEY, blob, build_aad(BUCKET, "OTHER_KEY"))


@given(
    first_id=st.uuids(),
    first_name=utf8_text,
    second_id=st.uuids(),
    second_name=utf8_text,
)
def test_aad_is_injective(
    first_id: uuid.UUID, first_name: str, second_id: uuid.UUID, second_name: str
) -> None:
    """No two distinct (bucket_id, key_name) pairs share an AAD.

    This is the property ADR 002 A2 requires. Plain concatenation fails it.
    """
    if (first_id, first_name) == (second_id, second_name):
        return

    assert build_aad(first_id, first_name) != build_aad(second_id, second_name)


def test_a_wrong_sized_key_is_rejected() -> None:
    with pytest.raises(ValueError):
        encrypt(b"short", b"value", AAD)
