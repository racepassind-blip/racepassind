# RacePass India POC — Requirements

**Status:** Ready for technical design
**Version:** 0.2
**Purpose:** Define the smallest public, multi-organizer RacePass product that proves real race discovery, registration, manual UPI payment, organizer verification, ticket generation, and race-day check-in without integrating a payment gateway.

---

# 1. Product Outcome

RacePass is a race-registration platform for Indian running and cycling communities.

Organizers create and manage races.

Participants discover races, register, pay the organizer directly through UPI, submit their payment reference, and receive a RacePass registration record.

Organizers verify payments and manage participants.

The POC must prove this complete journey:

1. An admin onboards an organizer.
2. An organizer creates an event.
3. The organizer creates one or more race categories/distances.
4. The organizer creates ticket tiers for those race categories.
5. The organizer configures their UPI payment details.
6. The organizer publishes the event.
7. A runner discovers the event through the public Explore page.
8. The runner chooses a race category and ticket.
9. The runner registers without being required to create an account.
10. RacePass creates the registration and shows payment instructions.
11. RacePass shows either:

* a RacePass-generated UPI QR code, or
* the organizer's uploaded QR code.

12. The runner pays the organizer directly through their UPI app.
13. The runner optionally submits the UTR/payment reference.
14. The registration remains pending until the organizer verifies the payment.
15. The organizer approves or rejects the payment.
16. Approval confirms the registration and generates a QR ticket.
17. The runner can later access or claim the registration.
18. The organizer can export registrations and check in participants using the QR ticket.

---

# 2. Core Product Model

RacePass shall follow this hierarchy:

```text
Organizer
    ↓
Event
    ↓
Race Category
    ↓
Ticket Tier
    ↓
Registration
    ↓
Payment
    ↓
Ticket / Check-In
```

Example:

```text
Mysuru Marathon 2026
    │
    ├── 5K
    │    ├── Early Bird - ₹499
    │    └── Regular - ₹599
    │
    ├── 10K
    │    ├── Early Bird - ₹799
    │    └── Regular - ₹999
    │
    └── Half Marathon
         └── Regular - ₹1,299
```

An event may therefore contain multiple race distances/categories.

Distance shall NOT be treated as a single mandatory property of the entire event.

---

# 3. POC Boundaries

## Included

The POC includes:

* Public event discovery.
* Running and cycling events.
* Multiple organizers in the database and authorization model.
* Admin, organizer, and participant roles.
* Admin-controlled organizer onboarding.
* Organizer event creation.
* Event publishing.
* Multiple race categories/distances within an event.
* Ticket tiers under each race category.
* Ticket pricing in INR.
* Ticket capacity.
* Manual UPI payments.
* RacePass-generated UPI QR codes.
* Organizer-uploaded UPI QR codes.
* Guest registration.
* Participant registration using email and/or phone.
* Manual UTR/payment-reference submission.
* Organizer payment approval/rejection.
* Registration confirmation.
* Participant account creation using email/password.
* Participant sign-in with Google OAuth.
* Guest registration claiming through secure authenticated contact matching and/or a claim mechanism.
* Admin-configurable organizer fee settings supporting fixed or percentage fees, defaulting to zero.
* Participant registration history.
* QR tickets.
* Organizer registration management.
* CSV export.
* QR/reference-based check-in.
* Basic audit records.
* English-language UI.
* Indian locations.
* INR currency.
* India-friendly phone numbers.
* Responsive web application.

---

# 4. Explicitly Excluded From the POC

The following shall NOT be part of the initial POC:

* Razorpay.
* Stripe.
* Cashfree.
* PayU.
* Other merchant payment gateways.
* Automatic UPI payment verification.
* Automatic organizer payouts.
* Platform settlement and organizer payout automation.
* RacePass commission collection in the POC.
* Automatic fee deduction from participant payments.
* GST/tax accounting.
* Refund automation.
* Coupons.
* Promo codes.
* Phone OTP authentication.
* SMS notifications.
* Transactional email workflows unless later required.
* Group registrations.
* Team registration management.
* Multiple participants in a single checkout.
* Subscription plans.
* Race timing integrations.
* Race results.
* Certificates.
* Advanced analytics.
* Live maps.
* Native Android application.
* Native iOS application.
* Multilingual UI.
* Public organizer self-registration.
* Advanced document management.

The database may be designed so these features can be added later without major redesign.

---

# 5. Registration Quantity Decision

The registration schema may contain:

```text
quantity
```

for future support.

For the POC:

```text
quantity = 1
```

shall always be enforced.

The frontend shall NOT allow the participant to select more than one ticket.

The backend shall also enforce:

```text
quantity == 1
```

for all POC registrations.

Therefore:

