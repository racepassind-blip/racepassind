"""Merchandise payment confirmation content, built from the saved order."""
from html import escape

from app.services.email_service import send_email
from app.services.email_service import SendEmailResult

MERCHANDISE_EMAILS_ENABLED = False


def build_product_order_confirmation(order):
    snapshot = order.snapshot
    reference = f"SPM-{str(order.id).replace('-', '')[:12].upper()}"
    money = lambda amount: f"₹{amount / 100:,.2f}"
    lines = [
        f"Hi {order.buyer_name},", "",
        "The organizer has approved your payment. Your merchandise order is confirmed.",
        "", f"Order number: {reference}",
        f"Store: {snapshot.get('listing_name', 'SportPass store')}", "", "Your items:",
    ]
    for item in snapshot["lines"]:
        lines.append(f"• {item['product_name']} — {item['variant_label']} × {item['quantity']} — {money(item['subtotal_paise'])}")
        if item.get("customization"):
            lines.append(f"  {item.get('customization_label') or 'Customization'}: {item['customization']}")
    lines += ["", f"Total paid: {money(snapshot['total_paise'])}"]
    address = snapshot.get("delivery_address")
    if address:
        lines += ["", "Delivery address:", address["address"],
                  f"{address['city']}, {address['district']}, {address['state']} — {address['pincode']}"]
    instructions = snapshot.get("pickup_instructions")
    if instructions:
        lines += ["", "Delivery instructions:" if address else "Pickup instructions:", instructions]
    lines += ["", "Save your order number for order help or collection.",
              f"Full order ID: {order.id}"]
    body = "\n".join(lines)
    return {
        "recipient": order.buyer_email,
        "subject": f"Payment approved — your SportPass order {reference}",
        "body": body,
        "html_body": f'<div style="font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.6">{escape(body)}</div>',
    }


def send_product_order_confirmation(db, order):
    if not MERCHANDISE_EMAILS_ENABLED:
        return SendEmailResult(False, "SKIPPED_DISABLED", "Merchandise emails are disabled")
    return send_email(db, **build_product_order_confirmation(order),
                      email_type="PRODUCT_ORDER_CONFIRMATION", reference_type="PRODUCT_ORDER",
                      reference_id=str(order.id))


def send_product_order_cancellation(db, order):
    reference = f"SPM-{str(order.id).replace('-', '')[:12].upper()}"
    body = (f"Hi {order.buyer_name},\n\nYour merchandise order {reference} has been cancelled by the organizer.\n\n"
            "Please contact the organizer if you paid for this order and need help with a refund.\n\n"
            f"Full order ID: {order.id}")
    return send_email(db, recipient=order.buyer_email, subject=f"Order cancelled — {reference}", body=body,
                      html_body=f'<div style="font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.6">{escape(body)}</div>',
                      email_type="PRODUCT_ORDER_CANCELLATION", reference_type="PRODUCT_ORDER", reference_id=str(order.id))
