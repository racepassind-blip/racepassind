from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


_DEFAULT_FRONTEND_ORIGINS = (
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:8081",
    "http://127.0.0.1:8081",
)


def _as_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _origins(value: str | None) -> tuple[str, ...]:
    if not value:
        return _DEFAULT_FRONTEND_ORIGINS
    parsed = tuple(origin.strip().rstrip("/") for origin in value.split(",") if origin.strip())
    if not parsed:
        raise ValueError("FRONTEND_ORIGINS must contain at least one origin")
    return parsed


@dataclass(frozen=True)
class Settings:
    environment: str = "development"
    database_url: str = field(default="sqlite:///./app.db", repr=False)
    auto_migrate: bool = True
    frontend_origins: tuple[str, ...] = _DEFAULT_FRONTEND_ORIGINS
    frontend_origins_configured: bool = True
    session_secret: str | None = field(default=None, repr=False)
    csrf_secret: str | None = field(default=None, repr=False)
    google_client_id: str | None = field(default=None, repr=False)
    google_client_secret: str | None = field(default=None, repr=False)
    google_redirect_uri: str | None = None
    ticket_signing_secret: str | None = field(default=None, repr=False)
    storage_mode: str = "local"
    storage_endpoint: str | None = field(default=None, repr=False)
    storage_bucket: str | None = None
    storage_region: str = "auto"
    storage_access_key: str | None = field(default=None, repr=False)
    storage_secret_key: str | None = field(default=None, repr=False)
    storage_local_root: str = ".storage"
    storage_public_base_url: str = "http://localhost:8000"
    storage_signed_url_ttl_seconds: int = 900
    storage_max_upload_bytes: int = 2_000_000
    storage_max_dimension: int = 4096

    @classmethod
    def from_environment(cls) -> "Settings":
        raw_origins = os.getenv("FRONTEND_ORIGINS")
        return cls(
            environment=os.getenv("ENVIRONMENT", "development").strip().lower(),
            database_url=os.getenv("DATABASE_URL", "sqlite:///./app.db"),
            auto_migrate=_as_bool(os.getenv("AUTO_MIGRATE"), default=True),
            frontend_origins=_origins(raw_origins),
            frontend_origins_configured=bool(raw_origins and _origins(raw_origins)),
            session_secret=os.getenv("SESSION_SECRET"),
            csrf_secret=os.getenv("CSRF_SECRET"),
            google_client_id=os.getenv("GOOGLE_CLIENT_ID"),
            google_client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
            google_redirect_uri=os.getenv("GOOGLE_REDIRECT_URI"),
            ticket_signing_secret=os.getenv("TICKET_SIGNING_SECRET"),
            storage_mode=os.getenv("STORAGE_MODE", "local").strip().lower(),
            storage_endpoint=os.getenv("STORAGE_ENDPOINT"),
            storage_bucket=os.getenv("STORAGE_BUCKET"),
            storage_region=os.getenv("STORAGE_REGION", "auto").strip(),
            storage_access_key=os.getenv("STORAGE_ACCESS_KEY"),
            storage_secret_key=os.getenv("STORAGE_SECRET_KEY"),
            storage_local_root=os.getenv("STORAGE_LOCAL_ROOT", ".storage"),
            storage_public_base_url=os.getenv("STORAGE_PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/"),
            storage_signed_url_ttl_seconds=int(os.getenv("STORAGE_SIGNED_URL_TTL_SECONDS", "900")),
            storage_max_upload_bytes=int(os.getenv("STORAGE_MAX_UPLOAD_BYTES", "2000000")),
            storage_max_dimension=int(os.getenv("STORAGE_MAX_DIMENSION", "4096")),
        )

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    def validate_runtime(self) -> None:
        """Fail closed for production-only configuration mistakes."""
        if self.storage_mode not in {"local", "s3"}:
            raise RuntimeError("STORAGE_MODE must be either local or s3")
        if self.storage_signed_url_ttl_seconds < 60 or self.storage_signed_url_ttl_seconds > 86400:
            raise RuntimeError("STORAGE_SIGNED_URL_TTL_SECONDS must be between 60 and 86400")
        if self.storage_max_upload_bytes <= 0 or self.storage_max_dimension < 32:
            raise RuntimeError("Storage upload limits are invalid")

        if not self.is_production:
            return

        missing = [
            name
            for name, value in (
                ("DATABASE_URL", self.database_url),
                ("SESSION_SECRET", self.session_secret),
                ("CSRF_SECRET", self.csrf_secret),
                ("TICKET_SIGNING_SECRET", self.ticket_signing_secret),
                ("FRONTEND_ORIGINS", self.frontend_origins_configured),
                ("STORAGE_ENDPOINT", self.storage_endpoint),
                ("STORAGE_BUCKET", self.storage_bucket),
                ("STORAGE_REGION", self.storage_region),
                ("STORAGE_ACCESS_KEY", self.storage_access_key),
                ("STORAGE_SECRET_KEY", self.storage_secret_key),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(f"Missing required production configuration: {', '.join(missing)}")
        if self.database_url.startswith("sqlite"):
            raise RuntimeError("Production must use PostgreSQL; SQLite is development-only")
        if self.storage_mode != "s3":
            raise RuntimeError("Production must use S3-compatible object storage")
        if self.auto_migrate:
            raise RuntimeError("Production migrations must run as an explicit release command")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings.from_environment()
    settings.validate_runtime()
    return settings
