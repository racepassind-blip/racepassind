from __future__ import annotations

import logging
import secrets
import time
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import CSRF_COOKIE
from app.api.v1.admin import router as admin_router
from app.api.v1.allocations import router as allocations_router
from app.api.v1.auth import router as auth_router
from app.api.v1.checkins import router as checkins_router
from app.api.v1.courts import router as courts_router
from app.api.v1.events import router as events_router
from app.api.v1.matches import router as matches_router
from app.api.v1.organizer import router as organizer_router
from app.api.v1.public_events import _fee_config_values, _public_event, router as public_events_router
from app.api.v1.storage import router as storage_router
from app.api.v1.tournament_rounds import router as tournament_rounds_router
from app.api.v1.registrations import router as registrations_router
from app.api.v1.refunds import router as refunds_router
from app.api.v1.race_results import router as race_results_router
from app.config import get_settings
from app.infrastructure.storage.factory import get_storage_service
from db import engine, get_db
from models import Event, EventCategory
from schemas import EventOut

settings = get_settings()
logger = logging.getLogger("sportpass.api")

app = FastAPI(title="Sport Pass API", version="0.1.0")
app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(admin_router, prefix="/api/v1/admin", tags=["admin"])
app.include_router(public_events_router, prefix="/api/v1", tags=["public-events"])
app.include_router(storage_router, prefix="/api/v1/storage", tags=["storage"])
app.include_router(registrations_router, prefix="/api/v1", tags=["registrations"])
app.include_router(checkins_router, prefix="/api/v1/organizer/checkins", tags=["organizer-checkins"])
app.include_router(courts_router, prefix="/api/v1/organizer", tags=["organizer-courts"])
app.include_router(matches_router, prefix="/api/v1/organizer", tags=["organizer-matches"])
app.include_router(tournament_rounds_router, prefix="/api/v1/organizer", tags=["organizer-tournament-rounds"])
app.include_router(organizer_router, prefix="/api/v1/organizer", tags=["organizer"])
app.include_router(events_router, prefix="/api/v1/organizer", tags=["organizer-events"])
app.include_router(allocations_router, prefix="/api/v1/organizer", tags=["organizer-allocation"])
app.include_router(refunds_router, prefix="/api/v1", tags=["refunds"])
app.include_router(race_results_router, prefix="/api/v1", tags=["organizer-race-results", "public-race-results"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.frontend_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Content-Type", "X-CSRF-Token", "X-Request-ID", "Idempotency-Key"],
)


def _safe_request_id(value: str | None) -> str:
    if value:
        try:
            return str(uuid.UUID(value))
        except ValueError:
            pass
    return str(uuid.uuid4())


def _apply_security_headers(response: JSONResponse) -> None:
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    if settings.is_production:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"


@app.middleware("http")
async def security_and_observability_middleware(request: Request, call_next):
    request_id = _safe_request_id(request.headers.get("X-Request-ID"))
    request.state.request_id = request_id
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as exc:
        logger.exception("request_failed", extra={"request_id": request_id, "method": request.method})
        detail = "Internal server error"
        if settings.environment != "production":
            detail = f"{type(exc).__name__}: {exc}"
        response = JSONResponse(status_code=500, content={"detail": detail})

    # Only issue an ambient CSRF cookie when:
    #   1. The incoming request has no CSRF cookie yet (first visit / cleared cookies).
    #   2. The outgoing response is not already setting the CSRF cookie — prevents
    #      producing two conflicting Set-Cookie headers for the same cookie name,
    #      which would cause the stored cookie and the in-header token to diverge
    #      and CSRF validation to fail intermittently.
    #   3. This is not the /auth/csrf endpoint itself — that endpoint is the single
    #      authoritative setter for a fresh token, and letting the middleware also
    #      set a *different* random value on the same response would create a race
    #      between which Set-Cookie the browser honours.
    #
    # Note: response.raw_headers is populated for both Starlette Response objects
    # and for the JSONResponse we construct in the except-branch above, so the
    # guard is reliable regardless of which code path produced the response.
    is_csrf_endpoint = request.url.path.rstrip("/").endswith("/auth/csrf")
    response_sets_csrf = any(
        key.decode("latin-1").lower() == "set-cookie"
        and value.decode("latin-1").startswith(f"{CSRF_COOKIE}=")
        for key, value in response.raw_headers
    )
    if not request.cookies.get(CSRF_COOKIE) and not response_sets_csrf and not is_csrf_endpoint:
        response.set_cookie(
            CSRF_COOKIE,
            secrets.token_urlsafe(32),
            httponly=False,
            secure=settings.is_production,
            samesite="none" if settings.is_production else "lax",
            max_age=7 * 24 * 60 * 60,
            path="/",
        )
    _apply_security_headers(response)
    route = request.scope.get("route")
    route_path = getattr(route, "path", request.url.path.split("?", 1)[0])
    logger.info(
        "request_completed",
        extra={
            "request_id": request_id,
            "method": request.method,
            "route": route_path,
            "status_code": response.status_code,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        },
    )
    response.headers["X-Request-ID"] = request_id
    return response


def _run_migrations() -> None:
    if not settings.auto_migrate:
        return

    from alembic import command
    from alembic.config import Config

    base_dir = Path(__file__).resolve().parent
    cfg = Config(str(base_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(base_dir / "migrations"))
    cfg.set_main_option("prepend_sys_path", str(base_dir))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)

    with engine.connect() as conn:
        inspector = inspect(conn)
        if not inspector.has_table("alembic_version"):
            tables = set(inspector.get_table_names())
            if {"events", "ticket_tiers"}.issubset(tables):
                command.stamp(cfg, "0001_initial")

    command.upgrade(cfg, "head")


@app.on_event("startup")
def on_startup() -> None:
    try:
        _run_migrations()
    except ModuleNotFoundError:
        if settings.is_production:
            raise
        from db import Base

        Base.metadata.create_all(bind=engine)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def readiness(db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        logger.warning("readiness_failed", extra={"error_type": type(exc).__name__})
        raise HTTPException(status_code=503, detail="Service not ready") from exc
    return {"status": "ready"}


@app.get("/events", response_model=list[EventOut])
def list_events(
    db: Session = Depends(get_db),
    storage=Depends(get_storage_service),
) -> list[dict]:
    events = db.scalars(
        select(Event)
        .options(
            selectinload(Event.organization),
            selectinload(Event.tickets),
            selectinload(Event.categories).selectinload(EventCategory.tickets),
        )
        .where(Event.status == "published", Event.archived_at.is_(None))
        .order_by(Event.start_date)
    ).unique().all()
    fee_bps, fee_min, fee_max, fee_fixed = _fee_config_values(db)
    return [_public_event(event, storage, fee_percentage_basis_points=fee_bps, fee_minimum_paise=fee_min, fee_maximum_paise=fee_max, fee_fixed_paise=fee_fixed) for event in events]


@app.get("/events/{event_id}", response_model=EventOut)
def get_event(
    event_id: str,
    db: Session = Depends(get_db),
    storage=Depends(get_storage_service),
) -> dict:
    try:
        event_uuid = uuid.UUID(event_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid event id") from exc
    event = db.scalar(
        select(Event)
        .options(
            selectinload(Event.organization),
            selectinload(Event.tickets),
            selectinload(Event.categories).selectinload(EventCategory.tickets),
        )
        .where(Event.id == event_uuid, Event.status == "published", Event.archived_at.is_(None))
    )
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    fee_bps, fee_min, fee_max, fee_fixed = _fee_config_values(db)
    return _public_event(event, storage, fee_percentage_basis_points=fee_bps, fee_minimum_paise=fee_min, fee_maximum_paise=fee_max, fee_fixed_paise=fee_fixed)
