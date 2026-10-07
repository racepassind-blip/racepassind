# Clerk authentication

SportPass keeps its local `users.id` as the business identity. Clerk only supplies the verified provider identity; the backend resolves `sub` to `users.clerk_user_id` and then passes the existing local `User` model to all routes.

## Configuration

Frontend: set `VITE_CLERK_PUBLISHABLE_KEY`.

Backend: set `CLERK_AUTH_REQUIRED=true`, `CLERK_SECRET_KEY` (or `CLERK_JWT_KEY` for networkless verification), `CLERK_WEBHOOK_SIGNING_SECRET`, and `CLERK_AUTHORIZED_PARTIES` to the exact frontend origins. Keep the secret values out of source control.

## Clerk Dashboard

1. Create/claim the Clerk application and enable the desired email/phone/social sign-in methods.
2. Copy the publishable key into the frontend environment and the secret/JWT key into the backend secret store.
3. Add a webhook endpoint at `/api/v1/webhooks/clerk` for `user.created`, `user.updated`, and `user.deleted`.
4. Copy the endpoint's Svix signing secret to `CLERK_WEBHOOK_SIGNING_SECRET`.
5. Configure the frontend and backend URLs as allowed origins/redirect URLs.

Legacy password columns, local password routes, and `AuthSession` remain in the schema for rollback/migration safety. When `CLERK_AUTH_REQUIRED=true`, new password registration/login is disabled and normal API access uses Clerk bearer tokens.