```text
1 Registration
=
1 Participant
=
1 Race Category
=
1 Ticket
=
1 QR Ticket
```

The field remains in the schema only to avoid unnecessary schema changes when group registration is introduced later.

---

# 6. Actors and Permissions

## 6.1 Public Visitor

A public visitor can:

* Browse published events.
* Search events.
* Filter events.
* View event details.
* View race categories.
* View ticket prices.
* Start registration.

A public visitor cannot:

* View participant information.
* View organizer-private information.
* View another participant's registration.
* View payment references.
* Access organizer tools.
* Access admin tools.

---

## 6.2 Guest Participant

A guest participant can:

* Register without creating an account.
* Provide email.
* Provide phone.
* Provide both email and phone.
* View the registration confirmation immediately.
* View payment instructions.
* View the UPI QR.
* Add/update a payment reference while the registration is eligible.
* Receive a human-readable registration reference.
* Receive a private registration claim code/token.

At least one contact method is required:

```text
email OR phone
```

A guest cannot retrieve registrations using only an email address or phone number.

---

## 6.3 Authenticated Participant

A participant can:

* Create an account using email/password.
* Sign in.
* Sign out.
* View registrations linked to their account.
* Claim a previous guest registration.
* View payment status.
* View registration status.
* View confirmed QR tickets.
* View upcoming races.
* View previous registrations.

Participants can access only their own registrations.

---

## 6.4 Organizer

An organizer can manage only their organization.

An organizer can:

* View organizer dashboard.
* Create events.
* Edit their events.
* Create race categories.
* Create ticket tiers.
* Configure UPI information.
* Upload an optional QR image.
* Publish events.
* Unpublish events.
* View registrations.
* Search registrations.
* Filter registrations.
* View submitted UTR/payment references.
* Approve payment.
* Reject payment.
* Export registrations.
* Check participants in.

An organizer cannot:

* Manage another organizer.
* Edit another organizer's events.
* View another organizer's participants.
* View another organizer's payments.
* Check participants into another organizer's events.

All organizer ownership checks must happen on the backend.

---

## 6.5 RacePass Admin

An admin can:

* Create organizers.
* Activate/deactivate organizers.
* View all events.
* View all registrations.
* View organizer activity.
* Support payment approval/rejection when required.
* Manage platform-level configuration.

Public organizer signup is not part of the POC.

---

# 7. Event Structure

## FR-1: Public Explore

The system shall display published races on a public Explore page.

Each event card should display:

* Event name.
* Sport.
* Date.
* City.
* Location.
* Organizer.
* Available race categories/distances.
* Starting ticket price.
* Registration status.
* Event banner where available.

Users should be able to search/filter by:

* Text.
* Sport.
* City.
* Date.

Only events where:

```text
status = published
```

shall be publicly visible.

Draft, inactive, archived, or deleted events shall not appear publicly.

Initial demo data shall use Indian running and cycling events.

---

# 8. Event Management

## FR-2: Event Setup

An authorized organizer can create an event.

The event shall contain:

* Event name.
* Description.
* Sport.
* Event date.
* Venue/location.
* City.
* State.
* Banner/image.
* Registration opening date.
* Registration closing date.
* Overall participant capacity where applicable.
* Event rules.
* Organizer information.
* Status.

Suggested statuses:

```text
draft
published
closed
cancelled
completed
```

An organizer may save an incomplete event as:

```text
draft
```

Publishing requires mandatory fields to be valid.

---

# 9. Race Categories

An event shall contain one or more race categories.

Examples:

```text
5K
10K
Half Marathon
Full Marathon
25 KM Cycling
50 KM Cycling
100 KM Cycling
```

A race category should contain:

* Category name.
* Distance.
* Distance unit.
* Description.
* Capacity where applicable.
* Minimum age where applicable.
* Maximum age where applicable.
* Start time where applicable.
* Status.

Suggested distance units:

```text
km
m
```

Race categories belong to exactly one event.

---

# 10. Ticket Tiers

Each race category may contain one or more ticket tiers.

Examples:

```text
Early Bird
Regular
Late Registration
Student
```

Ticket tiers shall contain:

* Ticket name.
* Race category.
* Price.
* Currency.
* Quantity/capacity.
* Sale start date.
* Sale end date.
* Status.

Currency for the POC:

```text
INR
```

The server shall always determine the ticket price.

Frontend-submitted totals shall never be trusted.

---

# 11. Registration

## FR-3: Registration

A runner shall select:

```text
Event
→ Race Category
→ Ticket Tier
```

The registration form shall collect at minimum:

* Participant full name.
* Email when available.
* Phone when available.
* Date of birth OR age.
* Gender.
* Emergency contact name.
* Emergency contact phone.
* Jersey size.
* Optional team/club name.

