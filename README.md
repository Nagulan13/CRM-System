# Internal CRM System MVP

Runnable local MVP grounded in **Internal CRM System SRS v2**. It provides a coherent authenticated dashboard, JSON-file persistence, project/ticket/task/comment/audit collections, RBAC-ready user records, and API-enforced ticket lifecycle transitions.

## Architecture and phased plan
- **Phase 1 (this MVP):** Node.js HTTP API, static accessible frontend, local username/password login, JSON persistence, ticket lifecycle validation, dashboard, seed data, audit history, configurable SLA metadata.
- **Phase 2:** relational database migration (SQLite/PostgreSQL), full project/member RBAC, requirements/clarifications/approvals, attachment storage, QA/UAT/release entities, reports/CSV export and pagination.
- **Phase 3:** production hardening: CSRF/session cookies, password hashing migration, object storage, observability, accessibility/performance review, deployment automation.

The app deliberately does **not** claim email or Google Calendar integration. GitHub/Drive/Sheets are deferred and may be represented as references/configuration points only.

## Local setup
Requirements: Node.js 20+.

```bash
node server/index.js             # http://localhost:3000
# in another terminal, once:
node server/seed.js               # creates demo project/ticket/task/comment
node --test                       # API smoke tests
```

Environment variables: `PORT` (default `3000`), `CRM_DATA_FILE` is reserved for a future database adapter. Data is stored in `data/crm.json`; do not use demo credentials outside local development.

Demo credentials: **admin / Admin123!**. API: `POST /api/login`, `GET /api/dashboard`, `GET|POST /api/projects`, `GET|POST /api/tickets`, `PATCH /api/tickets/:id`, plus tasks/comments/notifications/audit/attachments collections. Frontend: `http://localhost:3000`.

### Lifecycle and SLA
The API enforces Request → Analyse → Clarify → Approve → Assign → Develop → Review → QA → UAT → Deploy → Verify → Resolve → Close, with On Hold, Blocked, Rejected, Cancelled, and Reopened. Invalid transitions return HTTP 422. SLA defaults are configurable metadata and explicitly **pending management confirmation**: Critical 1h/4h, High 4h/1 business day, Medium 1 business day/3 business days, Low 2 business days/5 business days.

## Known limitations
This is an intentionally coherent MVP: JSON storage is single-process and not suitable for production concurrency; UI currently emphasizes dashboard/ticket flow over deep entity screens; authentication is local/demo only; attachment binaries, full RBAC enforcement, workflow approvals, QA/UAT/release detail screens, exports, and external integrations remain Phase 2/3.
