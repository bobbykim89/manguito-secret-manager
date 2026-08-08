import base64
import binascii
from functools import lru_cache

from pydantic import ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Values that are definitely not production. Anything else, including a
# typo or a new environment name, is treated as production, because a
# wrong guess here costs a broken local login you notice immediately
# rather than a missing Secure flag in production that nobody notices.
_NON_PRODUCTION = frozenset({"local", "test", "schema-dump"})

# A KEK is exactly AES-256's key size. Anything else is a configuration
# error, not a shorter key.
_KEK_BYTES = 32


class ConfigurationError(Exception):
    """Configuration is invalid, reported without the values that failed.

    Deliberately not a ValidationError. Pydantic captures the raw input it
    rejected and exposes it through .errors() and .json(), which for
    SECRETS_KEKS is the KEK itself. Anything that serialises exceptions
    would then emit it.
    """


class Settings(BaseSettings):
    """Application configuration, read from the environment.

    Build this through get_settings rather than directly. A validation
    failure here carries the whole input dict in ValidationError.errors()
    and .json(), which means the KEK, the Google client secret and the
    database password. get_settings is what keeps that out of anything
    that serialises exceptions.
    """

    model_config = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str
    cors_origins: str = ""
    environment: str = "local"
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str
    app_url: str
    session_cookie_domain: str = ""
    secrets_keks: str
    secrets_kek_version: int

    @field_validator("app_url")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        # Every redirect target is built as f"{app_url}/path", so a trailing
        # slash on app_url turns that into "//path": a real path, not
        # protocol-relative, that no router will match. Normalize once here
        # instead of at every call site.
        return value.rstrip("/")

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        if "*" in origins:
            # CORSMiddleware runs with allow_credentials=True, and Starlette's
            # response to a wildcard origin under credentials is not to send
            # "*": it reflects whatever Origin the request sent. A wildcard
            # here would silently make every origin on the internet a
            # credentialed one.
            raise ValueError(
                "CORS_ORIGINS cannot contain '*': with allow_credentials=True, "
                "Starlette reflects any Origin instead of sending a literal "
                "wildcard, which would grant every site credentialed access"
            )
        return origins

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() not in _NON_PRODUCTION

    @property
    def kek_map(self) -> dict[int, bytes]:
        """Parse SECRETS_KEKS into {version: key}.

        Fails loudly on anything malformed, following the same fail closed
        reasoning as is_production: a broken key configuration should crash
        at startup, where it is obvious, rather than at the first request
        that needs to unwrap something.

        No error message here interpolates the encoded key. A wrong length
        KEK is still real key material, and a ValidationError string reaches
        logs and crash reports.
        """
        keks: dict[int, bytes] = {}
        for entry in self.secrets_keks.split(","):
            entry = entry.strip()
            if not entry:
                continue
            version_text, separator, encoded = entry.partition(":")
            if not separator or not encoded:
                raise ValueError("SECRETS_KEKS entries must look like 'version:base64'")
            try:
                version = int(version_text)
            except ValueError:
                raise ValueError(
                    f"SECRETS_KEKS version {version_text!r} is not an integer"
                ) from None
            if version in keks:
                raise ValueError(f"SECRETS_KEKS has two entries for version {version}")
            try:
                key = base64.b64decode(encoded, validate=True)
            except (binascii.Error, ValueError):
                raise ValueError(f"SECRETS_KEKS version {version} is not valid base64") from None
            if len(key) != _KEK_BYTES:
                raise ValueError(
                    f"SECRETS_KEKS version {version} must decode to {_KEK_BYTES} bytes, "
                    f"got {len(key)}"
                )
            keks[version] = key
        if not keks:
            raise ValueError("SECRETS_KEKS must contain at least one 'version:base64' entry")
        return keks

    @model_validator(mode="after")
    def _validate_keks(self) -> "Settings":
        if self.secrets_kek_version not in self.kek_map:
            raise ValueError(
                f"SECRETS_KEK_VERSION {self.secrets_kek_version} is not present in SECRETS_KEKS"
            )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as error:
        # An allowlist over loc and msg, never input. Same shape as the
        # logging rule: name the field that failed and why, never the value.
        details = "; ".join(
            f"{'.'.join(str(part) for part in item['loc']) or 'config'}: {item['msg']}"
            for item in error.errors()
        )
        # from None, not from error: chaining would keep the leaking
        # exception reachable as __cause__ and in the printed traceback.
        raise ConfigurationError(f"Invalid configuration. {details}") from None
