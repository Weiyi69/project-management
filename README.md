# ORBIT

ORBIT is a collaborative project-management platform. This repository is being built in verified stages. **Stages 1–7 and the workspace-wide calendar are implemented so far**: the pnpm workspace, Vue/Nest application scaffolds, shared contracts, Tailwind and the ORBIT design system, responsive application shell, PostgreSQL/Prisma foundation, local account registration/sign-in with server-managed sessions, authenticated workspace/project management, project task planning, Socket.IO-based task synchronization, presence and in-app notifications, workspace and project analytics with CSV exports, and a workspace calendar.

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
The initial migration rejects a task depending on itself. The task API also rejects dependencies that would create a multi-task cycle.

To develop a later schema change, create a migration with `corepack pnpm exec prisma migrate dev --name <migration-name>`. Prisma Migrate uses a shadow database for development and may require the database role to have `CREATEDB`. If `orbit_user` should remain a least-privilege application role, create a separate local shadow database in pgAdmin, grant `orbit_user` ownership of it, and configure Prisma's `shadowDatabaseUrl` before using `migrate dev`. The initial checked-in migration uses `migrate deploy`, which does not require shadow-database creation.

The seed creates an `Orbit Demo` user, workspace, project, task statuses, tasks, and a label. Its password hash is generated from a fresh random value and no login credential is distributed. The frontend does not yet load the seeded demo user's project data; projects are scoped to the signed-in account's workspace membership.

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

