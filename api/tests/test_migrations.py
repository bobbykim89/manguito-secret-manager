from pathlib import Path

from alembic.config import Config
from sqlalchemy import inspect, text

from alembic import command
from app.db import create_db_engine

API_ROOT = Path(__file__).resolve().parent.parent


def alembic_config(postgres_url: str) -> Config:
    config = Config(str(API_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(API_ROOT / "alembic"))
    config.set_main_option("sqlalchemy.url", postgres_url)
    return config


def test_baseline_migration_applies_and_reverses(postgres_url: str) -> None:
    config = alembic_config(postgres_url)
    engine = create_db_engine(postgres_url)

    command.upgrade(config, "head")
    with engine.connect() as connection:
        version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert version == "0001"

    command.downgrade(config, "base")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM alembic_version")).scalar_one() == 0


def test_baseline_creates_no_domain_tables(postgres_url: str) -> None:
    """SP1 deliberately ships no schema. SP2 owns the first real tables."""
    config = alembic_config(postgres_url)
    engine = create_db_engine(postgres_url)

    command.upgrade(config, "head")
    try:
        tables = set(inspect(engine).get_table_names())
        assert tables == {"alembic_version"}
    finally:
        command.downgrade(config, "base")
