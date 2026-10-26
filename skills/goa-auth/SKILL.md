---
name: goa-auth
description: Configure and verify email/password-only Cognito authentication and private trip access in the Goa project. Use for signup, login, sessions, invitations, account recovery, or authorization changes.
---

# Identity and access

Read the auth and role rules in [plan.md](../../plan.md). User-facing auth is email/password with verification, reset, sign-out, and account deletion; no social provider is part of the pilot. Cognito is the password authority and stores salted hashes. The project database stores the Cognito subject and application profile, never a plaintext or reversible password.

Choose a secure session integration for the current Next.js/Cognito versions using official docs. Prefer HTTP-only secure cookies for browser sessions where practical, and address cross-site request forgery for state-changing browser requests. The API verifies identity and checks trip membership or content-admin role for each action. Authentication alone never grants access to a trip, a shared booking, or another person's ID document.

Test registration, verification, login, logout, reset, expired session, copied trip URL, revoked invitation, removed member, and content-admin access boundaries with distinct accounts. Rate-limit sensitive attempts and keep secrets and tokens out of logs. Coordinate ownership of auth configuration with the platform agent so credentials and callback settings are not duplicated or overwritten.
