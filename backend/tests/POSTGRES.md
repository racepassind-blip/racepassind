# PostgreSQL integration tests

The regular `unittest discover` suite uses SQLite for fast local checks. It does not make concurrency claims. T023 PostgreSQL tests use independent SQLAlchemy sessions and real PostgreSQL row locks.

Run them only against a disposable PostgreSQL database because the suite resets its `public` schema before applying every Alembic migration from the base revision:

```sh
RACEPASS_TEST_DATABASE_URL='postgresql+psycopg://USER:PASSWORD@HOST:5432/racepass_t023' \
RACEPASS_TEST_DATABASE_RESET=1 \
./.venv/bin/python -m unittest tests.test_postgres_integration -v
```

The URL is intentionally explicit and provider-neutral. The repository does not provision PostgreSQL or require Docker; supply a standard PostgreSQL service separately. `RACEPASS_TEST_DATABASE_RESET=1` is mandatory and protects against accidentally running the destructive schema reset without an explicit opt-in.

When `RACEPASS_TEST_DATABASE_URL` is not set, the integration module is skipped by the normal backend test discovery command.