At least one shall be mandatory:

```text
email OR phone
```

Quantity shall exist in the data model but shall always be:

```text
1
```

for the POC.

The server shall calculate:

```text
registration_amount = selected_ticket_price
```

The server shall validate:

* Event is published.
* Registration dates are valid.
* Race category is active.
* Ticket is active.
* Ticket sale window is valid.
* Ticket has inventory.
* Event has capacity where configured.
* Race category has capacity where configured.
* Quantity equals 1.
* Required participant data exists.

The browser must NOT be trusted for:

* Price.
* Ticket availability.
* Event status.
* Registration status.
* Payment status.
* Capacity.

---

# 12. Registration Identifiers

Every successful registration shall receive:

1. Internal database ID.
2. Human-readable registration reference.
3. Non-guessable confirmation token.
4. Registration claim code/token.

Example human-readable reference:

```text
RP-MYS-2026-00142
```

This value is for:

* Customer support.
* Organizer search.
* Check-in fallback.

It shall NOT by itself provide unrestricted public access to the registration.

The durable confirmation URL shall use an unpredictable token.

Example:

```text
/registration/confirmation/Kp8wQ7mN2xL4...
```

The token must:

* Be cryptographically random.
* Be difficult to guess.
* Contain no personal information.

---

# 13. Guest Registration Claiming

Guest registrations shall NOT be exposed through a public endpoint merely because someone types the same email address or phone number.

After a participant signs in with email/password or Google, RacePass may find eligible guest registrations by exact normalized matching on the account's verified email or phone. Matching registrations shall appear only inside the authenticated participant's account and shall not be returned to unauthenticated callers.

The system shall use a secure claim process for matched registrations. The participant may be asked to confirm the registration reference and private claim code before the registration is linked, especially when the matching contact method is not verified.

After registration, RacePass shall generate:

```text
Registration Reference
Confirmation Token
Claim Code
```

Example:

```text
Registration Reference:
RP-MYS-2026-00142

Claim Code:
7PK3M9
```

The participant may also choose:

```text
Claim Existing Registration
```

They shall provide:

```text
Registration Reference
+
Claim Code
```

If valid, RacePass shall associate the registration with the authenticated user.

Example:

```text
registration.user_id = authenticated_user.id
```

The claim process must be transactional and usable only once unless explicitly designed otherwise. A registration shall not be linked to a second account after it has been claimed.

After matching or claiming:

* The participant sees the registration in My Registrations.
* Another account cannot claim the registration.
* A public visitor still cannot discover the registration using only an email or phone number.

The technical design shall define how email verification and Google-verified email claims work, and how phone matching is safely verified before exposing private registration details.

---

# 14. Manual UPI Payment

## FR-4: UPI Configuration

An organizer shall configure:

* UPI ID.
* Payee/organization name.
* Payment instructions.

Example:

```text
UPI ID:
mysururunners@upi

Payee Name:
Mysuru Runners Club
```

The organizer may also upload:

* Static UPI QR image.

RacePass shall support BOTH:

```text
1. System-generated UPI QR
2. Organizer-uploaded UPI QR
```

---

# 15. RacePass-Generated UPI QR

RacePass may generate a UPI payment URI using the organizer's UPI ID.

Example conceptual URI:

```text
upi://pay?
pa=mysururunners@upi
&pn=Mysuru Runners Club
&am=799.00
&cu=INR
```

The actual URI must be properly URL encoded.

Where:

```text
pa = Payee UPI ID
pn = Payee Name
am = Registration Amount
cu = INR
```

RacePass shall generate a QR code from this URI.

When scanned using a compatible UPI application, the payment application should display:

* Organizer/payee.
* Amount.
* Payment confirmation screen.

The participant must manually authorize the payment.

Important:

Generating the QR does NOT mean RacePass has received or verified the payment.

The payment occurs directly:

```text
Runner
   ↓
UPI App / Bank
   ↓
Organizer UPI Account
```

RacePass does not receive the funds.

RacePass therefore continues using:

```text
UTR / Payment Reference
+
Organizer Approval
```

to confirm the registration.

---

# 16. Uploaded Organizer QR

An organizer may optionally provide their existing UPI QR image.

If provided, RacePass may display:

```text
Pay Using Organizer QR
```

This supports organizers who prefer using their existing bank/UPI QR.

The event payment settings should therefore support:

```text
UPI ID
Payee Name
Generated QR
Uploaded QR (optional)
Payment Instructions
```

UPI ID remains mandatory for manual-UPI events even when an uploaded QR exists.

---

# 17. Payment Flow

After registration creation:

