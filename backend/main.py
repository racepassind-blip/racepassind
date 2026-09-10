from __future__ import annotations

import datetime as dt
import logging
import secrets
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import CSRF_COOKIE
from app.api.v1.admin import router as admin_router
from app.api.v1.auth import router as auth_router
from app.api.v1.checkins import router as checkins_router
from app.api.v1.events import router as events_router
from app.api.v1.organizer import router as organizer_router
from app.api.v1.public_events import router as public_events_router
from app.api.v1.storage import router as storage_router
from app.api.v1.registrations import router as registrations_router
from app.config import get_settings
from db import SessionLocal, engine, get_db
from models import Event, EventCategory, EventPaymentSettings, Organization, Ticket
from schemas import EventOut

settings = get_settings()
logger = logging.getLogger("racepass.api")

app = FastAPI(title="Race Pass API", version="0.1.0")
app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(admin_router, prefix="/api/v1/admin", tags=["admin"])
app.include_router(public_events_router, prefix="/api/v1", tags=["public-events"])
app.include_router(storage_router, prefix="/api/v1/storage", tags=["storage"])
app.include_router(registrations_router, prefix="/api/v1", tags=["registrations"])
app.include_router(checkins_router, prefix="/api/v1/organizer/checkins", tags=["organizer-checkins"])
app.include_router(organizer_router, prefix="/api/v1/organizer", tags=["organizer"])
app.include_router(events_router, prefix="/api/v1/organizer", tags=["organizer-events"])

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
    except Exception:
        logger.exception("request_failed", extra={"request_id": request_id, "method": request.method})
        response = JSONResponse(status_code=500, content={"detail": "Internal server error"})

    if not request.cookies.get(CSRF_COOKIE):
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


def _events_seed() -> list[dict[str, Any]]:
    placeholder = "/placeholder.svg"
    return [
        {
            "title": "Bengaluru Monsoon 10K",
            "date": "2026-10-11",
            "location": "Bengaluru, Karnataka, India",
            "category": "running",
            "image": placeholder,
            "description": "A community-first 10K through Bengaluru for runners of every experience level.",
            "distance": "10 km",
            "participants": 0,
            "maxParticipants": 1500,
            "organizer": "RacePass Bengaluru Community",
            "rules": ["Bib must be visible during the race.", "Follow marshal instructions and stay on the marked course."],
            "upi": {"id": "racepass.bengaluru@upi", "payee": "RacePass Bengaluru Community"},
            "categories": [
                {
                    "name": "10K Open",
                    "distance": "10 km",
                    "tickets": [
                        {"name": "Early Bird", "price": 49900, "description": "Race entry, timing, and finisher medal", "available": 300},
                        {"name": "Regular", "price": 69900, "description": "Race entry, timing, and finisher medal", "available": 1200},
                    ],
                }
            ],
        },
        {
            "title": "Pune Pedal Fest",
            "date": "2026-11-08",
            "location": "Pune, Maharashtra, India",
            "category": "cycling",
            "image": placeholder,
            "description": "A friendly community cycling event with a scenic route and a welcoming finish village.",
            "distance": "50 km",
            "participants": 0,
            "maxParticipants": 1000,
            "organizer": "Pune Pedal Collective",
            "rules": ["Approved helmet required at all times.", "Carry a mobile phone and basic repair kit."],
            "upi": {"id": "racepass.pune@upi", "payee": "Pune Pedal Collective"},
            "categories": [
                {
                    "name": "50K Ride",
                    "distance": "50 km",
                    "tickets": [
                        {"name": "Standard", "price": 79900, "description": "Ride entry, timing, and finisher medal", "available": 1000}
                    ],
                }
            ],
        },
        {
            "title": "Mysuru Marathon 2027",
            "date": "2027-01-17",
            "location": "Mysuru, Karnataka, India",
            "category": "running",
            "image": placeholder,
            "description": "Choose your distance and run through the heritage streets of Mysuru with the community.",
            "distance": "Multiple distances",
            "participants": 0,
            "maxParticipants": 3000,
            "organizer": "Mysuru Runners Club",
            "rules": ["Bibs must be visible at all times.", "Respect volunteers, fellow runners, and the course."],
            "upi": {"id": "mysururunners@upi", "payee": "Mysuru Runners Club"},
            "categories": [
                {
                    "name": "5K",
                    "distance": "5 km",
                    "tickets": [{"name": "Regular", "price": 49900, "description": "Race entry and finisher medal", "available": 1000}],
                },
                {
                    "name": "10K",
                    "distance": "10 km",
                    "tickets": [{"name": "Regular", "price": 79900, "description": "Race entry and finisher medal", "available": 1500}],
                },
                {
                    "name": "Half Marathon",
                    "distance": "21.1 km",
                    "tickets": [{"name": "Regular", "price": 129900, "description": "Race entry and finisher medal", "available": 500}],
                },
            ],
        },
    ]


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


