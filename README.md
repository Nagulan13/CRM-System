# Internal CRM System MVP

Remediation build for PR #1. The app is a Node.js HTTP API with a static frontend and local persistence.

## Setup

Requirements: Node.js 20+.

```bash
export DEMO_PASSWORD='choose-a-local-password'
export CRM_DATA_FILE="$PWD/data/crm.json" # optional; defaults to data/crm.json
npm run seed                         # only after the first server start creates the file
npm start                            # http://localhost:3000
npm test
npm run build
```

On first start, the admin account is created as `admin` with the password from `DEMO_PASSWORD`. If `DEMO_PASSWORD` is not set, a random password is generated and is not printed or stored in source/UI; reset the local data file and set the variable to choose credentials. Never commit `data/crm.json` or use demo credentials outside local development.

## Implemented remediation

- Fixed frontend syntax error; `npm run build` performs JavaScript syntax checks for frontend/server/seed.
- Bearer-token sessions, password hashing with Node `scrypt`, password-free user responses, logout, and protected API routes.
- Role and project access checks, protected fields, per-resource required-field validation, writable-field restrictions, and human-readable ticket IDs (`CRM-00001`).
- Append-only audit entries with authenticated actor identity; audit deletion is rejected.
- Ticket lifecycle transition guards, blocker/reopen/closure evidence requirements, status/priority validation, and history.
- Relational-style resource collections for departments, memberships, mentions, dependencies, clarifications, decisions, approvals, code reviews, QA/UAT, releases/deployments, meetings/actions, notifications, saved views, reports, attachments metadata, and tasks/comments.
- Dashboard metrics, ticket search/filter UI, session-aware frontend, and secure text escaping.

## Scope and limitations

The approved MVP resource surface is represented in the API and is available through generic CRUD routes, but this repository does not yet contain dedicated UI screens/workflows for every resource (for example QA evidence, UAT, release rollback, reports/exports, or administration). Attachment binaries are not accepted by the current API; only validated metadata is supported. SLA values are metadata and not yet a business-calendar monitoring engine.

SQLite replacement was not feasible without adding a dependency in this constrained workspace; persistence remains JSON-file based and is single-process. This is explicitly documented rather than claimed complete. The committed mutable runtime fixture was removed; use a temporary `CRM_DATA_FILE` for tests/evaluation.

## Actual verification

- `npm test`: automated authentication, password non-disclosure, lifecycle validation, human-readable IDs, and append-only audit tests pass.
- `npm run build`: syntax checks for all JavaScript entry points pass.