```text
Registration Created
       ↓
awaiting_payment
       ↓
Show UPI Payment Instructions
       ↓
Participant Pays
       ↓
Participant optionally enters UTR
       ↓
pending_verification
       ↓
Organizer Reviews
       ↓
Approve / Reject
```

Payment amount shall always come from the backend registration record.

A participant shall never be allowed to modify the calculated amount.

---

# 18. Payment Reference / UTR

The participant may enter:

* UTR.
* Transaction/reference number.
* Optional payment note.

UTR shall initially be optional.

A participant may update the UTR while the payment is still pending.

RacePass shall record:

* Submitted UTR.
* Submission timestamp.
* Last update timestamp.

Organizer registration view shall display:

* Participant.
* Registration reference.
* Race category.
* Ticket.
* Amount.
* UTR.
* Registration date.
* Payment status.

---

# 19. Payment Status

Payment status shall use an explicit state machine.

Suggested values:

```text
pending
approved
rejected
```

Possible future statuses may be added later without changing the current flow.

---

# 20. Registration Status

Registration status shall be independent of payment status.

Suggested POC states:

```text
awaiting_payment
pending_verification
confirmed
rejected
cancelled
checked_in
```

Typical flow:

```text
Registration Created
        ↓
awaiting_payment

UTR Submitted / Payment Marked for Review
        ↓
pending_verification

Organizer Approves
        ↓
confirmed

Participant Arrives
        ↓
checked_in
```

If the organizer rejects payment:

```text
pending_verification
        ↓
rejected
```

---

# 21. Payment Approval

An organizer or admin may approve a pending payment.

Approval shall:

1. Verify organizer ownership.
2. Verify registration state.
3. Verify payment state.
4. Execute within a server-side database transaction.
5. Set:

```text
payment_status = approved
registration_status = confirmed
```

6. Finalize the ticket allocation.
7. Generate the ticket QR/token.
8. Record the approving user.
9. Record approval timestamp.

Approval must be idempotent.

Calling approve twice must NOT:

* Deduct inventory twice.
* Generate duplicate registrations.
* Generate duplicate check-ins.
* Create duplicate payment records.

---

# 22. Payment Rejection

An organizer or admin may reject a pending payment.

A rejection shall include:

```text
rejection_reason
```

Rejection shall:

* Update payment status.
* Update registration status.
* Release any temporary seat reservation.
* Not generate a confirmed ticket.
* Record actor.
* Record timestamp.
* Record reason.

---

# 23. Capacity and Reservation Policy

RacePass must protect against overselling.

Capacity may exist at:

* Event level.
* Race-category level.
* Ticket-tier level.

The backend shall enforce the configured capacity.

Confirmed registrations must never exceed available capacity.

For the POC:

A new unpaid registration may temporarily reserve inventory.

Recommended initial policy:

```text
Registration Created
        ↓
Reserve Seat
        ↓
30-minute payment window
```

If no payment reference is submitted within the reservation period:

```text
reservation expires
        ↓
seat becomes available again
```

If the participant submits the UTR/payment reference before expiry:

```text
pending_verification
```

The reservation may remain held until the organizer approves or rejects the registration.

RacePass shall NOT automatically release a seat where the participant has already submitted payment evidence without providing an organizer review path.

Reservation expiry duration should be configurable in backend configuration.

Initial default:

```text
30 minutes
```

---

# 24. Authentication

## FR-5: Authentication

* Participant account creation using email/password.
* Google OAuth sign-in for participants and authorized staff.
* Guest registration claiming through a secure authenticated matching/claim mechanism.

Supported roles:

```text
participant
organizer
admin
```

Passwords shall:

* Never be stored as plaintext.
* Use a modern adaptive password hash.
* Never appear in logs.

Authentication shall support:

* Account registration.
* Login.
* Google OAuth login.
* Logout.
* Session/token expiration.
* Session revocation where supported.

Google OAuth shall validate the OAuth flow and identity claims on the backend. Google sign-in shall not bypass backend role and organization authorization.

---

# 25. Participant Dashboard

## FR-6: Participant Experience

An authenticated participant shall have:

```text
My Registrations
```

Registrations may be divided into:

```text
Upcoming
Past
```

Each registration should show:

* Event.
* Race category.
* Ticket.
* Event date.
* Registration reference.
* Amount.
* Payment status.
* Registration status.
* QR ticket when confirmed.

The dashboard must use real backend records.

No fabricated frontend registration data shall be used.

---

# 26. Durable Confirmation

Immediately after registration, the participant shall see a confirmation page.

The confirmation page shall display:

* Event name.
* Race category.
* Ticket.
* Participant.
* Amount.
* Registration reference.
* Payment status.
* Registration status.
* UPI ID.
* UPI payment QR.
* Payment instructions.
* UTR field where applicable.

