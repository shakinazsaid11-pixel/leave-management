# leave-management

Week 1: data model. Week 2: the backend API on top of it.

## Contents

- `docs/er-diagram.png` — ER diagram (source: `docs/er-diagram.dot`, Graphviz)
- `db/schema.sql` — table definitions, constraints, and the balance-enforcement trigger
- `db/seed.sql` — 10 employees across 3 managers, 45 leave requests spread across all four statuses and all twelve months
- `docker-compose.yml` — Postgres 16, auto-loads schema + seed on first start
- `leave-api/` — the NestJS API (week 2)
- `postman/collections/leave-management-api/` — a full request collection covering all 8 endpoints, kept locally via Postman's "Work locally with Git" feature

## Running it

**1. Database:**

```bash
docker compose up -d
```

That's it — one command. Postgres starts, and on the **first** run only, it automatically executes `db/schema.sql` then `db/seed.sql`.

To start completely fresh (re-run the init scripts), drop the volume first:

```bash
docker compose down -v
docker compose up -d
```

**2. API:**

```bash
cd leave-api
npm install
cp .env.example .env   # defaults already match docker-compose
npm run start:dev
```

The API listens on `http://localhost:3000`.

## Endpoints (week 2)

| Method | Path | What it does |
|---|---|---|
| GET | `/employees` | List employees |
| GET | `/employees/:id` | One employee, with remaining balance for the year |
| POST | `/leave-requests` | Submit a new request |
| GET | `/leave-requests` | List requests, filterable by `employeeId`, `status`, `from`, `to` |
| GET | `/leave-requests/:id` | One request |
| PATCH | `/leave-requests/:id/approve` | Approve (body: `{ "reviewerId": number }`) |
| PATCH | `/leave-requests/:id/reject` | Reject, with a reason (body: `{ "reviewerId": number, "reason": string }`) |
| PATCH | `/leave-requests/:id/cancel` | Cancel |

There's no login yet, so `approve`/`reject` take `reviewerId` in the body rather than inferring it — the schema requires a reviewer on any reviewed row.

## Architecture (week 2)

Three layers, per the brief:

- **Controller** (`*.controller.ts`) — receives the request, calls the service, returns the result. No business rules.
- **Service** (`*.service.ts`) — all business logic: business-day counting on create, the remaining-balance calculation, status-transition rules (only a PENDING request can move anywhere).
- **Repository** — currently this is just TypeORM's own `Repository<T>`, injected straight into each service with `@InjectRepository`. See "Known gap" below — this isn't a separate class the way the brief describes, and it's on the list to discuss.

## A note on "a request can't start in the past"

Enforced by a `CHECK` at the database level (`start_date >= CURRENT_DATE`). The service currently relies on that constraint rather than pre-validating — a past-dated request comes back as a raw Postgres error rather than a clean 400, which is one of the known gaps below.

## Known gaps / questions for the call

- **Response shape isn't fully consistent yet.** Successful responses come back as `{ "success": true, "data": ... }` (via a global interceptor), but errors still come back in NestJS's default shape (`{ "message", "error", "statusCode" }`) rather than a matching `{ "success": false, "error": {...} }`. The brief asks for every response to have the same shape — this is the biggest thing left to fix and didn't make it in before this write-up.
- **No separate Repository class.** Services inject `Repository<T>` directly rather than going through a dedicated repository layer that's the only code allowed to build queries. Works fine at this size, but it means `LeaveRequestsService` is building its own query in `findAll` (the filter logic), which is arguably a query-building responsibility that leaked into the service layer.
- **Past-start-date requests currently surface as a raw database error**, not a clean validation message.

## Design decisions worth knowing before the call (week 1, still true)

These are expanded on in `LOG.md`, but briefly:

- **Leave balance** lives in its own `leave_balance(employee_id, year)` table rather than a running counter on `employee`. The *remaining* balance is calculated on demand, not stored.
- **Weekends** are accounted for once, at submission time, into a stored `business_days` column.
- **Overlap prevention** is enforced by Postgres itself, via a `GIST EXCLUDE` constraint.
- **Balance enforcement** is enforced by a trigger on `leave_request`.
- Employees are **soft-deleted** (`is_active`) rather than removed.
- **`reviewed_at`/`created_at` are `TIMESTAMPTZ`**; `start_date`/`end_date` stay `DATE`.