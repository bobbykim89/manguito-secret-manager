"""AES-256-GCM, used for secret values and for wrapped DEKs alike.

Named aead rather than secrets so it does not shadow the standard library
module of that name inside a package that imports it.
"""

import os
import uuid

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

NONCE_BYTES = 12
KEY_BYTES = 32
TAG_BYTES = 16


def build_aad(bucket_id: uuid.UUID, key_name: str) -> bytes:
    """Bind a ciphertext to exactly one (bucket, key) pair.

    The four byte length prefix is what makes the construction injective for
    any first component. ADR 002 A2 requires it because plain concatenation
    is not injective: bucket "ab" with key "c" and bucket "a" with key "bc"
    produce identical output, so ciphertext relocates cleanly between the two
    rows, which is the attack the AAD exists to prevent.

    A UUID is already fixed width, so today the prefix is defence in depth
    rather than strictly load bearing. It stays because the guarantee should
    not depend on the id's representation never changing.
    """
    raw = bucket_id.bytes
    return len(raw).to_bytes(4, "big") + raw + key_name.encode("utf-8")


def encrypt(key: bytes, plaintext: bytes, aad: bytes) -> bytes:
    """Return nonce || ciphertext || tag.

    A fresh 96 bit nonce per call. Reusing one under the same key destroys
    GCM's confidentiality and its authenticity at the same time.
    """
    if len(key) != KEY_BYTES:
        # Never name the key itself. A ValueError propagates into logs.
        raise ValueError(f"key must be {KEY_BYTES} bytes, got {len(key)}")
    nonce = os.urandom(NONCE_BYTES)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, aad)


def decrypt(key: bytes, blob: bytes, aad: bytes) -> bytes:
    """Reverse encrypt.

    Raises InvalidTag on tampering, truncation, a wrong key or a wrong AAD.
    It propagates rather than being caught here: a caller that swallowed it
    would be choosing to treat tampering as absence.
    """
    if len(key) != KEY_BYTES:
        raise ValueError(f"key must be {KEY_BYTES} bytes, got {len(key)}")
    if len(blob) < NONCE_BYTES + TAG_BYTES:
        # Too short to hold a nonce and a tag, so it cannot authenticate.
        # Raised here rather than left to the library, which reports a short
        # blob as a nonce length ValueError and would give callers a second
        # exception type to handle for the same underlying condition.
        raise InvalidTag
    return AESGCM(key).decrypt(blob[:NONCE_BYTES], blob[NONCE_BYTES:], aad)
