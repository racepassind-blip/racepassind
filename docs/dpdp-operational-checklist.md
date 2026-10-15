# DPDP operational checklist

This checklist supports the product controls in the application. It is not a substitute for legal advice.

## Product controls in place

- Signup requires an affirmative acceptance of the Privacy Policy and stores its version and timestamp.
- Signed-in participants can download account-linked data and erase their account from Dashboard → Profile.
- Account erasure revokes sessions, deletes reset tokens and push subscriptions, removes direct identifiers, and disconnects account links from registrations and orders.
- Event and payment records are retained only in de-identified form where needed for legal, fraud, dispute, or event-operation obligations.
- Participant-only routes resolve data from the authenticated user ID. Organizer routes require event or organization authorization.

## Before production rollout

- Name the data fiduciary and grievance contact in the Privacy Policy, and monitor that inbox with a written response process.
- Publish a retention schedule for registrations, payments, security logs, audit logs, and organizer verification documents. Set deletion jobs once each retention period expires.
- Maintain a vendor register covering hosting, database, storage, email, payments, analytics, and support tools. Record what each provider processes and its contract or data-processing terms.
- Maintain a breach-response runbook: contain the incident, preserve evidence, assess affected data, notify affected people and the Data Protection Board when legally required, and document remediation.
- Verify whether the service processes children’s data. If it does, implement verifiable parent or guardian consent and avoid prohibited tracking or behavioural monitoring.
- Review role and event authorization whenever a new endpoint, export, file download, or sport adapter is added. Test cross-account access with two participant accounts and two organizations.
- Review privacy-policy wording and consent version whenever fields, purposes, processors, or retention periods change. Prompt existing users to accept material changes before processing new optional data.
- Limit internal production access, require MFA for privileged accounts, rotate secrets, and review audit logs and authorization failures regularly.
