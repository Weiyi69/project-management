# Stage 8 quality checks

## Automated coverage

`corepack pnpm test` runs the database-independent task, realtime, analytics, project-member, search, auth, account, and workspace suites. Project-member unit tests cover workspace scoping, eligible members, manager authorization, and last-admin protection; workspace tests cover the effect of workspace-member removal on project roles. The account unit suite validates actual JPEG, PNG, and WebP content, 512 × 512 WebP conversion, upload rejection, and safe profile responses. `corepack pnpm test:integration` starts the Nest application against PostgreSQL and checks account registration/session revocation, personal profile and email verification, profile-photo upload limits and content validation, notification preferences, due-reminder deduplication and invalidation on task changes, project-update recipient preferences and actor exclusion, current membership checks, asynchronous outbox delivery, concurrent claims, active lease renewal during a slow send, expired lease recovery, retry limits, permanent SMTP failures, password changes, session ownership, workspace invitation preferences, project-member list/add/role/remove and workspace authorization, project/task persistence, analytics and CSV responses, and workspace boundaries. Automated email delivery is captured in memory and never contacts SMTP. `corepack pnpm test:e2e` uses Chromium to exercise registration, project and task creation, project-member add/role-change/remove and member loading/error/empty states, keyboard task-dialog behavior, and axe scans tagged for WCAG 2.1 A/AA criteria; its setup clears only authentication rate-limit buckets after verifying it is connected to local `orbit_test`.

These are focused core-flow checks, not exhaustive coverage of every view or permission combination and not a certification of WCAG conformance.

## Safe local PostgreSQL integration run

The integration test refuses to start unless `ORBIT_TEST_DATABASE_URL` names a database exactly called `orbit_test` on `localhost`, `127.0.0.1`, `::1`, or the CI `postgres` service. Create a disposable database in pgAdmin using a local PostgreSQL administrator:

```sql
CREATE DATABASE orbit_test OWNER orbit_user;
```

In PowerShell, set the test URL for this disposable database only. URL-encode special characters in the password; do not put credentials in the repository:

```powershell
$env:ORBIT_TEST_DATABASE_URL = "postgresql://orbit_user:<encoded-password>@localhost:5432/orbit_test?schema=public"
$env:DATABASE_URL = $env:ORBIT_TEST_DATABASE_URL
corepack pnpm db:generate
corepack pnpm db:deploy
corepack pnpm test:integration
corepack pnpm test:e2e
Remove-Item Env:ORBIT_TEST_DATABASE_URL
Remove-Item Env:DATABASE_URL
```

The API integration test deletes only the specific user/workspace records it creates. Do not point either variable at `orbit_db`, another development database, or production. Local PostgreSQL is native; Docker is not part of the local setup. GitHub Actions provides a temporary PostgreSQL 16 service named `orbit_test`.

The Prisma PostgreSQL adapter enables node-postgres query pipelining in its pool. This is node-postgres's supported mechanism for concurrent, independent queries on a client. Keep dependent transaction operations sequential; pipelining does not make a later query wait for application-level decisions based on an earlier result.

## Accessibility

The browser check scans registration, the authenticated project workspace (including project-member management), the empty and populated workspace calendar, and analytics with axe WCAG 2.1 A/AA rules. It exercises member management, calendar loading, month/week/day/agenda navigation, filters, task and project navigation, and a narrow mobile layout. Keyboard checks verify calendar period navigation and task-dialog initial focus, focus containment, Escape close, and focus return. Global focus-visible styles cover buttons, links, inputs, textareas, selects, and explicit tab stops. The tests provide a repeatable baseline, but manual screen-reader, zoom/reflow, and full-application audits remain necessary.

## Performance baselines

The database-backed integration test records three login samples and ten samples of project list/detail, task list/detail (including comments), notifications, workspace/project analytics, and task status update requests. It also checks workspace calendar date filtering and authorization. The browser test records registration, project creation/navigation, task creation, analytics navigation, and navigation-timing/transfer-size values.

When run, JSON measurements are written to `test-results/api-performance-baseline.json` and `test-results/ui-performance-baseline.json`. CI uploads these files as workflow artifacts. Timings depend on the machine, database, browser, and CI load; they are measurements, not guaranteed service levels. Numeric performance budgets are intentionally not declared until a representative baseline has been collected and reviewed.

## CI and security checks

`.github/workflows/quality.yml` runs migrations and the database-independent, PostgreSQL integration, and browser/accessibility suites against an isolated service; it also runs typecheck, production build, and a production dependency audit. Test credentials exist only as ephemeral workflow service configuration. The job does not add Docker as a local-development requirement.

The current security regression coverage checks invalid input, unauthenticated access, session revocation, workspace/project analytics isolation, project-member workspace boundaries, manager permissions, and the last-project-admin invariant. It is not a full security audit or penetration test. Review dependency audit findings and GitHub Actions results before merging.