The page shall be reloadable without creating another registration.

Access shall use:

* Authenticated account access, OR
* Non-guessable confirmation token.

---

# 27. QR Ticket

A QR ticket shall be created only after:

```text
payment approved
+
registration confirmed
```

The QR payload shall contain:

* A random non-sensitive ticket token.

It shall NOT contain:

* Participant phone.
* Participant email.
* Date of birth.
* Emergency contact.
* Payment details.

Example:

```text
ticket_token = 68cc0fd9...
```

The backend resolves the token to the registration.

---

# 28. Organizer Registration Management

## FR-7: Organizer Operations

Organizer registration pages shall support:

* Event filter.
* Race-category filter.
* Ticket filter.
* Participant search.
* Email search.
* Phone search.
* Registration-reference search.
* Payment-status filter.
* Registration-status filter.
* Check-in-status filter.

Organizer views shall show only registrations for their organization.

---

# 29. CSV Export

An organizer may export registrations for an event.

CSV may contain:

* Registration reference.
* Participant name.
* Email.
* Phone.
* Race category.
* Ticket.
* Amount.
* Payment status.
* Registration status.
* UTR.
* Registration date.
* Check-in status.

The export endpoint shall enforce organizer ownership.

---

# 30. Race Check-In

A confirmed participant may be checked in using:

```text
QR Ticket
```

or fallback:

```text
Registration Reference
```

Check-in shall validate:

* Registration exists.
* Registration belongs to organizer's event.
* Registration is confirmed.
* Registration has not been rejected/cancelled.

On successful check-in:

```text
registration_status = checked_in
```

RacePass shall record:

* Check-in timestamp.
* User who performed check-in.

Check-in must be idempotent.

Scanning the same QR twice shall NOT create multiple check-ins.

The system may return:

```text
Already checked in
```

with the previous check-in time.

---

# 31. Admin Operations

The admin shall be able to:

* Create organizer.
* Edit organizer.
* Activate/deactivate organizer.
* View organizers.
* View events.
* View registrations.
* View payment statuses.
* Support payment decisions where required.
* Set an organizer fee model to `none`, `fixed_per_registration`, or `percentage`.
* Set the fixed amount or percentage independently for each organizer.

New organizers shall default to:

```text
fee_model = none
fee_value = 0
```

Fee settings shall be stored and visible to admins, but fee deduction, collection, settlement, and organizer payouts are out of scope for the manual-UPI POC.

---

# 32. Auditability

RacePass shall record important state-changing actions.

Audit records should include:

* Actor.
* Action.
* Resource type.
* Resource ID.
* Timestamp.

Important events include:

```text
organizer_created
event_published
registration_created
utr_submitted
payment_approved
payment_rejected
registration_claimed
participant_checked_in
```

Payment approvals/rejections must record the actor.

Check-ins must record the actor.

---

# 33. Security Requirements

Security shall be implemented alongside each feature.

A feature shall not be considered complete if it works functionally while bypassing security requirements.

## Authorization

Every protected backend endpoint shall enforce:

* Authentication.
* Role.
* Organization ownership.
* Resource ownership.

Frontend route guards are only for user experience.

They shall NOT be considered security controls.

---

## Passwords and Secrets

Passwords shall use a modern adaptive hash.

The following shall come from environment or secret configuration:

* Database credentials.
* JWT/session secrets.
* Storage credentials.
* Ticket-signing secret used to derive approved opaque ticket credentials.
* CORS frontend origins.
* Production configuration.

Secrets shall never:

* Be committed.
* Be logged.
* Be returned from APIs.

---

## Input Validation

All API inputs shall be validated.

The backend shall validate:

* IDs.
* Email.
* Phone.
* Dates.
* Amounts.
* Ticket status.
* Event status.
* Registration state.
* Payment state.
* File types.
* File sizes.

Database access shall use ORM or parameterized queries.

---

# 34. Public Identifier Security

Public IDs shall be non-guessable where they provide access to sensitive resources.

Human-readable references may be sequential or readable but shall not independently grant private-data access.

QR tokens shall be random.

Confirmation tokens shall be random.

Claim codes shall be random.

Tokens shall not contain personal information.

---

# 35. Rate Limiting

The following endpoints should have basic rate limits:

* Login.
* Account registration.
* Race registration.
* Registration claiming.
* Payment-reference submission.
* Payment approval/rejection.
* QR/check-in lookups.

Error responses should not expose whether unrelated private registrations exist.

---

# 36. Privacy

Participant information shall only be accessible by:

```text
Participant
Owning Organizer
RacePass Admin
```

Participant information shall be minimized in API responses.

Sensitive fields should not appear in application logs.

Public APIs shall not expose:

