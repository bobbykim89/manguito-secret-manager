"""Direct coverage of KEY_NAME_PATTERN, exercised through Pydantic.

Pydantic v2's default regex engine (Rust, not Python's re) treats `$` as
matching only the true end of the string, not the position before a final
newline. Python's re.match would accept "KEY\\n" for this pattern, because
`$` matches before a trailing newline there. Testing through re would assert
the wrong engine's semantics, and a key name containing a newline reaches a
log line in app.secrets_service, where it could inject a fake log entry.
"""

import pytest
from pydantic import BaseModel, Field, ValidationError

from app.models.secret import KEY_NAME_PATTERN


class _KeyNameHolder(BaseModel):
    key: str = Field(pattern=KEY_NAME_PATTERN)


VALID_CASES = [
    ("upper_with_underscore", "DATABASE_URL"),
    ("dotted", "stripe.webhook"),
    ("hyphenated", "next-auth"),
    ("single_char", "A"),
    ("at_the_128_limit", "x" * 128),
]

INVALID_CASES = [
    ("one_over_the_limit", "x" * 129),
    ("leading_hyphen", "-leading"),
    ("leading_dot", ".leading"),
    ("leading_underscore", "_leading"),
    ("empty", ""),
    ("slash", "with/slash"),
    ("space", "with space"),
    ("comma", "with,comma"),
    ("trailing_newline", "KEY\n"),
]


@pytest.mark.parametrize(("label", "key"), VALID_CASES)
def test_valid_key_names_pass(label: str, key: str) -> None:
    assert _KeyNameHolder(key=key).key == key


@pytest.mark.parametrize(("label", "key"), INVALID_CASES)
def test_invalid_key_names_are_rejected(label: str, key: str) -> None:
    with pytest.raises(ValidationError):
        _KeyNameHolder(key=key)
