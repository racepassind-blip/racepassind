from __future__ import annotations
import unittest
import uuid
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.services.credit_service import CreditValidationError, add_credits, approve_topup, debit_credits, get_balance, request_topup, settle_event_credits, CREDIT_TOPUP, CREDIT_MANUAL_EVENT_DEBIT
from db import Base
from models import CreditTransaction, Event, Order, Organization, OrganizerCreditAccount, Participant, Payment, Registration, Ticket

class CreditServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.organization_id = uuid.uuid4()

    def test_add_and_debit_write_balanced_ledger(self):
        with Session(self.engine) as db:
            self.assertEqual(get_balance(db, self.organization_id), 0)
            add_credits(db, organization_id=self.organization_id, amount=10000, transaction_type=CREDIT_TOPUP, description="Test top-up")
            debit_credits(db, organization_id=self.organization_id, amount=2500, transaction_type=CREDIT_MANUAL_EVENT_DEBIT, description="Test debit")
            db.commit()
            self.assertEqual(get_balance(db, self.organization_id), 7500)
            rows = db.scalars(select(CreditTransaction)).all()
            self.assertEqual(sorted((row.balance_before_paise, row.balance_after_paise) for row in rows), [(0, 10000), (10000, 7500)])

    def test_negative_balance_is_rejected_without_ledger_entry(self):
        with Session(self.engine) as db:
            with self.assertRaises(CreditValidationError):
                debit_credits(db, organization_id=self.organization_id, amount=1, transaction_type=CREDIT_MANUAL_EVENT_DEBIT, description="Too much")
            self.assertEqual(db.scalars(select(CreditTransaction)).all(), [])

    def test_zero_and_fractional_paise_are_rejected(self):
        with Session(self.engine) as db:
            with self.assertRaises(CreditValidationError):
                add_credits(db, organization_id=self.organization_id, amount=0, description="zero")

    def test_topup_requires_approval_and_approved_utr_cannot_be_reused(self):
        with Session(self.engine) as db:
            request = request_topup(db, organization_id=self.organization_id, amount_paise=50000, utr_reference="UTR-1")
            self.assertEqual(get_balance(db, self.organization_id), 0)
            approve_topup(db, request_id=request.id, approved_by=uuid.uuid4())
            db.commit()
            self.assertEqual(get_balance(db, self.organization_id), 50000)
            with self.assertRaises(CreditValidationError):
                request_topup(db, organization_id=self.organization_id, amount_paise=50000, utr_reference="UTR-1")

    def test_topup_utr_is_canonicalized_case_insensitively(self):
        with Session(self.engine) as db:
            request = request_topup(db, organization_id=self.organization_id, amount_paise=50000, utr_reference="  abc123  ")
            self.assertEqual(request.utr_reference, "ABC123")
            with self.assertRaises(CreditValidationError):
                request_topup(db, organization_id=self.organization_id, amount_paise=50000, utr_reference="abc123")

    def test_registration_debit_source_is_idempotent(self):
        with Session(self.engine) as db:
            add_credits(db, organization_id=self.organization_id, amount=5000, description="seed")
            first = debit_credits(db, organization_id=self.organization_id, amount=3200, transaction_type="REGISTRATION_DEBIT", description="registration", source_type="REGISTRATION", source_id="reg-1")
            second = debit_credits(db, organization_id=self.organization_id, amount=3200, transaction_type="REGISTRATION_DEBIT", description="retry", source_type="REGISTRATION", source_id="reg-1")
            self.assertEqual(first.id, second.id)
            self.assertEqual(get_balance(db, self.organization_id), 1800)

    def test_idempotency_source_rejects_conflicting_ledger_data(self):
        with Session(self.engine) as db:
            add_credits(db, organization_id=self.organization_id, amount=5000, description="seed")
            debit_credits(db, organization_id=self.organization_id, amount=1000, transaction_type="REGISTRATION_DEBIT", description="registration", source_type="REGISTRATION", source_id="reg-1")
            with self.assertRaises(CreditValidationError):
                debit_credits(db, organization_id=self.organization_id, amount=1200, transaction_type="REGISTRATION_DEBIT", description="conflict", source_type="REGISTRATION", source_id="reg-1")
            self.assertEqual(get_balance(db, self.organization_id), 4000)

    def test_database_constraint_rejects_negative_account_balance(self):
        with Session(self.engine) as db:
            get_balance(db, self.organization_id)
            account = db.scalar(select(OrganizerCreditAccount).where(OrganizerCreditAccount.organization_id == self.organization_id))
            account.balance_paise = -1
            with self.assertRaises(IntegrityError):
                db.commit()

    def test_manual_settlement_cannot_debit_credits(self):
        with Session(self.engine) as db:
            organization = Organization(name="Association", status="active", credit_deduction_mode="MANUAL_EVENT_SETTLEMENT")
            db.add(organization)
            db.flush()
            event = Event(organization_id=organization.id, name="Championship", description="Test", category="running", max_participants=100, status="published", distance="5k", rules=[])
            db.add(event)
            db.flush()
            ticket = Ticket(event_id=event.id, name="Entry", description="Test", price=50000, currency="INR", quantity_total=100)
            db.add(ticket)
            db.flush()
            for gateway, fee in (("manual_upi", 2000), ("cashfree", 3200)):
                participant = Participant(name=gateway)
                db.add(participant)
                db.flush()
                registration = Registration(event_id=event.id, participant_id=participant.id, ticket_id=ticket.id, status="confirmed", payment_status="approved", total_amount_paise=50000, platform_fee_paise=fee, participant_total_paise=50000)
                db.add(registration)
                db.flush()
                order = Order(total_amount=500, total_amount_paise=50000, currency="INR", status="paid")
                db.add(order)
                db.flush()
                db.add(Payment(order_id=order.id, registration_id=registration.id, amount=500, expected_amount_paise=50000, method=gateway, currency="INR", payment_gateway=gateway, status="approved"))
            add_credits(db, organization_id=organization.id, amount=10000, description="seed")
            with self.assertRaisesRegex(CreditValidationError, "disabled"):
                settle_event_credits(db, event_id=event.id, created_by=uuid.uuid4())
            db.commit()
            self.assertEqual(get_balance(db, organization.id), 10000)