* Participant lists.
* Email addresses.
* Phone numbers.
* UTR numbers.
* Emergency contacts.

---

# 37. Reliability and Transactions

The following operations shall use server-side transactions where applicable:

* Registration creation.
* Inventory reservation.
* Reservation release.
* Payment approval.
* Payment rejection.
* Registration claim.
* Check-in.

Duplicate API calls shall be handled safely.

---

# 38. Scalability by Design

The POC shall remain a:

```text
Modular Monolith
```

RacePass shall NOT be split into microservices for the POC.

Suggested logical modules:

```text
Auth
Users
Organizers
Events
Race Categories
Tickets
Registrations
Payments
Check-In
Admin
Audit
```

The code should keep business logic separated from HTTP route handlers.

---

# 39. Backend Architecture

Suggested structure:

```text
Frontend
      ↓
Backend API
      │
      ├── Auth
      ├── Users
      ├── Organizers
      ├── Events
      ├── Race Categories
      ├── Tickets
      ├── Registrations
      ├── Payments
      ├── Check-In
      ├── Admin
      └── Audit
      ↓
PostgreSQL
```

Production application instances should remain stateless.

Persistent state should not depend on application memory.

---

# 40. Database

Production shall use standard PostgreSQL. The application shall remain compatible with an unmodified PostgreSQL-compatible deployment using standard SQL, transactions, indexes, constraints, and row-locking behavior. A hosted database provider may be selected for operations, but PostgreSQL provider APIs, proprietary extensions, connection-management SDKs, and provider-specific business logic shall not be required by the domain or service layers.

SQLite may be used for local development only if the project currently requires it. SQLite shall not be used to make production concurrency, locking, or capacity guarantees.

Recommended main entities:

```text
users

organizations
organization_members

events
race_categories
ticket_tiers

registrations
registration_participants

payments

tickets
check_ins

audit_logs
```

---

# 41. Registration Data Model Guidance

Even though the POC allows only one participant per registration, participant information should preferably remain conceptually separate.

Example:

```text
registrations
    id
    user_id
    event_id
    race_category_id
    ticket_tier_id
    quantity
    unit_price
    total_amount
    payment_status
    registration_status
    registration_reference
    confirmation_token
    claim_code
    reserved_until
    created_at
    updated_at
```

For POC:

```text
quantity = 1
total_amount = unit_price
```

Participant data may be stored using:

```text
registration_participants
```

with:

```text
registration_id
full_name
email
phone
date_of_birth
gender
emergency_contact_name
emergency_contact_phone
jersey_size
team_name
```

This allows future group-registration support without redesigning the core registration table.

---

# 42. Payment Data Model Guidance

Suggested payment record:

```text
payments
    id
    registration_id
    payment_method
    expected_amount
    utr_reference
    status
    approved_by
    approved_at
    rejected_by
    rejected_at
    rejection_reason
    created_at
    updated_at
```

POC payment method:

```text
manual_upi
```

Expected amount shall always be copied/calculated from server-side registration pricing.

---

# 43. Ticket Data Model Guidance

Suggested ticket record:

```text
tickets
    id
    registration_id
    ticket_token
    generated_at
    status
```

Ticket token shall have a unique constraint.

A confirmed registration shall have at most one active ticket for the POC.

---

# 44. Database Concurrency

Registration and inventory operations must protect against overselling.

Use appropriate:

* Transactions.
* Row locking.
* Unique constraints.
* Atomic updates.

The exact implementation depends on the selected ORM/database framework.

Concurrent registration requests must not produce capacity greater than configured inventory.

---

# 45. Pagination and Indexing

Public Explore and organizer lists shall be paginated.

Do not return unbounded datasets.

Expected indexed fields should include where appropriate:

```text
event.status
event.date
event.city

race_category.event_id

ticket_tier.race_category_id

registration.event_id
registration.race_category_id
registration.ticket_tier_id
registration.user_id
registration.registration_reference
registration.payment_status
registration.registration_status

payment.registration_id
payment.utr_reference

ticket.ticket_token
```

The final indexes should be determined from the actual query patterns.

---

# 46. Storage

Event banners and organizer QR uploads shall use a storage abstraction backed by an S3-compatible object-storage protocol in production.

The domain and service layers shall depend only on a storage interface. Provider SDKs, bucket naming conventions, public URL formats, and provider-specific authentication shall remain inside infrastructure adapters.

The adapter contract shall support at least:

* Put a private object with validated metadata and return an opaque object key.
* Create a short-lived read URL for an authorized request.
* Remove an object safely and idempotently.

Local disk may be used during development through a separate local adapter, but application behavior shall not depend permanently on local filesystem paths. Production behavior shall be testable with an S3-compatible fake or local adapter.

