# SportPass local development

This guide runs the frontend and backend locally while using the Neon PostgreSQL database as the development source of truth. The backend requires an explicitly loaded Neon `DATABASE_URL`; it will not fall back to the local SQLite database.

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

## Start the backend with Neon

Open Terminal 1. This explicitly loads `DATABASE_URL` from `backend/.env.local`; the application does not load that file automatically.

```sh
cd /Users/work/Desktop/race_pass/backend
export DATABASE_URL="$(./.venv/bin/python -c 'from dotenv import dotenv_values; url = dotenv_values(".env.local").get("DATABASE_URL"); assert url and "neon.tech" in url, "backend/.env.local must contain a Neon DATABASE_URL"; print(url)')"
export ENVIRONMENT=development
export AUTO_MIGRATE=false

# Put real R2 values in backend/.env.local. Never commit or share those values.
# Uvicorn loads the database and R2 environment from that file below.

./.venv/bin/python -m alembic upgrade head
./.venv/bin/python -m uvicorn app.main:app --env-file .env.local --host 127.0.0.1 --port 8010
```

The backend runs at:

```text
http://127.0.0.1:8010
```

This setup uses the Neon database configured in `backend/.env.local`. Run the Alembic command after pulling schema changes; keep `AUTO_MIGRATE=false` so the app does not silently migrate a remote database at startup.

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

The frontend must point to the backend on port `8010`. If Vite selects a different port, use the URL printed in the terminal.

## Check that the backend is working

```sh
curl http://127.0.0.1:8010/health
curl http://127.0.0.1:8010/ready
curl http://127.0.0.1:8010/api/v1/events
```

Expected health responses include:

```json
{"status":"ok"}
```

and:

```json
{"status":"ready"}
```

## Stop the services

Press `Control+C` in each terminal running the backend or frontend.

## Important database note

Do not put a Neon password or other secret in this file or commit a `.env` file. Normal development for this project uses the Neon database configured in `backend/.env.local`; the local `backend/app.db` file is retained but is no longer used by the application. Neon PostgreSQL is the source of truth for development data.

Public preview URLs:

- Frontend: https://sportpass-frontend-preview.onrender.com
- Backend: https://sportpass-backend-preview.onrender.com

## Neon development admin

> Local development reference only. Do not commit or share these credentials.

```text
Email: suhrp@sportpassind.com
Password: Sourav0211$Race
Database: Neon development database


MDACA Organizer:
lokisport@gmail.com
```
