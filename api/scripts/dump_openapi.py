"""Write the OpenAPI document to stdout.

Deliberately imports the FastAPI app object rather than fetching
/openapi.json from a running server: no process to start, no port to bind,
no readiness to poll. The Makefile `types` target and the `types-drift` CI
check both invoke this script, so they cannot diverge. (ADR 001 A3)
"""

import base64
import json
import os
import sys

# The app reads settings at import time for CORS. Nothing here touches the
# database, so a placeholder URL is correct rather than merely convenient.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://schema-dump/schema-dump")
os.environ.setdefault("CORS_ORIGINS", "")
os.environ.setdefault("ENVIRONMENT", "schema-dump")
os.environ.setdefault("GOOGLE_CLIENT_ID", "schema-dump")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "schema-dump")
os.environ.setdefault("GOOGLE_REDIRECT_URI", "http://schema-dump/callback")
os.environ.setdefault("APP_URL", "http://schema-dump")
os.environ.setdefault("SECRETS_KEKS", "1:" + base64.b64encode(bytes(range(32))).decode())
os.environ.setdefault("SECRETS_KEK_VERSION", "1")


def main() -> None:
    from app.main import app

    # sort_keys and a fixed indent keep the generated TypeScript diff-stable.
    json.dump(app.openapi(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
