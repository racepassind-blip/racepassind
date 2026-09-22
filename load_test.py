#!/usr/bin/env python3
"""
SportPass batch-registration load test
=======================================
Tests POST /api/v1/registrations/batch with concurrent virtual users.

Usage
-----
# Run with defaults (20 users, 5 requests each against local dev)
python3 load_test.py

# Hit production, 50 concurrent users, 10 requests each
python3 load_test.py --url https://api.sportpassindia.com --users 50 --requests 10

# Test a specific event/ticket
python3 load_test.py --event-id <uuid> --ticket-id <uuid>

Requirements: pip install httpx   (already installed in the venv)
"""

import argparse
import asyncio
import statistics
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

import httpx

# ── defaults ────────────────────────────────────────────────────────────────

DEFAULT_BASE_URL   = "http://127.0.0.1:8010"
DEFAULT_EVENT_ID   = ""   # fill in or pass --event-id
DEFAULT_TICKET_ID  = ""   # fill in or pass --ticket-id
CONCURRENCY        = 20
REQUESTS_PER_USER  = 5
REQUEST_TIMEOUT    = 30.0   # seconds per individual request

# ── result tracking ──────────────────────────────────────────────────────────

@dataclass
class Result:
    user_id: int
    request_num: int
    status_code: int
    elapsed_ms: float
    error: Optional[str] = None
    email_status: Optional[str] = None


@dataclass
class Summary:
    results: list[Result] = field(default_factory=list)

    def add(self, r: Result):
        self.results.append(r)

    def print(self):
        total       = len(self.results)
        successes   = [r for r in self.results if r.status_code == 201]
        failures    = [r for r in self.results if r.status_code != 201]
        errors      = [r for r in self.results if r.error]
        times       = [r.elapsed_ms for r in self.results]
        email_stats = {}
        for r in successes:
            k = r.email_status or "unknown"
            email_stats[k] = email_stats.get(k, 0) + 1

        print("\n" + "═" * 60)
        print("  LOAD TEST RESULTS")
        print("═" * 60)
        print(f"  Total requests   : {total}")
        print(f"  ✓ Successes (201): {len(successes)}  ({len(successes)/total*100:.1f}%)")
        print(f"  ✗ Failures       : {len(failures)}  ({len(failures)/total*100:.1f}%)")
        print(f"  ✗ Errors         : {len(errors)}")
        print()
        if times:
            print(f"  Latency (ms)")
            print(f"    min  : {min(times):.0f}")
            print(f"    p50  : {statistics.median(times):.0f}")
            print(f"    p95  : {_percentile(times, 95):.0f}")
            print(f"    p99  : {_percentile(times, 99):.0f}")
            print(f"    max  : {max(times):.0f}")
        print()
        print(f"  Email status breakdown: {email_stats}")
        print()
        if failures:
            print("  Failed status codes:")
            code_counts: dict[int, int] = {}
            for r in failures:
                code_counts[r.status_code] = code_counts.get(r.status_code, 0) + 1
            for code, count in sorted(code_counts.items()):
                print(f"    HTTP {code}: {count}×")
        if errors:
            print()
            print("  Sample errors:")
            for r in errors[:5]:
                print(f"    user={r.user_id} req={r.request_num}: {r.error}")
        print("═" * 60)


def _percentile(data: list[float], p: int) -> float:
    sorted_data = sorted(data)
    idx = int(len(sorted_data) * p / 100)
    return sorted_data[min(idx, len(sorted_data) - 1)]


# ── CSRF helper ──────────────────────────────────────────────────────────────

async def get_csrf_token(client: httpx.AsyncClient, base_url: str) -> str:
    """Fetch a CSRF token and store the cookie on the client."""
    resp = await client.get(f"{base_url}/api/v1/auth/csrf")
    resp.raise_for_status()
    token = resp.json().get("csrfToken", "")
    if not token:
        # Fall back to reading the cookie directly
        token = client.cookies.get("racepass_csrf", "")
    return token


# ── payload builder ──────────────────────────────────────────────────────────

def _random_name() -> str:
    import random, string
    return "Test " + "".join(random.choices(string.ascii_uppercase, k=6))

def _random_email() -> str:
    return f"loadtest+{uuid.uuid4().hex[:8]}@example.com"

def _random_phone() -> str:
    import random
    return f"9{random.randint(100000000, 999999999)}"

def build_payload(event_id: str, ticket_id: str) -> dict:
    return {
        "event_id": event_id,
        "entries": [
            {
                "ticket_id": ticket_id,
                "email": _random_email(),
                "phone": _random_phone(),
                "participants": [
                    {
                        "responses": {
                            "full_name": _random_name(),
                            "email": _random_email(),
                            "phone": _random_phone(),
                        }
                    }
                ],
                "selections": {},
            }
        ],
    }


