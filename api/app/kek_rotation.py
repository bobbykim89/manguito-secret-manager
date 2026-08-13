"""Rewrapping every bucket's DEK under a new KEK version.

Locks by primary key rather than reusing get_bucket_for_update in
app/buckets.py, which filters by user_id and exists to serialise a bucket
delete against a concurrent secret write within one request. Rotation
crosses every user's buckets, so it needs a lock with no user in scope.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.crypto.keys import KeyProvider, wrap_aad
from app.models import Bucket


@dataclass(frozen=True)
class RotationResult:
    rotated: int
    already_current: int


def run_rotation(session: Session, provider: KeyProvider, *, dry_run: bool) -> RotationResult:
    """Rewrap every bucket not already on provider.current_version.

    Both counts are taken from one snapshot, before any writing happens:
    to_rotate is every bucket not yet on the target version, already_current
    is every bucket that already is. That snapshot is also the loop's own
    work list, so the two numbers describe the same instant a dry run would
    have seen.

    Each bucket commits in its own transaction. A crash mid run leaves
    buckets split across two KEK versions, which is not a broken state: a
    row naming the retired version still unwraps correctly as long as
    SECRETS_KEKS still lists that key. Rerunning re-takes the snapshot, so it
    resumes exactly where it stopped, with no state file.

    An unwrap failure (UnknownKekVersion, InvalidTag) is allowed to
    propagate rather than being caught here. It is far more likely a
    misconfiguration affecting every remaining bucket the same way than an
    isolated bad row, and the per-bucket commit already made prior progress
    durable, so aborting costs nothing: fix the configuration and rerun.

    A caller that receives a RotationResult from a real (non dry) run knows,
    without any further query, that every bucket is now on target_version:
    this function either finishes rotating every id in to_rotate or raises
    before returning at all.
    """
    target_version = provider.current_version

    to_rotate = session.scalars(select(Bucket.id).where(Bucket.kek_version != target_version)).all()
    already_current = len(
        session.scalars(select(Bucket.id).where(Bucket.kek_version == target_version)).all()
    )

    if dry_run:
        return RotationResult(rotated=len(to_rotate), already_current=already_current)

    rotated = 0
    for bucket_id in to_rotate:
        row = session.scalars(
            select(Bucket).where(Bucket.id == bucket_id).with_for_update()
        ).one_or_none()
        if row is None or row.kek_version == target_version:
            # Deleted since the snapshot was taken, or already rotated by a
            # concurrent run. Either way there is nothing left to do here.
            continue
        aad = wrap_aad(row.id)
        dek = provider.unwrap(row.wrapped_dek, row.kek_version, aad)
        row.wrapped_dek = provider.wrap(dek, aad)
        row.kek_version = target_version
        session.commit()
        rotated += 1

    return RotationResult(rotated=rotated, already_current=already_current)
