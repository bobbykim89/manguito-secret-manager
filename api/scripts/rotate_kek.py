"""Rewrap every bucket's DEK under the current KEK version.

Run by hand: `uv run python scripts/rotate_kek.py [--dry-run]`. Never
scheduled. See docs/superpowers/specs/2026-08-12-kek-rotation-cli-design.md
for why: a KEK has no shelf life a calendar can track, and rotation needs a
human deciding it is time, not a cron window.

The new KEK must already be in SECRETS_KEKS, with SECRETS_KEK_VERSION
pointing at it, before this runs. That is a manual step this script cannot
perform: it only ever touches Postgres.
"""

import argparse
import sys

from sqlalchemy.orm import Session

from app.config import get_settings
from app.crypto.keys import build_key_provider
from app.db import get_engine
from app.kek_rotation import RotationResult, run_rotation


def format_summary(result: RotationResult, *, target_version: int) -> str:
    # 0 remaining is not re-verified by a query here. run_rotation either
    # finishes rotating every bucket in its snapshot or raises before
    # returning, so a RotationResult reaching this function already proves
    # nothing is left on another version.
    return (
        f"Rotated {result.rotated} buckets to version {target_version}.\n"
        f"0 buckets remain on another version.\n"
        f"Safe to remove the retired KEK version from SECRETS_KEKS."
    )


def format_dry_run_summary(result: RotationResult, *, target_version: int) -> str:
    return (
        f"Would rotate {result.rotated} buckets to version {target_version}.\n"
        f"{result.already_current} already on version {target_version}."
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would rotate without changing anything.",
    )
    args = parser.parse_args(argv)

    settings = get_settings()
    provider = build_key_provider(settings)

    with Session(get_engine()) as session:
        result = run_rotation(session, provider, dry_run=args.dry_run)

    if args.dry_run:
        print(format_dry_run_summary(result, target_version=provider.current_version))
    else:
        print(format_summary(result, target_version=provider.current_version))


if __name__ == "__main__":
    main(sys.argv[1:])
