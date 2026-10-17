# Organizer onboarding

## Applicant flow

1. Open /signup?type=organizer. Submit contact details, club type, address, event background, discovery source, payment preference, one proof and privacy consent.
2. Direct UPI asks for UPI ID and payee name. Gateway asks for legal name and PAN. “Need guidance” records an undecided route.
3. Track the application at /signup?type=organizer&status=1 with the original email/password. Login also links to this screen. Credentials stay in memory and are not put in URLs or browser storage.
4. Pending applicants have no organizer account or participant-data access.
5. If corrections are requested, read the feedback, edit the prefilled form and upload replacement proof using the same email/password. The same application returns to pending.
6. After approval, sign in normally. Organization settings show onboarding progress and the requested payment route. Profile, address, gateway identity details and proof carry over.
7. Complete existing paid-event verification (including GST/terms where applicable). Admin must separately enable payment permissions. Direct UPI destinations still need their existing review. Free events do not require paid-event verification.

## Admin flow

Open /admin/organizer-applications. Filter Pending, Corrections, Approved, Rejected or All. Review the profile, contact details, event background, payment details and private evidence.

Request corrections with specific instructions, approve a complete application, or reject with a reason. Do not interpret an uploaded proof as automatic identity verification: the reviewer must inspect it.

Document access requires an admin and CSRF-protected request. A five-minute signed link is issued on demand and its issuance is audited. Anyone holding that temporary link can use it until expiry; never share it.

Review history records submission, resubmission, correction requests, decisions and document-link issuance. Current feedback is visible to the applicant. Approval creates one organizer user and membership; repeated approval fails.

## Notifications and support

Submission and review changes invoke the existing email service without attaching documents or including identity numbers. The status page remains the source of truth if email is disabled, rate limited or fails. Inspect existing email logs for delivery status; sending is not guaranteed.

Existing applications missing evidence must be returned for corrections. Applicants can recover their password using the existing forgot-password page, including historical rejected applicants whose password hash was erased. Recovery uses a hashed, single-use, 30-minute email token. Approval invalidates application recovery tokens.

## Deployment and checks

Migration: 0082_organizer_application_verification, after 0081_dpdp_account_rights. Apply with the project's normal deployment migration command before serving the new API/frontend. Do not run a migration against an unverified database URL.

Private storage must be configured and its bucket must remain non-public. New submissions fail explicitly when storage fails. Replacement proof is removed after the resubmission commits; cleanup failures log the application ID for follow-up.

No document-expiry/retention policy is automatically imposed by this change. Use the established privacy/account-erasure process and agree on a retention period before adding automated deletion.

Tests cover multipart submission, validation before storage, authenticated status, CSRF, admin-only access, corrections/resubmission, rejection, approval, profile/proof transfer, payment permissions remaining disabled, and migration preservation of legacy rows.