# ── virtual user ─────────────────────────────────────────────────────────────

async def virtual_user(
    user_id: int,
    base_url: str,
    event_id: str,
    ticket_id: str,
    n_requests: int,
    summary: Summary,
    semaphore: asyncio.Semaphore,
):
    async with httpx.AsyncClient(
        timeout=REQUEST_TIMEOUT,
        follow_redirects=True,
    ) as client:
        # Each virtual user gets its own CSRF token (own cookie jar)
        try:
            csrf_token = await get_csrf_token(client, base_url)
        except Exception as exc:
            for i in range(n_requests):
                summary.add(Result(user_id=user_id, request_num=i+1, status_code=0,
                                   elapsed_ms=0, error=f"CSRF fetch failed: {exc}"))
            return

        for i in range(n_requests):
            payload = build_payload(event_id, ticket_id)
            headers = {
                "X-CSRF-Token": csrf_token,
                "Idempotency-Key": str(uuid.uuid4()),
                "Content-Type": "application/json",
            }
            async with semaphore:
                start = time.perf_counter()
                try:
                    resp = await client.post(
                        f"{base_url}/api/v1/registrations/batch",
                        json=payload,
                        headers=headers,
                    )
                    elapsed_ms = (time.perf_counter() - start) * 1000
                    email_status = None
                    if resp.status_code == 201:
                        try:
                            email_status = resp.json().get("emailStatus")
                        except Exception:
                            pass
                    summary.add(Result(
                        user_id=user_id,
                        request_num=i + 1,
                        status_code=resp.status_code,
                        elapsed_ms=elapsed_ms,
                        email_status=email_status,
                    ))
                except httpx.TimeoutException as exc:
                    elapsed_ms = (time.perf_counter() - start) * 1000
                    summary.add(Result(user_id=user_id, request_num=i+1, status_code=0,
                                       elapsed_ms=elapsed_ms, error=f"Timeout: {exc}"))
                except Exception as exc:
                    elapsed_ms = (time.perf_counter() - start) * 1000
                    summary.add(Result(user_id=user_id, request_num=i+1, status_code=0,
                                       elapsed_ms=elapsed_ms, error=str(exc)))


# ── main ─────────────────────────────────────────────────────────────────────

async def run(base_url: str, event_id: str, ticket_id: str, concurrency: int, n_requests: int):
    summary = Summary()
    # Semaphore caps max simultaneous in-flight requests
    semaphore = asyncio.Semaphore(concurrency)

    print(f"\nLoad test: {base_url}")
    print(f"  Event  : {event_id}")
    print(f"  Ticket : {ticket_id}")
    print(f"  Users  : {concurrency}  ×  {n_requests} requests = {concurrency * n_requests} total")
    print()

    wall_start = time.perf_counter()

    tasks = [
        virtual_user(
            user_id=uid,
            base_url=base_url,
            event_id=event_id,
            ticket_id=ticket_id,
            n_requests=n_requests,
            summary=summary,
            semaphore=semaphore,
        )
        for uid in range(1, concurrency + 1)
    ]
    await asyncio.gather(*tasks)

    wall_elapsed = time.perf_counter() - wall_start
    total = concurrency * n_requests
    rps = total / wall_elapsed if wall_elapsed > 0 else 0
    print(f"  Wall time: {wall_elapsed:.2f}s  →  {rps:.1f} req/s throughput")

    summary.print()


def main():
    parser = argparse.ArgumentParser(description="SportPass batch-registration load test")
    parser.add_argument("--url",       default=DEFAULT_BASE_URL,  help="API base URL")
    parser.add_argument("--event-id",  default=DEFAULT_EVENT_ID,  help="Event UUID to register into")
    parser.add_argument("--ticket-id", default=DEFAULT_TICKET_ID, help="Ticket UUID to use")
    parser.add_argument("--users",     type=int, default=CONCURRENCY,       help="Concurrent virtual users")
    parser.add_argument("--requests",  type=int, default=REQUESTS_PER_USER, help="Requests per user")
    args = parser.parse_args()

    if not args.event_id or not args.ticket_id:
        parser.error(
            "Provide --event-id and --ticket-id.\n"
            "  Example: python3 load_test.py "
            "--event-id c2cec4d6-9504-43d2-9961-2c6798f1ef56 "
            "--ticket-id <ticket-uuid>"
        )

    asyncio.run(run(
        base_url=args.url,
        event_id=args.event_id,
        ticket_id=args.ticket_id,
        concurrency=args.users,
        n_requests=args.requests,
    ))


if __name__ == "__main__":
    main()