def _stable_uuid(name: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, name)


def _seed_if_empty(db: Session) -> None:
    events_count = db.scalar(select(func.count()).select_from(Event))
    if events_count and events_count > 0:
        return

    for e in _events_seed():
        org_name = e["organizer"]
        org_id = _stable_uuid(f"org:{org_name}")
        org = db.get(Organization, org_id)
        if org is None:
            org = Organization(
                id=org_id,
                name=org_name,
                description=None,
                website=None,
                logo_url=None,
                created_by=None,
                status="active",
                fee_type="none",
                fee_value_paise=0,
                fee_percentage_basis_points=0,
            )
            db.add(org)
            db.flush()

        location = e["location"]
        parts = [part.strip() for part in location.split(",")]
        city = parts[0] if parts else None
        state = parts[1] if len(parts) > 1 else None
        country = parts[2] if len(parts) > 2 else "India"

        event_id = _stable_uuid(f"event:{e['title']}")
        start_date = dt.datetime.combine(dt.date.fromisoformat(e["date"]), dt.time(0, 0))
        event = Event(
            id=event_id,
            organization_id=org.id,
            name=e["title"],
            description=e["description"],
            category=e["category"],
            location_name=location,
            address=None,
            city=city,
            state=state,
            country=country,
            latitude=None,
            longitude=None,
            banner_url=e["image"],
            start_date=start_date,
            end_date=None,
            registration_open=None,
            registration_close=None,
            max_participants=e["maxParticipants"],
            status="published",
            distance=e["distance"],
            participants=e["participants"],
            rules=e["rules"],
        )
        db.add(event)
        db.flush()

        for category_data in e["categories"]:
            category = EventCategory(
                id=_stable_uuid(f"category:{e['title']}:{category_data['name']}"),
                event_id=event.id,
                name=category_data["name"],
                distance=category_data["distance"],
                description=None,
                age_min=None,
                age_max=None,
                gender=None,
            )
            db.add(category)
            db.flush()
            for ticket_data in category_data["tickets"]:
                db.add(
                    Ticket(
                        id=_stable_uuid(f"ticket:{e['title']}:{category_data['name']}:{ticket_data['name']}"),
                        event_id=event.id,
                        category_id=category.id,
                        name=ticket_data["name"],
                        description=ticket_data["description"],
                        price=ticket_data["price"],
                        currency="INR",
                        quantity_total=ticket_data["available"],
                        quantity_sold=0,
                        quantity_reserved=0,
                        sale_start=None,
                        sale_end=None,
                        max_per_user=1,
                        is_active=True,
                    )
                )

        db.add(
            EventPaymentSettings(
                id=_stable_uuid(f"payment-settings:{e['title']}"),
                event_id=event.id,
                method="manual_upi",
                upi_id=e["upi"]["id"],
                payee_name=e["upi"]["payee"],
                instructions="Pay the exact amount using UPI, then submit your UTR/reference for organizer verification.",
                qr_image_url=None,
                is_active=True,
            )
        )

    db.commit()


@app.on_event("startup")
def on_startup() -> None:
    try:
        _run_migrations()
    except ModuleNotFoundError:
        if settings.is_production:
            raise
        from db import Base

        Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if not settings.is_production:
            _seed_if_empty(db)


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
def list_events(db: Session = Depends(get_db)) -> list[Event]:
    return list(
        db.scalars(
            select(Event)
            .options(selectinload(Event.organization), selectinload(Event.tickets))
            .order_by(Event.start_date)
        )
    )


@app.get("/events/{event_id}", response_model=EventOut)
def get_event(event_id: str, db: Session = Depends(get_db)) -> Event:
    try:
        event_uuid = uuid.UUID(event_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid event id") from exc
    event = db.scalar(
        select(Event)
        .options(selectinload(Event.organization), selectinload(Event.tickets))
        .where(Event.id == event_uuid)
    )
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return event
