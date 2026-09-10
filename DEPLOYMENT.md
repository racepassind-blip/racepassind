# RacePass deployment runbook

This runbook is intentionally provider-neutral. RacePass needs four replaceable infrastructure contracts: a Git-connected static frontend host, a Docker-compatible backend runtime, standard PostgreSQL, and private S3-compatible object storage. A concrete provider may be used as an operational example, but it is not part of the application architecture and can be replaced when the same inputs are available.

## 1. What is deployed

- **Frontend:** the Vite/React `dist/` directory from `frontend`.
- **Backend:** the stateless image built from `backend/Dockerfile`, exposing the platform-provided `PORT`.
- **Database:** standard PostgreSQL through `DATABASE_URL`.
- **Private files:** S3-compatible storage through the `STORAGE_*` variables. The production container must not depend on local disk uploads.

The backend exposes:

- `GET /health` — cheap process liveness check; it does not require the database.
- `GET /ready` — database readiness check; returns HTTP 503 when PostgreSQL is unavailable.
- `/api/v1/...` — application API routes.

## 2. Required inputs

### Backend secrets and configuration

Start from `backend/.env.example`, but replace every placeholder through the deployment platform's secret/configuration UI. Do not commit a real `.env` file.

Required production values:

```text
ENVIRONMENT=production
AUTO_MIGRATE=false
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/DATABASE
FRONTEND_ORIGINS=https://your-frontend-origin.example
SESSION_SECRET=<random secret>
CSRF_SECRET=<different random secret>
TICKET_SIGNING_SECRET=<different random secret>
STORAGE_MODE=s3
STORAGE_ENDPOINT=https://your-s3-compatible-endpoint.example
STORAGE_BUCKET=<private bucket>
STORAGE_REGION=<region or auto>
STORAGE_ACCESS_KEY=<secret-managed access key>
STORAGE_SECRET_KEY=<secret-managed secret key>
```

Google sign-in also requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`. Email/password sign-in can be used as the initial preview flow if Google OAuth has not been configured; do not advertise Google sign-in until its callback and credentials are configured.

`PORT` is supplied by the backend host. The container defaults to `8000` for local use.

### Frontend configuration

Copy `frontend/.env.example` into the static host's build environment:

```text
VITE_API_URL=https://your-backend-origin.example
```

This value is public and must contain only the API origin, without `/api/v1`. Never put database passwords, storage keys, OAuth client secrets, or signing secrets in `VITE_*` variables.

## 3. Local no-domain preview

The following is for local preview only. It uses SQLite and local private storage; it is not a production deployment.

Backend terminal:

```sh
cd backend
export ENVIRONMENT=development
export AUTO_MIGRATE=true
./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Frontend terminal:

```sh
cd frontend
printf 'VITE_API_URL=http://127.0.0.1:8000\n' > .env.local
npm ci
npm run dev -- --host 127.0.0.1
```

Open the Vite URL shown in the terminal. For a no-domain public preview, use the preview URLs supplied by the chosen static and container hosts, set the exact frontend preview origin in `FRONTEND_ORIGINS`, and use HTTPS. No application code may assume a particular host or domain.

## 4. Build and release sequence

Run migrations before starting a new backend image. The migration command is explicit and must run once per release against the target PostgreSQL database:

```sh
cd backend
set -a
. /path/to/production.env
set +a
sh scripts/migrate.sh
alembic current
```

The expected current head is `0009_unique_checkin_registration`. Keep `AUTO_MIGRATE=false` in production. Application startup must not run migrations, create demo data, or create a default admin account.

Build the backend image from the repository root:

```sh
docker build -t racepass-api:local backend
```

Run a local image smoke test only with development-safe configuration:

```sh
docker run --rm --name racepass-api-smoke \
  -e ENVIRONMENT=development \
  -e AUTO_MIGRATE=true \
  -e PORT=8000 \
  -p 8000:8000 \
  racepass-api:local
```

Then check:

```sh
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:8000/ready
```

For production, run the image with secret-managed environment variables, no required filesystem volume, and the platform's externally supplied `PORT`. Prefer a read-only root filesystem with a temporary `/tmp` mount when the host supports it. S3-compatible storage is required so QR image uploads do not depend on the container filesystem.

Build the frontend from `frontend`:

```sh
npm ci
VITE_API_URL=https://your-backend-origin.example npm run build
```

Publish `dist/` through the static host. Configure SPA fallback so unknown frontend routes serve `index.html`. Configure the backend CORS origin to exactly match the deployed frontend origin.

## 5. Provider replacement checklist

A provider is replaceable when it supplies these equivalent inputs:

- Static host: Git-connected build, `npm ci`, `npm run build`, `dist/` output, HTTPS, and SPA fallback.
- Backend host: Docker image execution, externally supplied `PORT`, environment secrets, `/health` liveness, and `/ready` readiness checks.
- PostgreSQL host: standard PostgreSQL connection URL, backups, TLS, restore access, and migration execution access.
- Object storage host: S3-compatible endpoint, private bucket, access key, secret key, region, and presigned GET support.
- Google: OAuth client ID/secret and an exact HTTPS callback URL supplied through environment variables.

Names such as Vercel, Render, Supabase, Railway, Neon, and Cloudflare are only replaceable operational examples. No business logic imports their SDKs or depends on their hostnames.

## 6. Operations and security

- Keep HTTPS enabled for frontend, backend, database connections, and OAuth callbacks.
- Rotate session, CSRF, ticket-signing, database, OAuth, and storage secrets through the platform secret manager.
- Keep the object-storage bucket private; the application issues short-lived signed reads.
- Back up PostgreSQL before migrations and retain tested restore points. Back up the object-storage bucket according to its retention policy.
- Roll back application code first only when the previous image is schema-compatible. For a migration rollback, stop writes, take a backup, review the specific Alembic downgrade, run it explicitly, and then deploy the compatible image. Never rely on application startup to downgrade or repair a database.
- Review structured logs for request ID, route, status, and duration only. Do not add credentials, cookies, tokens, UTR values, participant payloads, or raw URLs to logs.
- Monitor `/health`, `/ready`, migration status, database errors, storage errors, response latency, and rate-limit responses.
- Use a managed background-job mechanism later for exports, emails, and verification work; do not make the container filesystem a queue.

## 7. Launch checks

Before calling the POC publicly launch-ready, complete T025's non-sensitive end-to-end flow and confirm:

- PostgreSQL migrations and concurrency tests pass.
- Production `AUTO_MIGRATE=false` is enforced.
- No demo credentials or secrets are present in source or build artifacts.
- CORS, CSRF, secure cookies, rate limits, and authorization checks pass.
- Database and object-storage backup/restore procedures are documented and tested.
- The deployed frontend can reach the backend through the configured `VITE_API_URL`.
- A participant can register, submit UPI reference, receive organizer approval, view a ticket, and be checked in once.
- Cross-organizer and cross-participant access remains denied.
