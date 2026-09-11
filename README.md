# Internal CRM System MVP

Remediation build for PR #1 on `feature/crm-mvp`. Node.js 20+ HTTP API, static UAT frontend, and SQLite persistence using the built-in `node:sqlite` runtime.

## Local setup

```bash
export DEMO_PASSWORD='choose-a-local-password'
export CRM_DATA_FILE="$PWD/data/crm.sqlite" # optional; defaults to data/crm.sqlite
npm start
npm run seed                         # after the first server start, optional demo data
npm test
npm run build
```

The first server start creates the SQLite schema and an `admin` user. The password is taken from `DEMO_PASSWORD`; otherwise a random local password is generated. Never commit the database or use demo credentials outside local development.

## Security and data integrity

- Bearer sessions, password hashing with `scrypt`, logout revocation, and password-free user responses.
- Audit is strictly append-only: external POST/PATCH/DELETE operations are rejected; actor identity is always taken from the authenticated session; reads are restricted to Admin and Manager.
- Per-resource allowlists and schemas reject unknown/protected fields, including password injection, and validate required fields, enums, lifecycle transitions, and relationship identifiers.
- Role/operation matrix: Admin has global access; Manager is scoped to memberships; Developer/QA may write scoped project data; Viewer is read-only; deletes are Admin/Manager only. Users with no project memberships are denied project-scoped access.
- SQLite WAL mode, foreign keys, transactional single-file persistence, and reproducible schema creation avoid JSON lost-update behavior across restarts.

## MVP workflows

The frontend provides UAT-oriented entry points for QA/UAT evidence, approvals/clarifications, releases/deployments, reports, administration, notifications, attachments, dependencies, and meetings/actions, alongside the delivery queue. The API exposes dedicated protected resources for each workflow.

## Verification

- `npm test` — authentication/logout, audit tamper rejection, actor integrity, protected/unknown fields, lifecycle evidence, and required relationship validation.
- `npm run build` — syntax validation for server, seed, and frontend.

Next-phase frontend coverage: authenticated workflow navigation now includes QA cases/results with execute/retest actions, UAT, approvals, releases/deployments, comments/notifications/meetings/action items, administration views for users/departments/project memberships, and reports with filtered result tables plus authenticated CSV export. API-backed attachment integrity and upload controls remain enforced; the generic record editor intentionally does not replace the dedicated binary upload endpoint. SRS attachments were unavailable to the runner, so repository docs, README, and the existing implementation were used as requirements.
