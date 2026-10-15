from __future__ import annotations

import datetime as dt
import unittest
from uuid import UUID

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.services.announcement_service import create_announcement, list_public_announcements, update_announcement
from db import Base
from models import Event, EventAnnouncement, Organization, User


class AnnouncementServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.admin = User(name="Admin", email="admin@example.test", password_hash="hash", role="admin")
        self.organization = Organization(name="SportPass Test")
        self.db.add_all([self.admin, self.organization])
        self.db.flush()
        self.event = Event(
            organization_id=self.organization.id,
            name="Test Run",
            description="A test event",
            category="running",
            max_participants=100,
            status="published",
            distance="5K",
            rules=[],
        )
        self.db.add(self.event)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_drafts_are_private_and_published_are_public(self):
        draft = create_announcement(self.db, self.admin, self.event.id, title="Draft", body="Private")
        self.db.commit()
        self.assertEqual(draft["status"], "DRAFT")
        self.assertEqual(list_public_announcements(self.db, self.event.id)["announcements"], [])
        published = create_announcement(self.db, self.admin, self.event.id, title="Route update", body="Use the north gate", status="PUBLISHED")
        self.db.commit()
        result = list_public_announcements(self.db, self.event.id)
        self.assertEqual([item["id"] for item in result["announcements"]], [published["id"]])

    def test_pinning_is_exclusive_and_corrections_are_audited(self):
        first = create_announcement(self.db, self.admin, self.event.id, title="First", body="One", status="PUBLISHED", is_pinned=True)
        second = create_announcement(self.db, self.admin, self.event.id, title="Second", body="Two", status="PUBLISHED", is_pinned=True)
        self.db.commit()
        rows = list(self.db.query(EventAnnouncement).all())
        self.assertFalse(next(row for row in rows if str(row.id) == first["id"]).is_pinned)
        self.assertTrue(next(row for row in rows if str(row.id) == second["id"]).is_pinned)
        corrected = update_announcement(self.db, self.admin, self.event.id, UUID(second["id"]), body="Updated")
        self.db.commit()
        self.assertEqual(corrected["body"], "Updated")

    def test_archived_event_cannot_schedule(self):
        self.event.archived_at = dt.datetime.now(dt.timezone.utc)
        self.db.commit()
        with self.assertRaises(ValueError):
            create_announcement(self.db, self.admin, self.event.id, title="Later", body="No", status="SCHEDULED", scheduled_for=dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1))

    def test_published_announcement_can_be_hidden_and_restored(self):
        published = create_announcement(self.db, self.admin, self.event.id, title="Gate update", body="Use gate B", status="PUBLISHED")
        self.db.commit()
        hidden = update_announcement(self.db, self.admin, self.event.id, UUID(published["id"]), status="ARCHIVED")
        self.db.commit()
        self.assertEqual(hidden["status"], "ARCHIVED")
        self.assertEqual(list_public_announcements(self.db, self.event.id)["announcements"], [])
        restored = update_announcement(self.db, self.admin, self.event.id, UUID(published["id"]), status="PUBLISHED")
        self.db.commit()
        self.assertEqual(restored["status"], "PUBLISHED")
        self.assertEqual(len(list_public_announcements(self.db, self.event.id)["announcements"]), 1)

    def test_published_announcement_cannot_be_moved_to_draft(self):
        published = create_announcement(self.db, self.admin, self.event.id, title="Gate update", body="Use gate B", status="PUBLISHED")
        with self.assertRaises(ValueError):
            update_announcement(self.db, self.admin, self.event.id, UUID(published["id"]), status="DRAFT")


if __name__ == "__main__":
    unittest.main()
