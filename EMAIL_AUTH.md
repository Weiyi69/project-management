# ORBIT email verification and recovery

## Required backend environment

Set these variables in the API environment or the root `.env` file. Never put SMTP credentials in Vue/Vite variables or frontend source.

| Variable | Description |
| --- | --- |
| `OTP_PEPPER` | At least 32 bytes of cryptographically random secret material. Used to HMAC OTP digests and pseudonymous rate-limit keys. Keep stable across API instances and restarts. |
| `SMTP_HOST` | SMTP server hostname; Gmail uses `smtp.gmail.com`. |
| `SMTP_PORT` | SMTP port; use `465` for implicit TLS or `587` for STARTTLS. |
| `SMTP_SECURE` | Set `true` for port 465 and `false` for port 587. |
| `SMTP_USER` | SMTP login, for Gmail normally the complete Gmail address. |
| `SMTP_PASSWORD` | Gmail App Password or the SMTP provider's password. |
| `SMTP_FROM` | Sender displayed to recipients, for example `ORBIT <you@gmail.com>`. |

Generate a pepper using a local cryptographic tool, then store it in the server's environment or ignored `.env` file:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Changing the pepper invalidates outstanding email codes and resets the pseudonymous rate-limit buckets; it does not affect sessions or passwords. Use the same value on all API instances. Do not commit the value.

## Gmail App Password setup

1. Sign in to the Gmail account that will send ORBIT mail.
2. Enable Google Account **2-Step Verification**.
3. Open the Google Account **App passwords** page and create an app password for ORBIT. Google may require a personal account or Workspace administrator approval.
4. Put the generated app password in `SMTP_PASSWORD`. Remove any spaces Google displays; do not use the normal Gmail account password.
5. Set `SMTP_USER` to that account, `SMTP_FROM` to a matching sender, and use either port 465 with `SMTP_SECURE=true` or port 587 with `SMTP_SECURE=false`.
6. Restart the API after changing `.env`.

An App Password is a credential: do not paste it into source files, issue comments, screenshots, or chat. Revoke it from the Google Account security page if it is exposed.

## Local SMTP

For development, a locally running SMTP catcher can be used without Gmail credentials or Docker. For a catcher listening on `127.0.0.1:1025`, use:

```text
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM=ORBIT <no-reply@localhost>
```

Leave `SMTP_USER` and `SMTP_PASSWORD` unset only if the local server accepts unauthenticated local connections. Inspect messages in the local catcher UI; never add a code-display endpoint to the production API.

## Database migration

The migration `20261101000000_email_auth_security` adds nullable `User.emailVerifiedAt`, hashed one-time `AuthCode` records, and `RateLimitBucket` records. It marks every account that existed at migration time verified and creates normalized email uniqueness. New accounts are created unverified.

Back up the database, then from the repository root apply the development migration:

```powershell
corepack pnpm db:generate
corepack pnpm db:migrate --name email_auth_security
```

For an already-generated migration in a deployment/CI environment:

```powershell
corepack pnpm db:deploy
```

## Authentication endpoints

- `POST /api/v1/auth/register` creates the user and starter workspace, sends a verification code, and does not create a session. Registration returns the same status and body for a new address and an existing verified address; an existing verified account is not sent another verification email. Delivery failures use the same generic response, and the verification page offers resend and sign-in options.
- `POST /api/v1/auth/verify-email` verifies `{ email, code }`.
- `POST /api/v1/auth/resend-verification` requests a new code, subject to a 60-second cooldown.
- `POST /api/v1/auth/login` rejects unverified accounts.
- `POST /api/v1/auth/password-reset/request` returns the same generic response for known and unknown addresses.
- `POST /api/v1/auth/password-reset/confirm` accepts `{ email, code, newPassword }`, consumes the code atomically, and revokes existing sessions.

Codes are six digits, expire after ten minutes, allow at most five failed attempts, are single-use, and are stored only as keyed HMAC digests. A newer code invalidates any earlier code for the same purpose. Persistent fixed-window rate limits use PostgreSQL atomic upserts and are shared across API instances. Expired code and rate-limit rows are periodically cleaned up.

Invitation URLs remain internal redirects through registration, verification, and sign-in. Invitation acceptance still revalidates the token, signed-in email, expiration, and workspace membership rules.

## Automated tests

Run database-independent tests and checks:

```powershell
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

Use only the isolated PostgreSQL database named `orbit_test` for database-backed tests:

```powershell
$env:ORBIT_TEST_DATABASE_URL = "postgresql://orbit_user:<encoded-password>@localhost:5432/orbit_test?schema=public"
$env:DATABASE_URL = $env:ORBIT_TEST_DATABASE_URL
corepack pnpm db:generate
corepack pnpm db:deploy
corepack pnpm test:integration
corepack pnpm test:e2e
```

Integration and browser tests set a fixed OTP and an in-memory email transport only in `NODE_ENV=test`; no real messages are sent. The test OTP is never returned by the HTTP API or written to test output. The email-mode override refuses to run outside the test environment.

## Optional real Gmail delivery smoke test

This sends one harmless test message to the designated mailbox. It is not part of ordinary automated tests or CI. Confirm the recipient and Gmail SMTP configuration first, then explicitly enable it:

```powershell
$env:RUN_GMAIL_SMOKE_TEST = "true"
$env:GMAIL_SMOKE_TEST_RECIPIENT = "mailbox-you-control@example.com"
corepack pnpm email:smoke-test
Remove-Item Env:RUN_GMAIL_SMOKE_TEST
Remove-Item Env:GMAIL_SMOKE_TEST_RECIPIENT
```

The command refuses to send unless both the opt-in flag and recipient are set. It reports delivery status only and never prints credentials or authentication codes.

## Troubleshooting

- **Authentication fails:** use a Gmail App Password, not your normal account password; confirm 2-Step Verification and the complete `SMTP_USER`.
- **Connection timeout/refused:** verify `SMTP_HOST`, port, firewall access, and whether the provider requires port 465 or 587.
- **TLS errors:** use `SMTP_SECURE=true` for 465 and `false` for 587; do not disable certificate validation.
- **Sender rejected:** align `SMTP_FROM` with the authenticated Gmail account or an authorized Gmail alias.
- **Code rejected:** request a new code after the 60-second cooldown; the newest code invalidates previous codes. Codes expire in ten minutes or after five failed attempts.
- **Rate limited:** wait for the applicable endpoint window to expire; persistent limits are shared through PostgreSQL.
- **API says `OTP_PEPPER` is missing/short:** generate at least 32 random bytes, configure the same secret on each API instance, and restart the API.
- **Existing account cannot sign in:** migration backfills existing users as verified. Check that the migration completed before deploying the new API.
