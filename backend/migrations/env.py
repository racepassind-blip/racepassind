from __future__ import annotations

from alembic import context
from sqlalchemy import create_engine, inspect, pool, text

from app.config import get_settings
from db import Base
import models

config = context.config
target_metadata = Base.metadata


def _widen_version_table(*, ctx, **_kwargs) -> None:
    connection = ctx.connection
    if connection is None or connection.dialect.name != "postgresql":
        return
    if inspect(connection).has_table("alembic_version"):
        connection.execute(text("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(128)"))


def _database_url() -> str:
    return get_settings().database_url


def _connect_args(url: str) -> dict:
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


def run_migrations_offline() -> None:
    url = _database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = _database_url()
    connectable = create_engine(url, poolclass=pool.NullPool, connect_args=_connect_args(url))

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            on_version_apply=_widen_version_table,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
