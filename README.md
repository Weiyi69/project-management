# ORBIT

ORBIT is a collaborative project-management platform. This repository is being built in verified stages. **Stages 1–3 are implemented so far**: the pnpm workspace, Vue/Nest application scaffolds, shared contracts, Tailwind and the ORBIT design system, responsive application shell, navigation, preview pages, PostgreSQL/Prisma foundation, and local account registration/sign-in with server-managed sessions.

Local development targets Windows 10/11 with PostgreSQL installed natively and managed through pgAdmin 4. Docker Desktop is not required.

## Requirements

- Node.js 20.19 or newer (the current Vite and Prisma toolchain requires this baseline)
- Corepack, included with Node.js
- PostgreSQL running on `localhost:5432`
- pgAdmin 4

## 1. Prepare PostgreSQL in pgAdmin 4

Connect pgAdmin to the local PostgreSQL server using the administrator account created when PostgreSQL was installed. Open a Query Tool connected to the built-in `postgres` database.

Run this statement once to create the application login, replacing the example password with a strong local password:

```sql
CREATE ROLE orbit_user WITH LOGIN PASSWORD 'replace-with-local-password';
```

If the role already exists, skip creation; if you need to reset its local password, run `ALTER ROLE orbit_user WITH PASSWORD 'replace-with-local-password';` instead. Open a Query Tool connected to `postgres` and create the application database:

```sql
CREATE DATABASE orbit_db OWNER orbit_user;
```

If `orbit_db` already exists, verify that `orbit_user` owns it (pgAdmin: **Properties → Definition → Owner**). Keep the database name, role, host, and port as `orbit_db`, `orbit_user`, `localhost`, and `5432`.

## 2. Configure the repository

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env -NoClobber
```

Corepack reads the pinned pnpm version from `package.json`; use `corepack pnpm` in commands below. This avoids needing administrator rights to create a global pnpm shim under `C:\Program Files\nodejs`.
If `.env` already exists, `-NoClobber` leaves it untouched; edit the existing file instead of replacing it.

Edit `.env` and set `DATABASE_URL` to the password you used above:

```dotenv
DATABASE_URL="postgresql://orbit_user:replace-with-local-password@localhost:5432/orbit_db?schema=public"
FRONTEND_URL="http://localhost:5173"
PORT=3000
NODE_ENV="development"
```

URL-encode special characters in the password (for example, `@` as `%40` and `#` as `%23`). Never commit `.env`; credentials belong only in this ignored local file.

Install dependencies and generate Prisma Client:

```powershell
corepack pnpm install
corepack pnpm db:generate
```

Apply the checked-in initial migration, then load the demo workspace:

```powershell
corepack pnpm db:deploy
corepack pnpm db:seed
```

Prisma creates versioned migration SQL under `prisma/migrations`. Inspect it or the resulting tables through pgAdmin under **orbit_db → Schemas → public → Tables**.
The initial migration rejects a task depending on itself. Multi-task dependency-cycle detection will be implemented in the backend task service in a later stage.

To develop a later schema change, create a migration with `corepack pnpm exec prisma migrate dev --name <migration-name>`. Prisma Migrate uses a shadow database for development and may require the database role to have `CREATEDB`. If `orbit_user` should remain a least-privilege application role, create a separate local shadow database in pgAdmin, grant `orbit_user` ownership of it, and configure Prisma's `shadowDatabaseUrl` before using `migrate dev`. The initial checked-in migration uses `migrate deploy`, which does not require shadow-database creation.

The seed creates an `Orbit Demo` user, workspace, project, task statuses, tasks, and a label. Its password hash is generated from a fresh random value and no login credential is distributed. The frontend does not yet load seeded project data.

## 3. Run the apps

Start both local processes:

```powershell
corepack pnpm dev
```

Or run them separately in two PowerShell terminals:

```powershell
corepack pnpm dev:web
corepack pnpm dev:api
```

- Web app: <http://localhost:5173>
- API health endpoint: <http://localhost:3000/api/v1/health>
- OpenAPI documentation: <http://localhost:3000/api/docs>

Signed-out visits are directed to sign-in. Open <http://localhost:5173/register> to create an account and its starter workspace. ORBIT stores a normalized email, an Argon2id password hash, the workspace, and its membership in the local PostgreSQL database. The API issues a random session token in an HTTP-only, same-site cookie and stores only its SHA-256 hash in `RefreshSession`; signing out revokes the session. Sign-in, registration, session lookup, and protected application routes are connected to the API.

Authentication endpoints are `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, and `POST /api/v1/auth/logout`. Password-reset remains unavailable until an email-delivery provider is configured; the page does not claim to send a reset email.

The sidebar, responsive mobile navigation, workspace menu, notification/profile menus, and `Ctrl+K`/`⌘K` page search are available. The project-management sections remain previews and do not yet load database project/task data. Password-reset is intentionally unavailable until an email-delivery provider is configured; the page explains that no email is sent.

## Useful commands

| Command | Purpose |
| --- | --- |
| `corepack pnpm install` | Install workspace dependencies |
| `corepack pnpm db:generate` | Generate Prisma Client |
| `corepack pnpm exec prisma migrate dev --name <name>` | Create/apply a development migration |
| `corepack pnpm db:deploy` | Apply checked-in database migrations |
| `corepack pnpm db:seed` | Seed the local demo workspace |
| `corepack pnpm db:studio` | Open Prisma Studio |
| `corepack pnpm typecheck` | Type-check workspace packages |
| `corepack pnpm build` | Build all workspace packages |

## Workspace layout

```text
apps/
  api/                 NestJS API
  web/                 Vue 3 + Vite frontend
    public/images/     Static images for the web app
packages/
  contracts/           Shared TypeScript API contracts
prisma/
  schema.prisma        PostgreSQL relational schema
  migrations/          Versioned schema migrations
  seed.ts              Idempotent demo data
```

## Scope and next stages

Stages 1–3 establish the technical foundation, frontend experience, and local account authentication. Password reset/email delivery, workspace/project APIs, task workflows, real-time collaboration, analytics, automated feature tests, and deployment are not implemented yet. The preview screens are not database-backed product workflows. This local-development authentication implementation is not production-ready without additional operational hardening.
