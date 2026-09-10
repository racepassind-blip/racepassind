---
inclusion: always
---

# RacePass Architecture and Portability Rules

These rules apply to every RacePass implementation and infrastructure decision:

1. Avoid vendor lock-in. Infrastructure integrations must be behind interfaces/adapters and use standard protocols.
2. PostgreSQL must remain standard PostgreSQL. Domain and service layers must not depend on provider-specific database extensions, APIs, or SDKs.
3. The backend must remain Docker-compatible. It must be runnable as a container with environment-provided configuration and a platform-neutral process command.
4. File and object storage must use an S3-compatible abstraction. Domain/service code must depend on a storage interface, not a provider SDK or provider-specific URL format.
5. Application configuration must come from environment variables or a typed environment-backed settings layer. Never hard-code deployment URLs, credentials, bucket names, OAuth secrets, or provider assumptions.
6. Deployment providers such as Railway, Neon, Cloudflare, Vercel, Render, Supabase, or others may be documented as replaceable examples only. Do not introduce their APIs, SDKs, naming, or business logic into domain/service layers.
7. Provider-specific code belongs only in infrastructure adapters and deployment configuration. It must be possible to replace a provider without changing registration, payment, organizer, participant, or authorization business rules.
8. Prefer standard HTTP, OAuth/OIDC, PostgreSQL, S3-compatible APIs, Docker, and environment variables. Document portability and replacement paths as part of each infrastructure task.
9. Tests must use protocol-compatible fakes or local containers where practical, not provider-only behavior.