Workspace settings supports creating and selecting workspaces, renaming a workspace, listing members, changing eligible member roles, sending/revoking invitations, and deleting an empty workspace. Workspace deletion is owner-only and is rejected if the workspace has projects; it never cascades into project data. Invitations are emailed through SMTP. Configure `SMTP_HOST`, `SMTP_PORT` (defaults to `587`), `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in the ignored local `.env`. Do not commit credentials. An invitation expires after seven days; invitees must sign in or register with the invited email address to accept.

The Projects section lists projects in the selected workspace. Create a project to save its name and description in PostgreSQL; ORBIT also adds the creator as a project admin and creates To do, In progress, and Done statuses. Open a project to update its details and lifecycle state, manage tasks, or permanently delete it. Project deletion requires typing the project name and also deletes the project's tasks and workflow data.

Project task management provides Kanban, table, and monthly calendar views. Workspace members can create, edit, assign, move, and delete tasks; add/edit/delete comments they authored; manage project labels; and link task dependencies. Assignees must belong to the same workspace. Dependencies are restricted to the same project and cycles are rejected. Project and workspace calendar entries use task due dates; tasks without a due date are not displayed. The sidebar Calendar shows dated tasks for the selected workspace in month, week, day, and agenda views, with project, status, priority, and assignee filters. Opening a task uses its existing project task dialog, and creating a task opens that dialog in an available project. The task endpoints require a valid session and workspace membership:

Analytics provides a workspace dashboard and project drill-down based on persisted project, workflow-status, assignment, and due-date data. Project health is explainable: any overdue incomplete task makes a project At risk; otherwise, no tasks, an incomplete task due today through the seventh day after today (UTC calendar days), or unassigned incomplete work makes it Needs attention; projects without those signals are On track. Completion is completed tasks divided by all tasks; an empty project has no completion rate. Team workload counts assigned incomplete tasks and reports unassigned work separately. The dashboard and project detail views export CSV. The project detail view shows up to 100 due tasks; its CSV export includes all overdue and upcoming incomplete tasks. CSV cells are escaped and formula-prefixed values are neutralized for spreadsheet safety. Analytics endpoints require authentication and workspace membership:

- `GET /api/v1/analytics/workspaces/:workspaceId` and `GET /api/v1/analytics/projects/:projectId`
- `GET /api/v1/analytics/workspaces/:workspaceId/export.csv` and `GET /api/v1/analytics/projects/:projectId/export.csv`

- `GET /api/v1/workspaces` and `GET /api/v1/workspaces/current`
- `POST /api/v1/workspaces`, `GET /api/v1/workspaces/:workspaceId`, `PATCH` and `DELETE /api/v1/workspaces/:workspaceId`
- `GET /api/v1/workspaces/:workspaceId/members`; `PATCH` and `DELETE /api/v1/workspaces/:workspaceId/members/:userId`
- `GET`, `POST`, and `DELETE /api/v1/workspaces/:workspaceId/invitations...`
- `GET /api/v1/projects` and `POST /api/v1/projects`
- `GET /api/v1/workspaces/:workspaceId/calendar/tasks?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` for due-dated tasks within an inclusive date range
- `GET`, `PATCH`, and `DELETE /api/v1/projects/:projectId`
- `GET` and `POST /api/v1/projects/:projectId/tasks`; `GET`, `PATCH`, and `DELETE /api/v1/tasks/:taskId`
- `GET`, `POST`, `PATCH`, and `DELETE /api/v1/projects/:projectId/labels...`
- `POST /api/v1/tasks/:taskId/comments`; `PATCH` and `DELETE /api/v1/comments/:commentId`
- `POST` and `DELETE /api/v1/tasks/:taskId/dependencies...`
- `GET /api/v1/invitations/preview/:token` and authenticated `POST /api/v1/invitations/accept`
- Authenticated `GET /api/v1/notifications`, `PATCH /api/v1/notifications/:notificationId/read`, and `PATCH /api/v1/notifications/read-all`

Role permissions: workspace owners can rename/delete their empty workspace, grant/revoke admin roles, invite admins or members, and manage projects. Workspace admins can invite/manage members and manage projects, but cannot rename/delete workspaces or grant/administer other admins. Members can view workspace projects and project details, but cannot create or edit projects. Owners cannot be removed or demoted. Invitations cannot grant the owner role.

The sidebar, responsive mobile navigation, workspace menu, notification/profile menus, and `Ctrl+K`/`⌘K` page search are available. Task boards, table/calendar views, task creation and assignment, comments, labels, dependencies, workspace invitations, and Stage 7 analytics are connected. Authenticated Socket.IO sessions use the existing HTTP-only session cookie. Members may join only project rooms for workspaces they currently belong to; task and comment changes are broadcast to those rooms, and project presence is ephemeral on the single API instance. Removing a workspace member also removes their active sockets from that workspace's project rooms. In-app notifications are persisted for task assignments and comments; comments can mention workspace members with their email address (for example `@person@example.com`). The notification menu and Inbox page support unread counts and read state across connected sessions. Multi-instance deployments need a shared Socket.IO adapter for cross-instance rooms and presence. Due-date reminders are not implemented. Password-reset is intentionally unavailable until an email-delivery provider is configured; the page explains that no email is sent.

The Vite development server proxies both `/api` and `/socket.io` to the local API. A production deployment must route the same paths (including WebSocket upgrades for `/socket.io`) to the API service.

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
| `corepack pnpm test:realtime` | Test Socket.IO authentication, room access, task and notification events, presence, and session revocation |
| `corepack pnpm test:tasks` | Test task update service behavior |
| `corepack pnpm test:analytics` | Test analytics health rules, date windows, and CSV safety |
| `corepack pnpm test` | Run database-independent task, realtime, and analytics tests |
| `corepack pnpm test:integration` | Run authenticated API workflows against an isolated PostgreSQL `orbit_test` database |
| `corepack pnpm test:e2e` | Run Chromium core-flow, keyboard-dialog, and axe WCAG 2.1 AA-oriented checks |

Stage 8 quality check details, isolated local PostgreSQL integration setup, performance measurement outputs, and coverage limits are documented in [QUALITY.md](./QUALITY.md).
Email verification, Gmail SMTP setup, password recovery, and the opt-in delivery smoke test are documented in [EMAIL_AUTH.md](./EMAIL_AUTH.md).

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

Stages 1–7 establish the technical foundation, frontend experience, local account authentication, workspace/project management, task workflows, real-time task collaboration, and workspace/project analytics. Project-specific member management, password reset, due-date reminder scheduling, comprehensive feature tests beyond focused coverage, and deployment are not implemented yet. Remaining preview screens are not database-backed product workflows. This local-development implementation is not production-ready without additional operational hardening.
