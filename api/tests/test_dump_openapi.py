import json
import os
import subprocess
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent


def run_dump() -> subprocess.CompletedProcess[str]:
    """Run the script with DATABASE_URL removed.

    The type pipeline must not need a database or a running server, so this
    deliberately strips the environment the rest of the suite sets up.
    """
    env = {
        "PATH": os.environ["PATH"],
        "PYTHONPATH": str(API_ROOT),
    }
    return subprocess.run(
        [sys.executable, "scripts/dump_openapi.py"],
        cwd=API_ROOT,
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )


def test_dump_runs_without_a_database_or_server() -> None:
    result = run_dump()

    assert result.returncode == 0, result.stderr


def test_dump_emits_the_health_path_and_envelope_schemas() -> None:
    schema = json.loads(run_dump().stdout)

    assert "/v1/health" in schema["paths"]
    assert "HealthData" in schema["components"]["schemas"]


def test_dump_is_deterministic() -> None:
    assert run_dump().stdout == run_dump().stdout
