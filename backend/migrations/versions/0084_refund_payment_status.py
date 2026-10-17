"""Correct historical partial refunds labelled as fully refunded.

Outside-platform/manual audit records are intentionally not reclassified.
"""
from alembic import op

revision = "0084_refund_payment_status"
down_revision = "0083_organizer_application_recovery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE registrations
        SET payment_status = 'partially_refunded'
        WHERE payment_status = 'refunded'
          AND (SELECT COALESCE(SUM(r.approved_refund_amount), 0)
               FROM refunds r WHERE r.registration_id = registrations.id
               AND r.status = 'REFUNDED' AND r.is_manual_refund = false) > 0
          AND (SELECT COALESCE(SUM(r.approved_refund_amount), 0)
               FROM refunds r WHERE r.registration_id = registrations.id
               AND r.status = 'REFUNDED')
              < COALESCE(NULLIF(participant_total_paise, 0), total_amount_paise)
          AND NOT EXISTS (
              SELECT 1 FROM payments p
              JOIN checkout_payments c ON c.event_order_id = p.order_id
              JOIN cashfree_payment_resolutions cr ON cr.checkout_payment_id = c.id
              WHERE p.registration_id = registrations.id AND cr.status = 'REFUNDED'
          )
    """)


def downgrade() -> None:
    # A data correction must not recreate inaccurate financial statuses.
    pass
