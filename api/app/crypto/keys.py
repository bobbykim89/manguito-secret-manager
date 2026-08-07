"""The KEK tier: wrapping and unwrapping per-bucket DEKs.

ADR 002's KeyProvider sketch takes no version. It widens here, because a
provider that cannot say which KEK wrapped a given DEK cannot support
rotation, and the schema records a version per bucket for exactly that
reason. See ADR 002 A15.
"""

import os
import uuid
from functools import lru_cache
from typing import Protocol

from app.config import Settings, get_settings
from app.crypto.aead import decrypt, encrypt

DEK_BYTES = 32


def generate_dek() -> bytes:
    return os.urandom(DEK_BYTES)


def wrap_aad(bucket_id: uuid.UUID) -> bytes:
    """Bind a wrapped DEK to its bucket row, so it cannot be relocated.

    Deliberately a different construction from build_aad, which binds a
    secret to a (bucket, key) pair. The b"dek:" prefix gives the two domains
    separation that no bucket id or key name can erase, since build_aad
    always begins with a four byte length.
    """
    return b"dek:" + bucket_id.bytes


class UnknownKekVersion(Exception):  # noqa: N818 -- name fixed by the brief's interface list
    """A row names a KEK version this deployment does not hold.

    Distinct from InvalidTag: the data is probably fine and the deployment
    is misconfigured, most likely a retired KEK dropped too early.
    """


class KeyProvider(Protocol):
    @property
    def current_version(self) -> int: ...

    def wrap(self, dek: bytes, aad: bytes) -> bytes: ...

    def unwrap(self, wrapped: bytes, version: int, aad: bytes) -> bytes: ...


class EnvKeyProvider:
    """KEKs held in the environment. The v1 implementation, per ADR 002.

    Wraps only with the current version and unwraps with whichever version
    the row names, so a rotation can rewrap rows gradually instead of
    needing a flag day.
    """

    def __init__(self, keks: dict[int, bytes], current_version: int) -> None:
        if current_version not in keks:
            raise ValueError(f"current KEK version {current_version} is not configured")
        self._keks = keks
        self._current = current_version

    @property
    def current_version(self) -> int:
        return self._current

    def wrap(self, dek: bytes, aad: bytes) -> bytes:
        if len(dek) != DEK_BYTES:
            raise ValueError(f"DEK must be {DEK_BYTES} bytes, got {len(dek)}")
        return encrypt(self._keks[self._current], dek, aad)

    def unwrap(self, wrapped: bytes, version: int, aad: bytes) -> bytes:
        kek = self._keks.get(version)
        if kek is None:
            raise UnknownKekVersion(f"KEK version {version} is not configured")
        return decrypt(kek, wrapped, aad)


def build_key_provider(settings: Settings) -> KeyProvider:
    return EnvKeyProvider(settings.kek_map, settings.secrets_kek_version)


@lru_cache(maxsize=1)
def get_key_provider() -> KeyProvider:
    """Cached like get_settings, and cleared by the same test fixture."""
    return build_key_provider(get_settings())