Generated UPI QR codes may be generated dynamically and do not necessarily need permanent image storage if the QR can be recreated from payment data.

---

# 47. Deployment and Portability

The backend shall remain Docker-compatible and runnable as a stateless container using a documented, platform-neutral process command. Container configuration shall not require a specific hosting provider.

Production deployment shall use:

* HTTPS.
* Standard PostgreSQL.
* An S3-compatible object-storage adapter where persistent files are needed.
* Environment-based typed configuration and secrets.
* Explicit CORS allowlist.
* Secure HTTP headers.
* Restricted database access.

Application configuration shall be read from environment variables through a typed settings layer. It shall include, as applicable:

* Database connection URL and pool settings.
* Session, CSRF, and OAuth secrets.
* Frontend origins and public API URL.
* S3-compatible endpoint, bucket, region, and credentials.
* Environment name and migration behavior.

No provider-specific deployment API, SDK, URL, environment variable, or business rule shall be required by the domain or service layers. Railway, Neon, Cloudflare, Vercel, Render, Supabase, or other providers may appear only as replaceable operational examples.

Development and production credentials must remain separate.

---

# 48. Observability

Backend should support basic:

* Structured logging.
* Request IDs.
* Error logs.
* Health endpoint.

Example:

```text
/health
```

Do not log:

* Passwords.
* Session tokens.
* Claim codes.
* Confirmation tokens.
* Full sensitive participant records.

---

# 49. Database Migrations

Database schema changes shall use migrations.

Production application startup should not silently perform destructive migrations.

Migrations should be:

* Explicit.
* Reviewable.
* Forward compatible where practical.

---

# 50. Definition of Done

A feature is complete only when:

1. Functional behavior works.
2. Backend authorization exists.
3. Resource ownership is enforced.
4. Input validation exists.
5. Error handling exists.
6. Duplicate requests are handled.
7. Relevant concurrency behavior is handled.
8. Sensitive data is protected.
9. Required audit records are written.
10. Relevant automated tests exist.
11. Negative-path tests exist.

Implementation tasks must identify:

```text
What data is created?
What data is read?
What data is updated?
Who may perform the action?
What authorization is required?
What happens on duplicate requests?
What happens with invalid state transitions?
What happens with concurrent requests?
```

---

# 51. Required Negative Tests

Important features should include tests for:

* Unauthenticated request.
* Wrong role.
* Organizer A accessing Organizer B event.
* Organizer A accessing Organizer B registration.
* Participant accessing another participant's registration.
* Invalid ticket.
* Closed registration.
* Sold-out ticket.
* Invalid payment transition.
* Duplicate payment approval.
* Duplicate check-in.
* Invalid claim code.
* Registration already claimed.
* Tampered ticket price.
* Tampered registration amount.
* Invalid QR token.

---

# 52. POC Success Criteria

The POC is successful when a non-technical tester can perform the complete journey without developer intervention.

## Organizer Setup

1. Admin creates Organizer A.
2. Organizer A signs in.

## Event Creation

3. Organizer creates:

```text
Mysuru Marathon 2026
```

4. Organizer adds:

```text
5K
10K
Half Marathon
```

5. Organizer adds ticket tiers.

Example:

```text
5K Early Bird - ₹499
10K Early Bird - ₹799
Half Marathon - ₹1,299
```

6. Organizer adds their UPI ID.
7. RacePass can generate a UPI QR.
8. Organizer may optionally upload their existing QR.
9. Organizer publishes the event.

## Participant Registration

10. Public user opens RacePass.
11. User finds Mysuru Marathon.
12. User selects:

```text
10K
+
Early Bird
```

13. User registers without creating an account.
14. RacePass creates exactly one registration.
15. RacePass calculates ₹799 server-side.
16. RacePass shows the UPI payment QR.
17. User can pay using a compatible UPI app.
18. User submits a UTR/reference.
19. Registration becomes pending verification.

## Organizer Verification

20. Organizer sees the pending registration.
21. Organizer approves the payment.
22. Registration becomes confirmed.
23. RacePass generates the participant QR ticket.

## Account Claim and Matching

24. Participant creates an account using email/password or signs in with Google.
25. After authentication, RacePass checks exact normalized matches against the account's verified email or phone.
26. Matching eligible guest registrations are shown inside My Registrations or in a secure claim flow.
27. If the contact method is not verified or the match needs additional proof, the participant enters:

```text
Registration Reference
+
Claim Code
```

28. The registration appears under My Registrations only after the authenticated match/claim succeeds.

## Race Day

29. Organizer scans the participant QR.
30. Participant is checked in.
31. Scanning the QR again shows that the participant is already checked in.

## Security

