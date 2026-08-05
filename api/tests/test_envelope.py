import pytest
from pydantic import BaseModel

from app.envelope import ApiError, Err, ErrorBody, Ok


class Payload(BaseModel):
    db: str


def test_ok_serialises_with_literal_true() -> None:
    assert Ok[Payload](data=Payload(db="ok")).model_dump() == {
        "ok": True,
        "data": {"db": "ok"},
    }


def test_err_serialises_with_literal_false() -> None:
    body = Err(error=ErrorBody(code="DB_UNAVAILABLE", message="Database is not reachable."))

    assert body.model_dump() == {
        "ok": False,
        "error": {"code": "DB_UNAVAILABLE", "message": "Database is not reachable."},
    }


def test_ok_rejects_a_false_flag() -> None:
    with pytest.raises(ValueError):
        Ok[Payload](ok=False, data=Payload(db="ok"))


def test_api_error_carries_code_message_and_status() -> None:
    error = ApiError("BUCKET_NOT_FOUND", "No such bucket.", status_code=404)

    assert error.code == "BUCKET_NOT_FOUND"
    assert error.message == "No such bucket."
    assert error.status_code == 404
    assert str(error) == "No such bucket."


def test_api_error_defaults_to_400() -> None:
    assert ApiError("BAD_REQUEST", "Nope.").status_code == 400
