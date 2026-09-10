from __future__ import annotations

import os
import sys

from sqlalchemy import select

from app.services.auth_service import hash_password, normalize_email
from db import SessionLocal
from models import User


def main() -> int:
    if os.getenv("ENVIRONMENT", "development").strip().lower() == "production":
        print("Refusing to create a local admin in production; use the deployment onboarding process.", file=sys.stderr)
        return 1

    name = os.getenv("ADMIN_NAME", "RacePass Admin").strip()
    email = normalize_email(os.getenv("ADMIN_EMAIL", ""))
    password = os.getenv("ADMIN_PASSWORD", "")
    if not email or not password:
        print("Set ADMIN_EMAIL and ADMIN_PASSWORD in the shell before running this command.", file=sys.stderr)
        return 2

    with SessionLocal() as db:
        existing = db.scalar(select(User).where(User.normalized_email == email))
        if existing is not None:
            print("An account with that email already exists.", file=sys.stderr)
            return 3
        db.add(
            User(
                name=name,
                email=email,
                normalized_email=email,
                password_hash=hash_password(password),
                role="admin",
                is_active=True,
            )
        )
        db.commit()
    print(f"Created development admin: {email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