31. Organizer B cannot see Organizer A's registration.
32. Participant B cannot access Participant A's registration.
33. Changing ticket amount in the frontend does not change the server-calculated amount.
34. Repeating payment approval does not double-count inventory.
35. Repeating check-in does not create duplicate check-ins.

---

# 53. POC State Flow

The complete primary state flow is:

```text
PUBLIC EXPLORE
      ↓
EVENT DETAILS
      ↓
SELECT RACE CATEGORY
      ↓
SELECT TICKET
      ↓
REGISTER
      ↓
REGISTRATION CREATED
      ↓
SHOW UPI QR
      ↓
RUNNER PAYS ORGANIZER
      ↓
SUBMIT UTR
      ↓
PENDING VERIFICATION
      ↓
ORGANIZER APPROVES
      ↓
CONFIRMED
      ↓
QR TICKET
      ↓
RACE CHECK-IN
```

---

# 54. Important Product Decisions

The following decisions are considered approved for the POC unless changed explicitly later.

### Event Structure

Use:

```text
Event
→ Race Category
→ Ticket Tier
```

rather than representing each distance as a separate event.

---

### Registration Quantity

Keep `quantity` in the database schema.

POC behavior:

```text
quantity = 1
```

Multi-ticket checkout is deferred.

---

### Payment Method

Manual UPI only.

RacePass does NOT receive the money.

Payment goes:

```text
Participant
→ UPI
→ Organizer
```

RacePass manages only the registration and payment-verification workflow.

---

### UPI QR

Support both:

```text
RacePass-generated QR
Organizer-uploaded QR
```

Generated QR uses the organizer's valid UPI ID and the registration amount.

The participant still authorizes payment in their UPI application.

A generated QR is a payment-initiation mechanism, not proof that payment succeeded.

---

### Payment Verification

POC uses:

```text
UTR / Payment Reference
+
Manual Organizer Approval
```

Automatic bank verification is deferred.

---

### Guest Registration

Account creation is not mandatory before registration.

Guest registration gets:

```text
Registration Reference
Confirmation Token
Claim Code
```

---

### Registration Claim and Contact Matching

Authenticated participants may have eligible guest registrations linked by exact normalized matching on their verified email or phone.

Do NOT automatically expose registrations based purely on a contact value typed into a public form.

Use the following secure flow:

```text
Authenticated account
        ↓
Verified email or phone match
        ↓
Eligible matching registration
        ↓
Registration Reference + Claim Code when additional proof is required
        ↓
Registration linked to account
```

The claim/link operation must be transactional and usable only once unless explicitly designed otherwise. Another account cannot claim an already-linked registration.

### Authentication

POC authentication shall support:

```text
Email + Password
Google OAuth
```

Google OAuth shall validate the authorization flow and identity claims on the backend. Authentication must not bypass role, organization, or resource authorization.

---

### Architecture

Use:

```text
Modular Monolith
+
PostgreSQL
```

Do not introduce microservices during the POC.

---

# 55. Recommended Implementation Order

Implementation should proceed vertically rather than building every backend module before testing the product flow. Security, authorization, privacy, validation, concurrency, and observability acceptance criteria shall be implemented and tested in the same stage as each feature; they are not a final-stage review.

Recommended sequence:

```text
1. Base project + database + secure configuration
2. Authentication + roles + session security
3. Organizations + backend ownership authorization
4. Events + secure input validation
5. Race Categories
6. Ticket Tiers + capacity constraints
7. Public Explore + safe response fields
8. Event Details
9. Registration + transaction/idempotency controls
10. Capacity/reservation + concurrency tests
11. Manual UPI configuration + protected organizer access
12. Generated UPI QR
13. UTR submission + rate limits/audit
14. Organizer registration list + scoped data access
15. Payment approval/rejection + valid state transitions/audit
16. Confirmation + QR ticket + non-guessable tokens
17. Participant account contact matching/claiming
18. My Registrations + participant privacy
19. Check-In + idempotency/audit
20. CSV export + authorization/data minimization
21. Admin/support views + fee configuration
22. Production deployment, observability, backup/recovery, and end-to-end validation
```

Each stage shall be tested end-to-end, including relevant negative-path and cross-organizer authorization tests, before moving to the next stage.

---

# 56. Core POC Goal

Do not expand the scope until this exact loop works on a deployed environment:

```text
Organizer creates race
        ↓
Runner discovers race
        ↓
Runner registers
        ↓
Runner pays through UPI
        ↓
Runner submits UTR
        ↓
Organizer approves
        ↓
Runner receives QR ticket
        ↓
Organizer checks runner in
```

Once this flow works reliably, RacePass has proven the core product hypothesis.

Everything beyond this should be treated as the next release rather than a blocker for the POC.
