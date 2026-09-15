# SportPass local development

This guide runs the frontend and backend locally while using the Neon PostgreSQL database as the development source of truth. The backend requires a Neon `DATABASE_URL`; it will not fall back to a local SQLite database.

## Prerequisites

- macOS Terminal
- Python virtual environment at `backend/.venv`
- Node.js and npm
- Frontend dependencies installed in `frontend/node_modules`

If this is the first setup, run once:

```sh
cd /Users/work/Desktop/race_pass/backend
python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.lock

cd /Users/work/Desktop/race_pass/frontend
npm ci
```

## Configure `backend/.env.local`

The backend automatically loads `backend/.env.local` when `ENVIRONMENT` is not `production`
(see `app/config.py`). Put the development configuration there and do not commit the file — it is
gitignored.

Required keys:

```text
ENVIRONMENT=development
AUTO_MIGRATE=true
PORT=8010

# Neon connection URL. If Neon shows postgresql://, rewrite it to postgresql+psycopg://
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@ep-xxxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require&channel_binding=require

FRONTEND_ORIGINS=http://127.0.0.1:8080

# Cloudflare R2 / S3-compatible private object storage
STORAGE_MODE=s3
STORAGE_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
STORAGE_BUCKET=<your-bucket>
STORAGE_REGION=auto
STORAGE_ACCESS_KEY=<r2-access-key>
STORAGE_SECRET_KEY=<r2-secret-key>
STORAGE_SIGNED_URL_TTL_SECONDS=900
STORAGE_MAX_UPLOAD_BYTES=2000000
STORAGE_MAX_DIMENSION=4096
```

> Do not manually `export DATABASE_URL` in your shell. A shell-exported value overrides
> `.env.local` (config loads with `override=False`), which can silently pin the app to the wrong
> database. If a previous session exported it, run `unset DATABASE_URL` or open a fresh terminal.

## Start the backend with Neon

Open Terminal 1. The app reads `backend/.env.local` on its own, so no manual exports are needed:

```sh
cd /Users/work/Desktop/race_pass/backend
unset DATABASE_URL            # clear any stale export from a previous session
./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

The backend runs at:

```text
http://127.0.0.1:8010
```

To confirm which database the app resolves before starting the server:

```sh
cd /Users/work/Desktop/race_pass/backend
unset DATABASE_URL
./.venv/bin/python -c "from app.config import get_settings; print(get_settings().database_url)"
```

### Applying migrations

Migrations are managed with Alembic. To apply the latest schema to the Neon database:

```sh
cd /Users/work/Desktop/race_pass/backend
./.venv/bin/python -m alembic upgrade head
./.venv/bin/python -m alembic current   # should print: 0028_event_checkpoints (head)
```

Run this after pulling schema changes. In production keep `AUTO_MIGRATE=false` and run migrations
as an explicit release step; `AUTO_MIGRATE=true` is convenient for local development only.

## Start the frontend

Open Terminal 2:

```sh
cd /Users/work/Desktop/race_pass/frontend
VITE_API_URL=http://127.0.0.1:8010 \
  npm run dev -- --host 127.0.0.1
```

Open the application at:

```text
http://127.0.0.1:8080
```

The frontend must point to the backend on port `8010`. If Vite selects a different port, use the
URL printed in the terminal.

## Check that the backend is working

```sh
curl http://127.0.0.1:8010/health
curl http://127.0.0.1:8010/ready
curl http://127.0.0.1:8010/api/v1/events
```

Expected health responses:

```json
{"status":"ok"}
```

and:

```json
{"status":"ready"}
```

`/ready` returns 200 only when the app can reach the Neon database.

## Stop the services

Press `Control+C` in each terminal running the backend or frontend.

## Important database note

Do not put a Neon password or other secret in this file or commit a `.env` file. Real secrets live
only in `backend/.env.local` (gitignored) and in the deployment platform's secret manager. Neon
PostgreSQL is the source of truth for development data; the local `backend/app.db` file is retained
but no longer used by the application.

## Deployed environments (Render)

- Frontend: https://sportpassindia-frontend.onrender.com
- Backend: https://sportpassindia.onrender.com

The backend requires a SPA rewrite rule on the static site (`/*` -> `/index.html`, action
Rewrite) so client-side routes resolve on direct load and refresh.


BE:
unset DATABASE_URL
./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8010

Name: Suhruth MV
Email: suhruth.mv@sportpassind.com
Role: admin