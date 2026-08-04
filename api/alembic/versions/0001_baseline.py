"""Baseline.

Deliberately empty. Its purpose is to prove that Alembic is wired, runs
against Neon, and executes in Fly's release step, without inventing a table
that exists only to be dropped. SP2 stacks the first real schema on top by
setting down_revision = "0001".

Revision ID: 0001
Revises:
Create Date: 2026-08-03
"""

from collections.abc import Sequence

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
